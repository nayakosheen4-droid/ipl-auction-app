# IPL Auction App – Supported Features

## Authentication & access

- **Team login** – Each of the 10 IPL teams logs in with team name + password (e.g. Mumbai Indians / mi2026).
- **Admin login** – Separate Admin login (password via `ADMIN_PASSWORD` env) for full control; Admin is excluded from nomination order.
- **Session** – Login returns team/admin info; front-end keeps user in session until logout.

---

## Auction flow

- **Initialize auction order** – Admin (or first user) runs “Initialize Auction Order” to set a random nomination order for all 10 teams. Order is bidirectional (see below).
- **Nomination** – Current team nominates a player from the available list. Server checks: budget ≥ 0.5 Cr, squad size limits, position limits, overseas limit (max 4), and that the player is unsold.
- **Bidding** – Teams place bids in 0.5 / 1 / 1.5 / 2 Cr increments. Server enforces: bid &gt; current bid, team has enough budget, team is not “out” for this player.
- **Mark out** – Any team can mark itself “out” for the current player; they no longer participate in that auction.
- **Countdown timer** – When only one team remains in the bid, a 30-second timer starts. If it reaches zero, that team wins at the current bid. Timer is broadcast in real time.
- **Admin complete auction** – Admin can award the player to a selected team at a chosen price (e.g. to resolve ties or technical issues) without waiting for the timer.
- **Reset current auction** – Admin can reset only the current nomination (clear bid, teams out, timer) and keep nomination order and sold players.
- **Bidirectional nomination order** – After the last team nominates, the order reverses (snake style); when it reaches the first team again, it reverses back. Teams that can’t nominate (e.g. no budget, squad full) are skipped automatically.

---

## Right to Match (RTM)

- **RTM eligibility** – When a player is sold, their **franchise** (previous IPL team) gets one Right to Match: they can match the winning bid and take the player back (if they have budget and haven’t already used RTM this auction).
- **RTM phase** – After a sale, if the franchise is eligible, the UI shows “Use RTM” / “Decline” with a 30-second countdown. Use RTM = franchise gets the player at the same price; Decline = original winning team keeps the player.
- **Auto-decline** – If the franchise does nothing before the RTM timer ends, RTM is declined and the original winner keeps the player.
- **One RTM per team** – Each team can use RTM only once per auction (tracked in Excel and in memory).

---

## Admin controls (during auction)

- **Mark team out / unmark** – Admin can mark any team “out” for the current player (except the current highest bidder), or unmark them so they’re back in. Unmarking can stop the countdown if more than one team is in again.
- **Full reset** – Clears all sold players from Excel, resets in-memory state (budgets, RTM, nomination order, etc.). Used to restart the whole auction from scratch.
- **Download Excel** – Serves the current `auction_data.xlsx` (Available Players, Sold Players, team data, etc.) for backup or offline use.
- **View as team** – Admin can use “View Team…” to open the auction as if they were a specific team (for testing or helping).

---

## Players & data

- **Player pool** – Players are stored in Excel (`data/auction_data.xlsx`), sheet “Available Players”: ID, Name, Position, Base Price, Franchise ID, Overseas. Sample IPL 2026 squad data is created if the file doesn’t exist.
- **Available / sold** – “Available Players” minus “Sold Players” (by ID) = list of unsold players. Sold players appear in “Sold Players” with Team, Price, RTM used, etc.
- **Filters** – UI: filter by position (Batsman, Bowler, All-rounder, Wicket-keeper) and search by player name.
- **Views** – Unsold Players, Sold Players, All Teams (with squad and budget). Teams view shows each team’s bought players and remaining budget.

---

## Real-time & persistence

- **WebSocket** – Single WebSocket for all clients. Teams register with `teamId`; they receive live state updates (nomination, bids, timer, RTM, turn change, team out/unmark).
- **Chat** – In-app live chat. Messages include team name and timestamp; last 30 minutes kept and sent to new joiners; cleaned every 5 minutes.
- **Online indicator** – Right panel (or teams list) shows which teams are currently connected.
- **Excel persistence** – Sold players, team spending, and RTM usage are read from and written to Excel. On server restart, team budgets and RTM flags are reloaded from Excel. Optional: use a Railway (or other) volume for `data/` so the file persists across deploys.

