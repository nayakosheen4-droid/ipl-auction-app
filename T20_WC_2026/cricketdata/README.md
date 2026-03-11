# Cricket Data API – Fantasy Points (same output as JSON flow)

This folder builds the **same Excel output** as the main JSON-based flow, but using the [Cricket Data API](https://cricketdata.org/how-to-use-cricket-data-api.aspx) instead of Cricsheet JSON files.

## Setup

1. **API key**  
   Sign up at [cricketdata.org/signup.aspx](https://cricketdata.org/signup.aspx) and get your API key.

2. **Config**  
   Edit `cricketdata/config.json`:
   - `seriesId`: e.g. `0cdf6736-ad9b-4e95-a647-5ee3a99c5510` (ICC Men's T20 World Cup 2026)
   - `apiKey`: your API key
   - `baseUrl`: API base URL from your dashboard (e.g. `https://api.cricapi.com/v1`). If requests fail, check the docs for the correct base URL.

   Or use environment variables:
   - `CRICKETDATA_SERIES_ID`
   - `CRICKETDATA_API_KEY`
   - `CRICKETDATA_BASE_URL`

3. **Auction file**  
   The main folder’s `ICC T20 WC 2026 Auction Game.xlsx` is used for group sheets. Keep it at the project root.

## Commands

From the **project root** (not inside `cricketdata`):

```bash
# 1) Build Fantasy Points sheet from API
node cricketdata/build-fantasy-from-api.js

# 2) Add Group 1–8 sheets, Playing XI columns, Total and Round Total rows
node cricketdata/run-group-sheets.js
```

Or run step 2 manually with env vars:

```bash
FANTASY_WORKBOOK_PATH=./cricketdata/Fantasy_Points_T20WC_2025_26.xlsx \
OUTPUT_WORKBOOK_PATH=./cricketdata/Fantasy_Points_T20WC_2025_26.xlsx \
AUCTION_WORKBOOK_PATH=./ICC\ T20\ WC\ 2026\ Auction\ Game.xlsx \
node scripts/add-group-sheets.js

FANTASY_WORKBOOK_PATH=./cricketdata/Fantasy_Points_T20WC_2025_26.xlsx \
node scripts/add-playing-xi-columns.js

FANTASY_WORKBOOK_PATH=./cricketdata/Fantasy_Points_T20WC_2025_26.xlsx \
node scripts/add-total-row-to-group-sheets.js
```

## Output

- **`cricketdata/Fantasy_Points_T20WC_2025_26.xlsx`**  
  Same structure as the main workbook: Fantasy Points sheet, Group 1–8 with Playing XI and Round columns, Total row, Round Total row, and Playing XI count in the Total row.

## API endpoints (CricAPI)

- **Series list**  
  `GET {baseUrl}/series_info?apikey={key}&offset=0&id={seriesId}`  
  Response: `{ "status": "success", "data": { "info": { ... }, "matchList": [ { "id", "name", "teams", "date", "dateTimeGMT", "venue", "status", ... } ] } }`.

- **Match scorecard (fantasy)**  
  `GET {baseUrl}/match_scorecard?apikey={key}&offset=0&id={matchId}`  
  Response: `{ "status": "success", "data": { "id", "name", "teams", "score", "scorecard": [ { "batting", "bowling", "catching", "inning" }, ... ] } }`. Used for player-level fantasy points. Unplayed or future matches may return "Scorecard not found". Respect API rate limits (e.g. 500–1000 ms between requests).

- If your API differs, adjust `api.js` (URLs/params) and `normalizeMatch.js` (response → `{ info, innings }` or `{ info, stats }`).

## Security

Do **not** commit a real API key. Prefer environment variables (`CRICKETDATA_API_KEY`) or add `cricketdata/config.json` to `.gitignore` if it contains the key.
