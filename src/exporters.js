const fs = require("fs");
const path = require("path");

function exportJobArtifacts({ store, config, jobId }) {
  const job = store.getJob(jobId);
  const leads = store.getJobLeads(jobId, { limit: 1_000_000, offset: 0 });
  const baseName = `${jobId}-${Date.now()}`;
  const csvPath = path.join(config.exportsDir, `${baseName}.csv`);
  const jsonPath = path.join(config.exportsDir, `${baseName}.json`);

  const headers = [
    "username",
    "profile_url",
    "full_name",
    "external_url",
    "biography",
    "business_category",
    "business_email",
    "business_phone",
    "business_address_street",
    "business_address_city",
    "business_address_region",
    "business_address_postcode",
    "business_address_country_code",
    "is_professional_account",
    "followers_count",
    "following_count",
    "post_count",
    "matched_hospitality_type",
    "country_confidence",
    "relevance_score",
    "lead_status",
    "rejection_reason",
    "discovered_from_hashtag",
  ];

  const rows = [
    headers.join(","),
    ...leads.map((lead) =>
      headers
        .map((header) => csvEscape(lead[header]))
        .join(",")
    ),
  ];

  fs.writeFileSync(csvPath, `${rows.join("\n")}\n`, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify({ job, leads }, null, 2), "utf8");

  return { csvPath, jsonPath };
}

function csvEscape(value) {
  if (value == null) return "";
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

module.exports = { exportJobArtifacts };
