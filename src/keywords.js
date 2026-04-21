const DEFAULT_HASHTAGS = {
  restaurant: ["restaurants", "restaurant", "food", "foodie", "dining"],
  hotel: ["hotels", "hotel", "hospitality", "stay", "travel"],
  bar: ["bars", "bar", "cocktails", "nightlife", "pub"],
  cafe: ["cafe", "cafes", "coffee", "brunch", "bakery"],
  hospitality: ["hospitality", "restaurants", "hotels", "bars", "cafes"],
};

function normalizeKeyword(keyword) {
  return String(keyword || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function parseHashtags(input) {
  if (Array.isArray(input)) {
    return input
      .map((value) => sanitizeHashtag(value))
      .filter(Boolean);
  }

  return String(input || "")
    .split(/[,\n]/)
    .map((value) => sanitizeHashtag(value))
    .filter(Boolean);
}

function sanitizeHashtag(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "");

  return normalized || null;
}

function resolveSearchParams({ keyword, hashtags }) {
  const normalizedKeyword = normalizeKeyword(keyword);
  const parsed = parseHashtags(hashtags);
  return {
    hashtags:
      parsed.length > 0
        ? [...new Set(parsed)]
        : [...new Set(DEFAULT_HASHTAGS[normalizedKeyword] || [normalizedKeyword])],
  };
}

function parseProfileTargets(input) {
  const values = Array.isArray(input)
    ? input
    : String(input || "").split(/[,\n]/);

  return [...new Set(values.map((value) => sanitizeProfileTarget(value)).filter(Boolean))];
}

function sanitizeProfileTarget(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (!/instagram\.com$/i.test(url.hostname.replace(/^www\./i, ""))) {
      return null;
    }
    const [candidate] = url.pathname
      .split("/")
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    return sanitizeUsername(candidate);
  } catch {
    return sanitizeUsername(raw.replace(/^@+/, ""));
  }
}

function sanitizeUsername(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\/+$/, "");

  if (!/^[A-Za-z0-9._]{1,30}$/.test(normalized)) return null;
  return normalized;
}

module.exports = {
  normalizeKeyword,
  parseHashtags,
  parseProfileTargets,
  resolveSearchParams,
};
