const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function nowIso() {
  return new Date().toISOString();
}

function createStore(config) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  fs.mkdirSync(config.exportsDir, { recursive: true });

  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      keyword TEXT NOT NULL,
      hashtags_json TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      total_shards INTEGER NOT NULL DEFAULT 0,
      completed_shards INTEGER NOT NULL DEFAULT 0,
      failed_shards INTEGER NOT NULL DEFAULT 0,
      lead_count INTEGER NOT NULL DEFAULT 0,
      artifact_csv_path TEXT,
      artifact_json_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS shards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      shard_type TEXT NOT NULL,
      shard_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      result_count INTEGER NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      run_token TEXT,
      next_run_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(job_id, shard_type, shard_key),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_shards_status_next_run
      ON shards(status, next_run_at);

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      username TEXT NOT NULL,
      profile_url TEXT,
      full_name TEXT,
      external_url TEXT,
      biography TEXT,
      business_category TEXT,
      business_email TEXT,
      business_phone TEXT,
      business_address_street TEXT,
      business_address_city TEXT,
      business_address_region TEXT,
      business_address_postcode TEXT,
      business_address_country_code TEXT,
      is_professional_account INTEGER NOT NULL DEFAULT 0,
      followers_count INTEGER NOT NULL DEFAULT 0,
      following_count INTEGER NOT NULL DEFAULT 0,
      post_count INTEGER NOT NULL DEFAULT 0,
      profile_image_url TEXT,
      matched_hospitality_type TEXT,
      country_confidence INTEGER NOT NULL DEFAULT 0,
      relevance_score INTEGER NOT NULL DEFAULT 0,
      lead_status TEXT NOT NULL DEFAULT 'rejected',
      rejection_reason TEXT,
      discovered_from_hashtag TEXT,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(job_id, username),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  cleanupExpiredSessions();
  resetRunningShards();

  return {
    db,
    createJob(input) {
      const timestamp = nowIso();
      db.transaction(() => {
        db.prepare(
          `
            INSERT INTO jobs (
              id, country, keyword, hashtags_json, mode, status, message,
              created_at, updated_at
            ) VALUES (
              @id, @country, @keyword, @hashtagsJson, @mode, 'pending', 'Queued',
              @timestamp, @timestamp
            )
          `
        ).run({
          id: input.id,
          country: input.country,
          keyword: input.keyword,
          hashtagsJson: JSON.stringify(input.hashtags),
          mode: input.mode || "discovery",
          timestamp,
        });

        if ((input.mode || "discovery") === "safe") {
          for (const username of input.usernames || []) {
            db.prepare(
              `
                INSERT INTO shards (
                  job_id, shard_type, shard_key, payload_json, status, next_run_at,
                  created_at, updated_at
                ) VALUES (
                  @jobId, 'profile', @shardKey, @payloadJson, 'pending', @timestamp,
                  @timestamp, @timestamp
                )
              `
            ).run({
              jobId: input.id,
              shardKey: username,
              payloadJson: JSON.stringify({ username, sourceMode: "safe" }),
              timestamp,
            });
          }
        } else {
          for (const hashtag of input.hashtags) {
            db.prepare(
              `
                INSERT INTO shards (
                  job_id, shard_type, shard_key, payload_json, status, next_run_at,
                  created_at, updated_at
                ) VALUES (
                  @jobId, 'hashtag', @shardKey, @payloadJson, 'pending', @timestamp,
                  @timestamp, @timestamp
                )
              `
            ).run({
              jobId: input.id,
              shardKey: hashtag,
              payloadJson: JSON.stringify({ hashtag }),
              timestamp,
            });
          }
        }
      })();

      this.refreshJobStats(input.id);
    },

    markJobRunning(jobId) {
      db.prepare(
        `
          UPDATE jobs
          SET status = 'running',
              message = 'Running',
              started_at = COALESCE(started_at, @timestamp),
              updated_at = @timestamp
          WHERE id = @jobId
        `
      ).run({ jobId, timestamp: nowIso() });
    },

    listJobs() {
      return db
        .prepare(`SELECT * FROM jobs ORDER BY created_at DESC`)
        .all()
        .map(deserializeJobRow);
    },

    getJob(jobId) {
      const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
      return row ? deserializeJobRow(row) : null;
    },

    getJobStats(jobId) {
      const job = this.getJob(jobId);
      if (!job) return null;
      return {
        totalShards: job.totalShards,
        completedShards: job.completedShards,
        failedShards: job.failedShards,
        leadCount: job.leadCount,
        unfinishedShards: Math.max(
          job.totalShards - job.completedShards - job.failedShards,
          0
        ),
      };
    },

    refreshJobStats(jobId) {
      const row = db
        .prepare(
          `
            SELECT
              SUM(CASE WHEN status IN ('completed', 'skipped') THEN 1 ELSE 0 END) AS completed_shards,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_shards,
              SUM(CASE WHEN status IN ('pending', 'retry', 'running') THEN 1 ELSE 0 END) AS unfinished_shards,
              COUNT(*) AS total_shards
            FROM shards
            WHERE job_id = ?
          `
        )
        .get(jobId);

      const leadRow = db
        .prepare(`SELECT COUNT(*) AS total FROM leads WHERE job_id = ?`)
        .get(jobId);

      db.prepare(
        `
          UPDATE jobs
          SET total_shards = @totalShards,
              completed_shards = @completedShards,
              failed_shards = @failedShards,
              lead_count = @leadCount,
              updated_at = @timestamp
          WHERE id = @jobId
        `
      ).run({
        jobId,
        totalShards: row?.total_shards || 0,
        completedShards: row?.completed_shards || 0,
        failedShards: row?.failed_shards || 0,
        leadCount: leadRow?.total || 0,
        timestamp: nowIso(),
      });

      return {
        unfinishedShards: row?.unfinished_shards || 0,
        completedShards: row?.completed_shards || 0,
        failedShards: row?.failed_shards || 0,
        totalShards: row?.total_shards || 0,
        leadCount: leadRow?.total || 0,
      };
    },

    claimNextShard() {
      const timestamp = nowIso();
      const row = db
        .prepare(
          `
            SELECT s.*
            FROM shards s
            JOIN jobs j ON j.id = s.job_id
            WHERE s.status IN ('pending', 'retry')
              AND s.next_run_at <= @timestamp
              AND j.status = 'running'
            ORDER BY s.next_run_at ASC, s.id ASC
            LIMIT 1
          `
        )
        .get({ timestamp });

      if (!row) return null;
      const runToken = `${row.id}:${Date.now()}`;
      db.prepare(
        `
          UPDATE shards
          SET status = 'running',
              run_token = @runToken,
              attempt_count = attempt_count + 1,
              updated_at = @timestamp
          WHERE id = @id
        `
      ).run({ id: row.id, runToken, timestamp });

      const claimed = db.prepare(`SELECT * FROM shards WHERE id = ?`).get(row.id);
      return deserializeShardRow(claimed);
    },

    completeShard(shardId, resultCount, runToken, message = null) {
      const timestamp = nowIso();
      db.prepare(
        `
          UPDATE shards
          SET status = 'completed',
              result_count = @resultCount,
              last_error = @message,
              updated_at = @timestamp
          WHERE id = @id
            AND run_token = @runToken
        `
      ).run({ id: shardId, resultCount, message, timestamp, runToken });
    },

    skipShard(shardId, message, runToken) {
      const timestamp = nowIso();
      db.prepare(
        `
          UPDATE shards
          SET status = 'skipped',
              last_error = @message,
              updated_at = @timestamp
          WHERE id = @id
            AND run_token = @runToken
        `
      ).run({ id: shardId, message, timestamp, runToken });
    },

    retryShard(shardId, errorMessage, delayMs, runToken) {
      const nextRunAt = new Date(Date.now() + delayMs).toISOString();
      db.prepare(
        `
          UPDATE shards
          SET status = 'retry',
              next_run_at = @nextRunAt,
              last_error = @errorMessage,
              updated_at = @timestamp
          WHERE id = @id
            AND run_token = @runToken
        `
      ).run({
        id: shardId,
        nextRunAt,
        errorMessage,
        timestamp: nowIso(),
        runToken,
      });
    },

    failShard(shardId, errorMessage, runToken) {
      db.prepare(
        `
          UPDATE shards
          SET status = 'failed',
              last_error = @errorMessage,
              updated_at = @timestamp
          WHERE id = @id
            AND run_token = @runToken
        `
      ).run({
        id: shardId,
        errorMessage,
        timestamp: nowIso(),
        runToken,
      });
    },

    createProfileShard(jobId, username, payload) {
      const timestamp = nowIso();
      db.prepare(
        `
          INSERT OR IGNORE INTO shards (
            job_id, shard_type, shard_key, payload_json, status, next_run_at,
            created_at, updated_at
          ) VALUES (
            @jobId, 'profile', @shardKey, @payloadJson, 'pending', @timestamp,
            @timestamp, @timestamp
          )
        `
      ).run({
        jobId,
        shardKey: username,
        payloadJson: JSON.stringify(payload),
        timestamp,
      });
    },

    upsertLead(jobId, lead) {
      const timestamp = nowIso();
      db.prepare(
        `
          INSERT INTO leads (
            job_id, username, profile_url, full_name, external_url, biography,
            business_category, business_email, business_phone,
            business_address_street, business_address_city, business_address_region,
            business_address_postcode, business_address_country_code,
            is_professional_account, followers_count, following_count, post_count,
            profile_image_url, matched_hospitality_type, country_confidence,
            relevance_score, lead_status, rejection_reason, discovered_from_hashtag,
            raw_json, created_at, updated_at
          ) VALUES (
            @jobId, @username, @profile_url, @full_name, @external_url, @biography,
            @business_category, @business_email, @business_phone,
            @business_address_street, @business_address_city, @business_address_region,
            @business_address_postcode, @business_address_country_code,
            @is_professional_account, @followers_count, @following_count, @post_count,
            @profile_image_url, @matched_hospitality_type, @country_confidence,
            @relevance_score, @lead_status, @rejection_reason, @discovered_from_hashtag,
            @raw_json, @timestamp, @timestamp
          )
          ON CONFLICT(job_id, username) DO UPDATE SET
            profile_url = excluded.profile_url,
            full_name = excluded.full_name,
            external_url = excluded.external_url,
            biography = excluded.biography,
            business_category = excluded.business_category,
            business_email = excluded.business_email,
            business_phone = excluded.business_phone,
            business_address_street = excluded.business_address_street,
            business_address_city = excluded.business_address_city,
            business_address_region = excluded.business_address_region,
            business_address_postcode = excluded.business_address_postcode,
            business_address_country_code = excluded.business_address_country_code,
            is_professional_account = excluded.is_professional_account,
            followers_count = excluded.followers_count,
            following_count = excluded.following_count,
            post_count = excluded.post_count,
            profile_image_url = excluded.profile_image_url,
            matched_hospitality_type = excluded.matched_hospitality_type,
            country_confidence = excluded.country_confidence,
            relevance_score = excluded.relevance_score,
            lead_status = excluded.lead_status,
            rejection_reason = excluded.rejection_reason,
            discovered_from_hashtag = excluded.discovered_from_hashtag,
            raw_json = excluded.raw_json,
            updated_at = excluded.updated_at
        `
      ).run({
        ...lead,
        jobId,
        timestamp,
      });
    },

    getJobLeads(jobId, { limit = 100, offset = 0 } = {}) {
      return db
        .prepare(
          `
            SELECT *
            FROM leads
            WHERE job_id = ?
            ORDER BY relevance_score DESC, id ASC
            LIMIT ?
            OFFSET ?
          `
        )
        .all(jobId, limit, offset)
        .map(deserializeLeadRow);
    },

    countJobLeadsAfterId(jobId, leadId) {
      return (
        db
          .prepare(
            `
              SELECT COUNT(*) AS total
              FROM leads
              WHERE job_id = ?
                AND id > ?
            `
          )
          .get(jobId, leadId)?.total || 0
      );
    },

    countJobShards(jobId, status = null) {
      const row = status
        ? db
            .prepare(
              `SELECT COUNT(*) AS total FROM shards WHERE job_id = ? AND status = ?`
            )
            .get(jobId, status)
        : db
            .prepare(`SELECT COUNT(*) AS total FROM shards WHERE job_id = ?`)
            .get(jobId);
      return row?.total || 0;
    },

    listJobShards(jobId, { status = null, limit = 100, offset = 0 } = {}) {
      const rows = status
        ? db
            .prepare(
              `
                SELECT *
                FROM shards
                WHERE job_id = ?
                  AND status = ?
                ORDER BY updated_at DESC, id DESC
                LIMIT ?
                OFFSET ?
              `
            )
            .all(jobId, status, limit, offset)
        : db
            .prepare(
              `
                SELECT *
                FROM shards
                WHERE job_id = ?
                ORDER BY updated_at DESC, id DESC
                LIMIT ?
                OFFSET ?
              `
            )
            .all(jobId, limit, offset);

      return rows.map(deserializeShardRow);
    },

    getJobErrors(jobId, { limit = 25 } = {}) {
      return db
        .prepare(
          `
            SELECT *
            FROM shards
            WHERE job_id = ?
              AND COALESCE(last_error, '') != ''
            ORDER BY updated_at DESC, id DESC
            LIMIT ?
          `
        )
        .all(jobId, limit)
        .map(deserializeShardRow);
    },

    pauseJob(jobId) {
      db.prepare(
        `
          UPDATE jobs
          SET status = 'paused',
              message = 'Paused',
              updated_at = @timestamp
          WHERE id = @jobId
        `
      ).run({ jobId, timestamp: nowIso() });
      return this.getJob(jobId);
    },

    resumeJob(jobId) {
      db.prepare(
        `
          UPDATE jobs
          SET status = 'running',
              message = 'Running',
              updated_at = @timestamp
          WHERE id = @jobId
        `
      ).run({ jobId, timestamp: nowIso() });
      return this.getJob(jobId);
    },

    cancelJob(jobId) {
      const timestamp = nowIso();
      db.transaction(() => {
        db.prepare(
          `
            UPDATE jobs
            SET status = 'canceled',
                message = 'Canceled',
                finished_at = @timestamp,
                updated_at = @timestamp
            WHERE id = @jobId
          `
        ).run({ jobId, timestamp });

        db.prepare(
          `
            UPDATE shards
            SET status = 'failed',
                last_error = 'Canceled by operator.',
                updated_at = @timestamp
            WHERE job_id = @jobId
              AND status IN ('pending', 'retry', 'running')
          `
        ).run({ jobId, timestamp });
      })();

      this.refreshJobStats(jobId);
      return this.getJob(jobId);
    },

    finalizeJob(jobId, status, message, artifacts) {
      db.prepare(
        `
          UPDATE jobs
          SET status = @status,
              message = @message,
              artifact_csv_path = @csvPath,
              artifact_json_path = @jsonPath,
              finished_at = @timestamp,
              updated_at = @timestamp
          WHERE id = @jobId
        `
      ).run({
        jobId,
        status,
        message,
        csvPath: artifacts?.csvPath || null,
        jsonPath: artifacts?.jsonPath || null,
        timestamp: nowIso(),
      });
    },

    deleteJob(jobId) {
      const job = this.getJob(jobId);
      if (!job) return null;
      if (!["completed", "partial", "failed", "canceled"].includes(job.status)) {
        throw new Error("Only terminal jobs can be deleted.");
      }
      db.prepare(`DELETE FROM jobs WHERE id = ?`).run(jobId);
      return job;
    },

    reclaimStaleRunningShards(staleMs) {
      const cutoff = new Date(Date.now() - staleMs).toISOString();
      const rows = db
        .prepare(
          `
            SELECT id, job_id
            FROM shards
            WHERE status = 'running'
              AND updated_at < ?
          `
        )
        .all(cutoff);

      if (!rows.length) return [];

      db.prepare(
        `
          UPDATE shards
          SET status = 'retry',
              next_run_at = @timestamp,
              last_error = 'Recovered stale running shard.',
              updated_at = @timestamp
          WHERE status = 'running'
            AND updated_at < @cutoff
        `
      ).run({ timestamp: nowIso(), cutoff });

      return [...new Set(rows.map((row) => row.job_id))];
    },

    createSession(session) {
      const timestamp = nowIso();
      db.prepare(
        `
          INSERT INTO sessions (
            id, username, expires_at, created_at, last_seen_at
          ) VALUES (
            @id, @username, @expiresAt, @timestamp, @timestamp
          )
        `
      ).run({
        id: session.id,
        username: session.username,
        expiresAt: session.expiresAt,
        timestamp,
      });
    },

    getSession(sessionId) {
      cleanupExpiredSessions();
      return (
        db
          .prepare(`SELECT * FROM sessions WHERE id = ?`)
          .get(sessionId) || null
      );
    },

    touchSession(sessionId, expiresAt) {
      db.prepare(
        `
          UPDATE sessions
          SET expires_at = @expiresAt,
              last_seen_at = @timestamp
          WHERE id = @sessionId
        `
      ).run({ sessionId, expiresAt, timestamp: nowIso() });
    },

    deleteSession(sessionId) {
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    },

    cleanupExpiredSessions,

    getNocoDbConfig(defaults = {}) {
      const row = db
        .prepare(`SELECT value_json FROM app_settings WHERE key = 'nocodb_config'`)
        .get();
      return row ? { ...defaults, ...JSON.parse(row.value_json) } : { ...defaults };
    },

    saveNocoDbConfig(input = {}, defaults = {}) {
      const merged = { ...this.getNocoDbConfig(defaults), ...(input || {}) };
      db.prepare(
        `
          INSERT INTO app_settings (key, value_json, updated_at)
          VALUES ('nocodb_config', @valueJson, @timestamp)
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `
      ).run({ valueJson: JSON.stringify(merged), timestamp: nowIso() });
      return merged;
    },

    getInstagramRuntimeConfig(defaults = {}) {
      const row = db
        .prepare(
          `SELECT value_json FROM app_settings WHERE key = 'instagram_runtime_config'`
        )
        .get();
      return row ? { ...defaults, ...JSON.parse(row.value_json) } : { ...defaults };
    },

    saveInstagramRuntimeConfig(input = {}, defaults = {}) {
      const current = this.getInstagramRuntimeConfig(defaults);
      const merged = { ...current, ...(input || {}) };
      db.prepare(
        `
          INSERT INTO app_settings (key, value_json, updated_at)
          VALUES ('instagram_runtime_config', @valueJson, @timestamp)
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `
      ).run({ valueJson: JSON.stringify(merged), timestamp: nowIso() });
      return merged;
    },
  };

  function cleanupExpiredSessions() {
    db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(nowIso());
  }

  function resetRunningShards() {
    db.prepare(
      `
        UPDATE shards
        SET status = 'retry',
            last_error = 'Reset running shard on process start.',
            next_run_at = @timestamp,
            updated_at = @timestamp
        WHERE status = 'running'
      `
    ).run({ timestamp: nowIso() });
  }
}

