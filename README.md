# instagram-hospitality-scraper

Instagram hospitality lead scraper built in the same long-running dashboard style as the other `lutzkind` country scrapers.

## What it does

- accepts a `country + hospitality type + hashtags` for discovery mode
- accepts `country + hospitality type + usernames/profile URLs` for safe mode
- creates resumable hashtag discovery jobs in SQLite
- discovers candidate profiles from hashtags when `IG_SESSION_ID` is configured
- extracts known public profile targets in safe mode without needing an Instagram session
- extracts public profile-level business fields from Instagram's `web_profile_info` JSON endpoint
- filters out obvious creators / influencers and scores hospitality relevance
- assigns a country confidence score
- persists jobs, shards, and leads in SQLite
- exports CSV and JSON artifacts when a job finishes
- exposes a built-in dashboard for job creation, inspection, and downloads

## Important architecture choice

This service intentionally does **not** scrape target websites.

It only collects Instagram profile-level lead fields such as:

- `username`
- `full_name`
- `external_url`
- `biography`
- `business_category`
- `business_email`
- `business_phone`
- `business_address_*`
- follower/following/post counts

## Safe vs discovery behavior

### Public profile extraction

Profile extraction uses:

`GET /api/v1/users/web_profile_info/?username=...`

with the public Instagram web app id header.

That part does **not** require login.

### Hashtag discovery

Hashtag discovery is the risky part and requires:

- `IG_SESSION_ID`

Without `IG_SESSION_ID`, discovery jobs still run but hashtag shards will not discover any profiles.
Safe mode does not need `IG_SESSION_ID`.

This split is deliberate:

- public extraction path is clean and lower risk
- authenticated discovery stays isolated and optional

## Lead scoring

The classifier keeps the scraper narrow for hospitality:

- positive signals:
  - hospitality category / bio matches
  - professional account
  - external URL
  - business email / phone / address
- negative signals:
  - creator / influencer / UGC style bios
  - obvious personal-brand wording

The output includes:

- `relevance_score`
- `country_confidence`
- `lead_status` (`matched`, `possible`, `rejected`)
- `rejection_reason`

## API

### Operator dashboard

`http://localhost:3000/dashboard`

### Create job

```bash
curl -X POST http://localhost:3000/jobs \
  -b cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{
    "country": "United States",
    "keyword": "restaurant",
    "hashtags": "restaurants,dining,food",
    "mode": "discovery"
  }'
```

### Get job

```bash
curl -b cookies.txt http://localhost:3000/jobs/<jobId>
```

### List shards

```bash
curl -b cookies.txt 'http://localhost:3000/jobs/<jobId>/shards?limit=50&offset=0'
```

### List leads

```bash
curl -b cookies.txt 'http://localhost:3000/jobs/<jobId>/leads?limit=100&offset=0'
```

### Download artifacts

```bash
curl -b cookies.txt -L 'http://localhost:3000/jobs/<jobId>/download?format=csv' -o leads.csv
curl -b cookies.txt -L 'http://localhost:3000/jobs/<jobId>/download?format=json' -o leads.json
```

## Environment

- `PORT` default `3000`
- `DATA_DIR` default `./data`
- `DB_PATH` default `./data/instagram-hospitality-scraper.db`
- `EXPORTS_DIR` default `./data/exports`
- `ADMIN_USERNAME` dashboard username
- `ADMIN_PASSWORD` dashboard password
- `SESSION_COOKIE_NAME` dashboard session cookie name
- `IG_APP_ID` default `936619743392459`
- `IG_SESSION_ID` optional Instagram session for hashtag discovery
- `IG_PROXY_URL` optional proxy for authenticated discovery
- `IG_REQUEST_DELAY_MS` default `2500`
- `IG_DISCOVERY_MAX_PROFILES_PER_HASHTAG` default `50`
- `IG_DISCOVERY_SCROLL_STEPS` browser fallback scroll passes
- `IG_DISCOVERY_POST_SAMPLE_LIMIT` post sample limit in browser fallback
- `CHROMIUM_PATH` default `/usr/bin/chromium`

## Run locally

```bash
npm install
ADMIN_USERNAME=admin ADMIN_PASSWORD=secret123 PORT=8094 node index.js
```

If you want hashtag discovery:

```bash
IG_SESSION_ID=your_session_cookie_here \
ADMIN_USERNAME=admin \
ADMIN_PASSWORD=secret123 \
node index.js
```

## Docker

```bash
docker build -t instagram-hospitality-scraper .
docker run -p 3000:3000 -v $(pwd)/data:/app/data instagram-hospitality-scraper
```

## Coolify

- **Build pack:** Dockerfile
- **Port:** `3000`
- **Persistent storage:** mount a writable volume to `/app/data`
