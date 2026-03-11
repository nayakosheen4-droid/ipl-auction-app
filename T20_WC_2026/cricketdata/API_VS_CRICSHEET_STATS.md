# API vs Cricsheet: Where score differences come from

Comparison for **same match** (India vs USA, 2026-02-07) and **same player** (Hardik Pandya / HH Pandya).

## Stats comparison

| Stat | Cricsheet (ball-by-ball) | API (match_scorecard) |
|------|--------------------------|------------------------|
| **Batting** | | |
| Runs | 5 | 5 |
| Balls | 6 | 6 |
| 4s | 1 | 1 |
| 6s | 0 | 0 |
| Dismissed | yes | yes |
| **Bowling** | | |
| Wickets | 0 | 0 |
| Runs conceded | 35 | 34 |
| Balls bowled | 25 | 24 |
| **Dot balls** | **8** | **Not provided** |

## What the API is missing

1. **Dot balls per bowler**  
   The CricAPI `match_scorecard` response does **not** include a dot-ball count per bowler. It only has `o` (overs), `m` (maidens), `r` (runs), `w` (wickets), `nb`, `wd`, `eco`.  
   In our fantasy scoring, **dots = 1 point each**. For this match, Cricsheet has 8 dots for Hardik → 8 extra points. So the from_api workbook undercounts bowling points for any bowler because dots are always 0 when built from the API.

2. **Minor run/ball differences**  
   One run (35 vs 34) and one ball (25 vs 24) difference—likely rounding or how wides/noballs are attributed. Small impact on economy points.

## Impact on fantasy total

- **From API** (no dots): ~13 points for Hardik in this match (playing 4 + batting 9 + bowling 0 + economy ~0).
- **From Cricsheet** (with 8 dots): ~21 points for the same stats plus 8 dot points (and possibly different economy if runs/balls differ).

So **the main stat missing in the cricketdata/CricAPI scorecard is dot balls**. Batting stats (runs, balls, fours, sixes, dismissed) and bowling totals (wickets, runs, overs) are present; only the **per-delivery** detail (dots, over-by-over runs for maiden logic) is not in the summary scorecard. Ball-by-ball data (Cricsheet) has that; the API’s aggregated scorecard does not.
