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

module.exports = {
  normalizeKeyword,
  parseHashtags,
  resolveSearchParams,
};
