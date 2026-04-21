const { execFile } = require("child_process");
const { promisify } = require("util");
const { chromium } = require("playwright-core");

const execFileAsync = promisify(execFile);
let browserPromise = null;

async function fetchProfileInfo(username, config) {
  const url = `${config.igBaseUrl}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  let lastStatus = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await curlJson(url, buildApiHeaders(config, null), config);

    if (response.ok) {
      const payload = response.json;
      const user = payload?.data?.user;
      if (!user?.username) {
        throw new Error(`Profile lookup returned no user for ${username}.`);
      }

      const address = user.business_address_json || {};
      return {
        username: user.username,
        profile_url: `${config.igBaseUrl}/${user.username}/`,
        full_name: user.full_name || null,
        biography: user.biography || null,
        external_url:
          user.external_url ||
          user.bio_links?.find((link) => link?.url)?.url ||
          null,
        business_category: user.category_name || null,
        business_email: user.business_email || null,
        business_phone: user.business_phone_number || null,
        business_address_street: address.street_address || null,
        business_address_city: address.city_name || null,
        business_address_region: address.region_name || null,
        business_address_postcode: address.zip_code || null,
        business_address_country_code: address.country_code || null,
        is_professional_account: Boolean(user.is_professional_account),
        followers_count: user.edge_followed_by?.count || 0,
        following_count: user.edge_follow?.count || 0,
        post_count: user.edge_owner_to_timeline_media?.count || 0,
        profile_image_url: user.profile_pic_url_hd || user.profile_pic_url || null,
        raw: user,
      };
    }

    lastStatus = response.status;
    if (response.status !== 429) {
      break;
    }

    await delay(config.igRequestDelayMs * (attempt + 1));
  }

  throw new Error(
    `Profile lookup failed for ${username}: HTTP ${lastStatus || "unknown"}`
  );
}

async function discoverProfilesByHashtag(hashtag, config) {
  if (!config.igSessionId) {
    return {
      usernames: [],
      message:
        "Hashtag discovery requires IG_SESSION_ID. Profile extraction remains public.",
    };
  }

  const apiUsernames = await tryDiscoverFromTagApi(hashtag, config);
  if (apiUsernames.length > 0) {
    return {
      usernames: apiUsernames.slice(0, config.igDiscoveryMaxProfilesPerHashtag),
      message: `Discovered via tag API.`,
    };
  }

  const browserUsernames = await discoverViaBrowser(hashtag, config);
  return {
    usernames: browserUsernames.slice(0, config.igDiscoveryMaxProfilesPerHashtag),
    message:
      browserUsernames.length > 0
        ? "Discovered via browser fallback."
        : "No profiles discovered from hashtag.",
  };
}

async function tryDiscoverFromTagApi(hashtag, config) {
  const url = `${config.igBaseUrl}/api/v1/tags/web_info/?tag_name=${encodeURIComponent(
    hashtag
  )}`;

  const response = await curlJson(
    url,
    buildApiHeaders(config, config.igSessionId),
    config
  );

  if (!response.ok) {
    return [];
  }

  const payload = response.json;
  if (!payload) return [];

  return [...collectUsernames(payload)];
}

async function discoverViaBrowser(hashtag, config) {
  const browser = await getBrowser(config);
  const context = await browser.newContext({
    userAgent: config.igUserAgent,
    proxy: config.igProxyUrl ? parseProxy(config.igProxyUrl) : undefined,
  });

  await context.addCookies([
    {
      name: "sessionid",
      value: config.igSessionId,
      domain: ".instagram.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "None",
    },
  ]);

  const page = await context.newPage();
  const discovered = new Set();

  try {
    await page.goto(`${config.igBaseUrl}/explore/tags/${hashtag}/`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    for (let index = 0; index < config.igDiscoveryScrollSteps; index += 1) {
      await page.waitForTimeout(config.igRequestDelayMs);
      const postLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href*='/p/'], a[href*='/reel/']"))
          .map((anchor) => anchor.href)
          .filter(Boolean)
      );

      for (const link of postLinks.slice(0, config.igDiscoveryPostSampleLimit)) {
        if (discovered.size >= config.igDiscoveryMaxProfilesPerHashtag) break;
        const username = await extractUsernameFromPost(context, link, config);
        if (username) discovered.add(username);
      }

      await page.evaluate(() =>
        window.scrollTo(0, document.body.scrollHeight)
      );
    }
  } finally {
    await context.close();
  }

  return [...discovered];
}

async function extractUsernameFromPost(context, link, config) {
  const page = await context.newPage();
  try {
    await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(config.igRequestDelayMs);
    const href = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      for (const anchor of anchors) {
        const hrefValue = anchor.getAttribute("href") || "";
        if (
          /^\/[A-Za-z0-9._]+\/$/.test(hrefValue) &&
          !hrefValue.startsWith("/explore/") &&
          !hrefValue.startsWith("/accounts/")
        ) {
          return hrefValue;
        }
      }
      return null;
    });

    return href ? href.replace(/\//g, "") : null;
  } catch (_error) {
    return null;
  } finally {
    await page.close();
  }
}

function collectUsernames(value, target = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectUsernames(item, target);
    return target;
  }

  if (!value || typeof value !== "object") {
    return target;
  }

  if (
    typeof value.username === "string" &&
    /^[A-Za-z0-9._]{2,30}$/.test(value.username)
  ) {
    target.add(value.username);
  }

  for (const nested of Object.values(value)) {
    collectUsernames(nested, target);
  }

  return target;
}

function buildApiHeaders(config, sessionId) {
  const headers = {
    "x-ig-app-id": config.igAppId,
    "x-asbd-id": "129477",
    "user-agent": config.igUserAgent,
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    referer: `${config.igBaseUrl}/`,
  };
  if (sessionId) {
    headers.cookie = `sessionid=${sessionId}`;
  }
  return headers;
}

async function curlJson(url, headers, config) {
  const args = [
    "--silent",
    "--show-error",
    "--location",
    "--compressed",
    "--write-out",
    "\\n%{http_code}",
    url,
  ];

  if (config.igProxyUrl) {
    args.unshift(config.igProxyUrl);
    args.unshift("--proxy");
  }

  for (const [name, value] of Object.entries(headers || {})) {
    if (value == null || value === "") continue;
    args.unshift(`${name}: ${value}`);
    args.unshift("--header");
  }

  const { stdout } = await execFileAsync("curl", args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  const separator = stdout.lastIndexOf("\n");
  const body = separator >= 0 ? stdout.slice(0, separator) : stdout;
  const statusText = separator >= 0 ? stdout.slice(separator + 1).trim() : "";
  const status = Number.parseInt(statusText, 10) || 0;
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    json,
  };
}

async function getBrowser(config) {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: config.igHeadless,
      executablePath: config.chromiumPath,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}

function parseProxy(proxyUrl) {
  if (!proxyUrl) return undefined;
  const url = new URL(proxyUrl);
  return {
    server: `${url.protocol}//${url.host}`,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  closeBrowser,
  discoverProfilesByHashtag,
  fetchProfileInfo,
};
