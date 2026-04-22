const crypto = require("crypto");
const { exportJobArtifacts } = require("./exporters");
const {
  discoverProfilesByHashtag,
  fetchProfileInfo,
  InstagramFrictionError,
} = require("./instagram");
const { classifyHospitalityLead } = require("./classifier");
const { getInstagramRuntimeConfig } = require("./runtime-config");

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
      if (error instanceof InstagramFrictionError) {
        const delay = error.cooldownMs || config.igFrictionRetryDelayMs;
        store.retryShard(shard.id, error.message, delay, shard.runToken);
        if (job.mode === "discovery" && error.pauseJob !== false) {
          store.pauseJob(
            job.id,
            `${error.message} Job paused after an Instagram friction signal. Wait before resuming.`
          );
        }
        store.refreshJobStats(job.id);
        finalizeEligibleJobs();
        return;
      }

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
    const runtimeConfig = getInstagramRuntimeConfig({ store, config });
    const discovery = await discoverProfilesByHashtag(tag, runtimeConfig);
    const existingProfileShardCount = store.countProfileShards(job.id);
    const remainingCapacity = Math.max(
      runtimeConfig.igDiscoveryMaxProfilesPerJob - existingProfileShardCount,
      0
    );

    if (!discovery.usernames.length || remainingCapacity === 0) {
      const cooldownMs = randomBetween(
        runtimeConfig.igHashtagCooldownMinMs,
        runtimeConfig.igHashtagCooldownMaxMs
      );
      store.deferPendingHashtagShards(job.id, cooldownMs, shard.id);
      store.completeShard(
        shard.id,
        0,
        shard.runToken,
        remainingCapacity === 0
          ? `Skipped #${tag} because the job already reached the profile cap (${runtimeConfig.igDiscoveryMaxProfilesPerJob}).`
          : discovery.message || "No profiles discovered."
      );
      return;
    }

    const usernamesToQueue = discovery.usernames.slice(0, remainingCapacity);
    for (const username of usernamesToQueue) {
      store.createProfileShard(job.id, username, {
        username,
        discoveredFromHashtag: tag,
      });
    }

    const cooldownMs = randomBetween(
      runtimeConfig.igHashtagCooldownMinMs,
      runtimeConfig.igHashtagCooldownMaxMs
    );
    store.deferPendingHashtagShards(job.id, cooldownMs, shard.id);

    store.completeShard(
      shard.id,
      usernamesToQueue.length,
      shard.runToken,
      usernamesToQueue.length < discovery.usernames.length
        ? `Discovered ${discovery.usernames.length} profiles from #${tag}, queued ${usernamesToQueue.length} before hitting the job cap.`
        : `Discovered ${usernamesToQueue.length} profiles from #${tag}.`
    );
  }

  async function processProfileShard(job, shard) {
    const username = shard.payload?.username || shard.shardKey;
    const runtimeConfig = getInstagramRuntimeConfig({ store, config });
    const profile = await fetchProfileInfo(username, runtimeConfig);
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

function randomBetween(minMs, maxMs) {
  const min = Math.max(Number(minMs) || 0, 0);
  const max = Math.max(Number(maxMs) || min, min);
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = { createWorker, createJobId };