---

## Fantasy League (post-auction)

- **Fantasy League entry** – From the main auction screen, “Fantasy League” opens the fantasy UI (separate page). Accessible to all logged-in teams and Admin.
- **Gameweeks** – Admin sets current gameweek and status (Upcoming / Active / Completed). Leaderboard and “My Team” performance are per gameweek.
- **Leaderboard** – Per-gameweek ranking of teams by total fantasy points (sum of their bought players’ points in that gameweek). Expandable to show which players contributed.
- **My Team performance** – For the logged-in team: total points for the selected gameweek and per-player breakdown (runs, wickets, catches, etc. and fantasy points).
- **Schedule view** – All users can open “Schedule” and load the match list for a season (IPL 2025/2024). Fetched from Cricketdata.org (no scorecard editing here).
- **Admin: match results & leaderboard** – Admin can: set gameweek/status; load schedule; select a match and fetch scorecard (Cricketdata.org); add that match’s player performances to the “Player Performance” sheet and thus to fantasy points for the current gameweek. One “Add to leaderboard” action per match.
- **Auto-stats (optional)** – If `CRICKETDATA_API_KEY` is set, an optional cron/service can periodically fetch match data and update fantasy points. Admin can toggle it, trigger “Fetch Now”, set gameweek/season, and clear cache. Schedule and scorecard APIs are used for IPL 2025.

---

## API summary (for reference)

| Area        | Endpoints / behaviour |
|------------|------------------------|
| Auth        | `POST /api/login` |
| Players     | `GET /api/players/available`, `GET /api/players/sold`, `GET /api/team/:teamId/players` |
| Teams       | `GET /api/teams`, `GET /api/teams/detailed` |
| Auction     | `GET /api/auction/state`, `POST /api/auction/initialize`, `POST /api/auction/nominate`, `POST /api/auction/bid`, `POST /api/auction/out`, `POST /api/auction/reset`, `POST /api/auction/rtm`, `POST /api/admin/complete-auction` |
| Admin       | `GET /api/admin/download-excel` |
| Fantasy     | `GET /api/fantasy/gameweek/current`, `POST /api/fantasy/gameweek`, `POST /api/fantasy/performance`, `GET /api/fantasy/leaderboard/:gameweek`, `GET /api/fantasy/team/:teamId/gameweek/:gameweek` |
| Auto-stats  | `GET /api/autostats/status`, `POST /api/autostats/toggle`, `POST /api/autostats/fetch`, `POST /api/autostats/gameweek`, `POST /api/autostats/season`, `POST /api/autostats/clear-cache`, `GET /api/autostats/match/:matchId/scorecard`, `GET /api/autostats/schedule`, `GET /api/autostats/matches` |

WebSocket message types used for real-time updates include: `register`, `state`, `chat`, `chat_history`, `admin_reset_auction`, `admin_full_reset`, `admin_mark_team_out`, `admin_unmark_team_out`, `mark_back_in`, `team_out`, `team_unmarked`, `team_marked_back_in`, `turn_change`, `timer_start`, `timer_tick`, `rtm_timer_start`, `rtm_timer_tick`, and `full_reset`.

---

## UI / UX

- **Responsive layout** – Main auction: left (players/teams), center (current auction + admin), right (budget/chat). Stacks on small screens.
- **View My Team** – Modal showing your squad and remaining budget.
- **Toast notifications** – Success/error/info toasts for login, bid, RTM, errors.
- **Health check** – `health.html` for basic connectivity/service checks (e.g. for Railway or monitoring).

---

## Deployment & config

- **Environment** – `PORT`, `ADMIN_PASSWORD`, `CRICKETDATA_API_KEY` (optional, for schedule/scorecard and auto-stats), `IPL_SEASON` (e.g. 2025).
- **Static files** – Served from `public/` (e.g. `index.html`, `fantasy.html`, `app.js`, `styles.css`, `fantasy.js`, `fantasy-styles.css`).
- **Data directory** – `data/auction_data.xlsx` created on first run if missing; recommend mounting a volume at `data/` in production so state survives restarts.

---

*This list reflects the codebase as of the last review. For exact API request/response shapes, see `server/index.js` and the WebSocket handler.*