function deserializeJobRow(row) {
  return {
    id: row.id,
    country: row.country,
    keyword: row.keyword,
    hashtags: JSON.parse(row.hashtags_json || "[]"),
    mode: row.mode,
    status: row.status,
    message: row.message,
    totalShards: row.total_shards,
    completedShards: row.completed_shards,
    failedShards: row.failed_shards,
    leadCount: row.lead_count,
    artifactCsvPath: row.artifact_csv_path,
    artifactJsonPath: row.artifact_json_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function deserializeShardRow(row) {
  const payload = JSON.parse(row.payload_json || "{}");
  return {
    id: row.id,
    jobId: row.job_id,
    shardType: row.shard_type,
    shardKey: row.shard_key,
    payload,
    status: row.status,
    depth: payload.depth || 0,
    resultCount: row.result_count,
    attemptCount: row.attempt_count,
    nextRunAt: row.next_run_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
    bbox: payload,
    runToken: row.run_token,
  };
}

function deserializeLeadRow(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    username: row.username,
    profile_url: row.profile_url,
    full_name: row.full_name,
    external_url: row.external_url,
    biography: row.biography,
    business_category: row.business_category,
    business_email: row.business_email,
    business_phone: row.business_phone,
    business_address_street: row.business_address_street,
    business_address_city: row.business_address_city,
    business_address_region: row.business_address_region,
    business_address_postcode: row.business_address_postcode,
    business_address_country_code: row.business_address_country_code,
    is_professional_account: Boolean(row.is_professional_account),
    followers_count: row.followers_count,
    following_count: row.following_count,
    post_count: row.post_count,
    profile_image_url: row.profile_image_url,
    matched_hospitality_type: row.matched_hospitality_type,
    country_confidence: row.country_confidence,
    relevance_score: row.relevance_score,
    lead_status: row.lead_status,
    rejection_reason: row.rejection_reason,
    discovered_from_hashtag: row.discovered_from_hashtag,
    name: row.full_name || row.username,
    website: row.external_url,
    phone: row.business_phone,
    category: row.business_category,
    subcategory: row.matched_hospitality_type,
    reviewRating: row.relevance_score,
    reviewCount: row.country_confidence,
    allSubcategories: [row.lead_status, row.discovered_from_hashtag].filter(Boolean),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { createStore };
