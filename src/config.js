const path = require("path");

function intFromEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
const port = intFromEnv("PORT", 3000);
const workerPollMs = intFromEnv("WORKER_POLL_MS", 4000);
const igRequestDelayMs = intFromEnv("IG_REQUEST_DELAY_MS", 2000);
const igRequestDelayMinMs = intFromEnv(
  "IG_REQUEST_DELAY_MIN_MS",
  Math.max(igRequestDelayMs, 1500)
);
const igRequestDelayMaxMs = intFromEnv(
  "IG_REQUEST_DELAY_MAX_MS",
  Math.max(igRequestDelayMinMs + 1000, 3500)
);

module.exports = {
  host: process.env.HOST || "0.0.0.0",
  port,
  dataDir,
  dbPath:
    process.env.DB_PATH ||
    path.join(dataDir, "instagram-hospitality-scraper.db"),
  exportsDir: process.env.EXPORTS_DIR || path.join(dataDir, "exports"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
  workerPollMs,
  runningShardStaleMs: intFromEnv(
    "RUNNING_SHARD_STALE_MS",
    Math.max(workerPollMs * 30, 20 * 60 * 1000)
  ),
  retryLimit: intFromEnv("RETRY_LIMIT", 3),
  retryBaseDelayMs: intFromEnv("RETRY_BASE_DELAY_MS", 120000),
  adminUsername: process.env.ADMIN_USERNAME || null,
  adminPassword: process.env.ADMIN_PASSWORD || null,
  sessionCookieName:
    process.env.SESSION_COOKIE_NAME || "instagram_hospitality_session",
  sessionTtlHours: intFromEnv("SESSION_TTL_HOURS", 24),
  igAppId: process.env.IG_APP_ID || "936619743392459",
  igBaseUrl: process.env.IG_BASE_URL || "https://www.instagram.com",
  igUserAgent:
    process.env.IG_USER_AGENT ||
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  igSessionId: process.env.IG_SESSION_ID || null,
  igProxyUrl: process.env.IG_PROXY_URL || null,
  igHeadless: boolFromEnv("IG_HEADLESS", true),
  igRequestDelayMs,
  igRequestDelayMinMs,
  igRequestDelayMaxMs,
  igBrowserWarmupMinMs: intFromEnv("IG_BROWSER_WARMUP_MIN_MS", 1000),
  igBrowserWarmupMaxMs: intFromEnv("IG_BROWSER_WARMUP_MAX_MS", 2500),
  igHashtagCooldownMinMs: intFromEnv("IG_HASHTAG_COOLDOWN_MIN_MS", 15000),
  igHashtagCooldownMaxMs: intFromEnv("IG_HASHTAG_COOLDOWN_MAX_MS", 30000),
  igProfileOpenDelayMinMs: intFromEnv("IG_PROFILE_OPEN_DELAY_MIN_MS", 400),
  igProfileOpenDelayMaxMs: intFromEnv("IG_PROFILE_OPEN_DELAY_MAX_MS", 900),
  igDiscoveryMaxProfilesPerHashtag: intFromEnv(
    "IG_DISCOVERY_MAX_PROFILES_PER_HASHTAG",
    50
  ),
  igDiscoveryMaxProfilesPerJob: intFromEnv(
    "IG_DISCOVERY_MAX_PROFILES_PER_JOB",
    150
  ),
  igDiscoveryScrollSteps: intFromEnv("IG_DISCOVERY_SCROLL_STEPS", 1),
  igDiscoveryPostSampleLimit: intFromEnv("IG_DISCOVERY_POST_SAMPLE_LIMIT", 6),
  igDiscoveryPageTimeoutMs: intFromEnv("IG_DISCOVERY_PAGE_TIMEOUT_MS", 15000),
  igFrictionRetryDelayMs: intFromEnv(
    "IG_FRICTION_RETRY_DELAY_MS",
    15 * 60 * 1000
  ),
  chromiumPath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  nocoDb: {
    baseUrl: process.env.NOCODB_BASE_URL || null,
    apiToken: process.env.NOCODB_API_TOKEN || null,
    baseId: process.env.NOCODB_BASE_ID || null,
    tableId: process.env.NOCODB_TABLE_ID || null,
  },
};
