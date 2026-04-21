const HOSPITALITY_TYPES = [
  "restaurant",
  "restaurants",
  "hotel",
  "hotels",
  "bar",
  "bars",
  "pub",
  "cafe",
  "cafes",
  "coffee",
  "cocktail",
  "cocktails",
  "bistro",
  "brasserie",
  "resort",
  "hostel",
  "guesthouse",
  "guest_house",
  "guest house",
];

const NEGATIVE_TERMS = [
  "creator",
  "influencer",
  "ugc",
  "model",
  "affiliate",
  "personal blog",
  "collab",
  "collaboration",
  "coach",
  "photographer",
  "videographer",
  "artist",
];

const DIAL_CODES = {
  US: "+1",
  CA: "+1",
  GB: "+44",
  AU: "+61",
  NZ: "+64",
  DE: "+49",
  FR: "+33",
  ES: "+34",
  IT: "+39",
  NL: "+31",
  AE: "+971",
  SG: "+65",
};

function classifyHospitalityLead({
  profile,
  countryInput,
  keyword,
  discoveredFromHashtag,
}) {
  const bio = profile.biography || "";
  const category = profile.business_category || "";
  const fullName = profile.full_name || "";
  const searchable = [bio, category, fullName, keyword].join(" ").toLowerCase();

  let matchedType = inferHospitalityType(searchable);
  if (!matchedType) {
    matchedType = inferHospitalityType(discoveredFromHashtag || "");
  }

  let relevanceScore = 0;
  const negativeHits = NEGATIVE_TERMS.filter((term) =>
    searchable.includes(term)
  );

  if (matchedType) relevanceScore += 40;
  if (profile.is_professional_account) relevanceScore += 15;
  if (category) relevanceScore += 10;
  if (profile.external_url) relevanceScore += 10;
  if (profile.business_email) relevanceScore += 10;
  if (profile.business_phone) relevanceScore += 10;
  if (profile.business_address_street || profile.business_address_city) {
    relevanceScore += 10;
  }
  if (negativeHits.length) relevanceScore -= negativeHits.length * 20;
  relevanceScore = clamp(relevanceScore, 0, 100);

  const { countryCode, countryName } = resolveCountry(countryInput);
  let countryConfidence = 0;
  if (
    countryCode &&
    profile.business_address_country_code &&
    countryCode === profile.business_address_country_code.toUpperCase()
  ) {
    countryConfidence += 70;
  }
  if (
    countryName &&
    [bio, fullName, profile.business_address_city, profile.business_address_region]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(countryName.toLowerCase())
  ) {
    countryConfidence += 20;
  }
  if (
    countryCode &&
    profile.external_url &&
    profile.external_url.toLowerCase().includes(`.${countryCode.toLowerCase()}`)
  ) {
    countryConfidence += 15;
  }
  if (
    countryCode &&
    DIAL_CODES[countryCode] &&
    profile.business_phone &&
    String(profile.business_phone).startsWith(DIAL_CODES[countryCode])
  ) {
    countryConfidence += 20;
  }
  countryConfidence = clamp(countryConfidence, 0, 100);

  let leadStatus = "rejected";
  let rejectionReason = "Does not look like a hospitality business.";
  if (relevanceScore >= 60 && countryConfidence >= 40) {
    leadStatus = "matched";
    rejectionReason = null;
  } else if (relevanceScore >= 50) {
    leadStatus = "possible";
    rejectionReason = "Hospitality relevance is plausible but country confidence is weak.";
  } else if (negativeHits.length) {
    rejectionReason = `Negative signals: ${negativeHits.join(", ")}`;
  }

  return {
    username: profile.username,
    profile_url: profile.profile_url,
    full_name: profile.full_name,
    external_url: profile.external_url,
    biography: profile.biography,
    business_category: profile.business_category,
    business_email: profile.business_email,
    business_phone: profile.business_phone,
    business_address_street: profile.business_address_street,
    business_address_city: profile.business_address_city,
    business_address_region: profile.business_address_region,
    business_address_postcode: profile.business_address_postcode,
    business_address_country_code: profile.business_address_country_code,
    is_professional_account: profile.is_professional_account ? 1 : 0,
    followers_count: profile.followers_count,
    following_count: profile.following_count,
    post_count: profile.post_count,
    profile_image_url: profile.profile_image_url,
    matched_hospitality_type: matchedType,
    country_confidence: countryConfidence,
    relevance_score: relevanceScore,
    lead_status: leadStatus,
    rejection_reason: rejectionReason,
    discovered_from_hashtag: discoveredFromHashtag,
    raw_json: JSON.stringify(profile.raw || {}),
  };
}

function inferHospitalityType(text) {
  const normalized = String(text || "").toLowerCase();
  return HOSPITALITY_TYPES.find((term) => normalized.includes(term)) || null;
}

function resolveCountry(countryInput) {
  const raw = String(countryInput || "").trim();
  if (!raw) return { countryCode: null, countryName: null };
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const code = raw.toUpperCase();
    const display = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return { countryCode: code, countryName: display || code };
  }

  const names = new Intl.DisplayNames(["en"], { type: "region" });
  for (const code of ISO_CODES) {
    const display = names.of(code);
    if (display && display.toLowerCase() === raw.toLowerCase()) {
      return { countryCode: code, countryName: display };
    }
  }

  return { countryCode: null, countryName: raw };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const ISO_CODES = [
  "AE","AR","AT","AU","BE","BG","BR","CA","CH","CL","CN","CO","CY","CZ","DE","DK","EE","EG","ES","FI","FR","GB","GR","HK","HR","HU","ID","IE","IL","IN","IS","IT","JP","KR","LT","LU","LV","MT","MX","MY","NL","NO","NZ","PE","PH","PL","PT","RO","RS","SA","SE","SG","SI","SK","TH","TR","TW","UA","US","VN","ZA"
];

module.exports = { classifyHospitalityLead };
