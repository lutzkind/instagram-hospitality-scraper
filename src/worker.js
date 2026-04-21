const crypto = require("crypto");
const { exportJobArtifacts } = require("./exporters");
const {
  discoverProfilesByHashtag,
  fetchProfileInfo,
} = require("./instagram");
const { classifyHospitalityLead } = require("./classifier");

function createWorker({ store, config }) {
  let timer = null;
  let active = false;

  return {
    async start() {
      active = true;
      await tick();
      timer = setInterval(() => {
        tick().catch((error) => {
          console.error("Worker tick failed:", error);
        });
      }, config.workerPollMs);
    },
    stop() {
      active = false;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };

  async function tick() {
    if (!active) return;

    store.cleanupExpiredSessions();
    for (const job of store.listJobs()) {
      if (job.status === "pending") {
        store.markJobRunning(job.id);
      }
    }

    const reclaimedJobIds = store.reclaimStaleRunningShards(
      config.runningShardStaleMs
    );
    for (const jobId of reclaimedJobIds) {
      store.refreshJobStats(jobId);
    }

    const shard = store.claimNextShard();
    if (!shard) {
      finalizeEligibleJobs();
      return;
    }

    const job = store.getJob(shard.jobId);
    if (!job || ["canceled", "failed", "completed"].includes(job.status)) {
      store.failShard(shard.id, "Job is no longer runnable.", shard.runToken);
      return;
    }

    try {
      if (shard.shardType === "hashtag") {
        await processHashtagShard(job, shard);
      } else if (shard.shardType === "profile") {
        await processProfileShard(job, shard);
      } else {
        throw new Error(`Unsupported shard type: ${shard.shardType}`);
      }
    } catch (error) {
      const attemptCount = (shard.attemptCount || 0) + 1;
      if (attemptCount < config.retryLimit) {
        const delay = config.retryBaseDelayMs * attemptCount;
        store.retryShard(shard.id, error.message, delay, shard.runToken);
      } else {
        store.failShard(shard.id, error.message, shard.runToken);
      }
    }

    store.refreshJobStats(job.id);
    finalizeEligibleJobs();
  }

  async function processHashtagShard(job, shard) {
    const tag = shard.payload?.hashtag || shard.shardKey;
    const discovery = await discoverProfilesByHashtag(tag, config);

    if (!discovery.usernames.length) {
      store.completeShard(
        shard.id,
        0,
        shard.runToken,
        discovery.message || "No profiles discovered."
      );
      return;
    }

    for (const username of discovery.usernames) {
      store.createProfileShard(job.id, username, {
        username,
        discoveredFromHashtag: tag,
      });
    }

    store.completeShard(
      shard.id,
      discovery.usernames.length,
      shard.runToken,
      `Discovered ${discovery.usernames.length} profiles from #${tag}.`
    );
  }

  async function processProfileShard(job, shard) {
    const username = shard.payload?.username || shard.shardKey;
    const profile = await fetchProfileInfo(username, config);
    const classified = classifyHospitalityLead({
      profile,
      countryInput: job.country,
      keyword: job.keyword,
      discoveredFromHashtag: shard.payload?.discoveredFromHashtag || null,
    });

    store.upsertLead(job.id, classified);
    store.completeShard(
      shard.id,
      1,
      shard.runToken,
      `Extracted profile ${username}.`
    );
  }

  function finalizeEligibleJobs() {
    for (const job of store.listJobs()) {
      if (!["running", "paused"].includes(job.status)) continue;
      if (job.status === "paused") continue;
      const stats = store.refreshJobStats(job.id);
      if (stats.unfinishedShards > 0) continue;

      const artifacts = exportJobArtifacts({ store, config, jobId: job.id });
      const status = stats.failedShards > 0 && stats.completedShards === 0
        ? "failed"
        : stats.failedShards > 0
          ? "partial"
          : "completed";
      const message =
        status === "failed"
          ? "All shards failed."
          : `Finished with ${stats.leadCount} extracted leads.`;

      store.finalizeJob(job.id, status, message, artifacts);
    }
  }
}

function createJobId() {
  return crypto.randomUUID();
}

module.exports = { createWorker, createJobId };
