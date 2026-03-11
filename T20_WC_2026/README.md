# T20 World Cup 2025/26 – Data & Scripts

This folder contains everything for the **ICC T20 World Cup 2026** fantasy and auction game: data, scripts, and workbooks. The rest of the repo is the **IPL Auction app** only.

## Contents

- **cricketdata/** – Cricket Data API integration: schedule, scorecards, fantasy scoring, and build script that produces the Fantasy Points workbook.
- **cricsheet/** – Cricsheet JSON data for the men’s T20 World Cup and script to update from it.
- **scripts/** – Excel helpers: add group sheets, refresh round points, add total row, compare round points, etc.
- **Workbooks**
  - `Fantasy_Points_T20WC_2025_26_from_api.xlsx` – Built by `cricketdata/build-fantasy-from-api.js`.
  - `Fantasy_Points_T20WC_2025_26.xlsx` – Alternate/snapshot fantasy workbook (used by some scripts).
  - `ICC T20 WC 2026 Auction Game.xlsx` – Main auction game workbook.
- **round-points-comparison-report.txt** – Report from `scripts/compare-round-points.js`.

## Running the T20 WC build

From the **repo root** (so `.env` and `node_modules` are available):

```bash
node T20_WC_2026/cricketdata/build-fantasy-from-api.js
```

The script will:

1. Use schedule and scorecards under `T20_WC_2026/cricketdata/` (and fetch missing ones if needed).
2. Write `Fantasy_Points_T20WC_2025_26_from_api.xlsx` into `T20_WC_2026/`.
3. Run `T20_WC_2026/scripts/add-group-sheets.js` and `add-total-row-to-group-sheets.js` as needed.

API keys are read from the repo root `.env` (or from `T20_WC_2026/.env` if you put a copy there). See `cricketdata/README.md` for Cricket Data API setup.

## Other scripts

Run from repo root, e.g.:

```bash
node T20_WC_2026/scripts/refresh-group-points.js
node T20_WC_2026/scripts/compare-round-points.js
```

These expect the workbooks and `cricketdata/schedule.json` to live inside `T20_WC_2026/` as they are now.
