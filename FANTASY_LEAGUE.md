# 🏆 IPL Fantasy League Guide

## Overview
After the auction completes, you can play a fantasy league using your purchased teams! Track player performance, calculate points using Dream11-style scoring, and compete on the leaderboard.

## How It Works

### 1. Gameweeks
- **Gameweek (GW)** = One round where all teams play a match
- Example: GW1 = Each team's first match
- Admin sets active gameweek and manages progression

### 2. Player Stats & Scoring
- Admin enters real match statistics for each player
- System automatically calculates fantasy points
- Uses official Dream11-style scoring formula

### 3. Leaderboard
- View all teams ranked by total fantasy points
- See individual player contributions
- Compare your team against rivals

## Dream11-Style Scoring Formula

### Batting Points
- **1 point** per run scored
- **1 point** per boundary (4)
- **2 points** per six
- **4 points** for 30+ runs
- **8 points** for 50+ runs
- **16 points** for century (100+ runs)
- **-2 points** for duck (0 runs when out) - Batsman/WK only

### Bowling Points
- **25 points** per wicket
- **8 bonus points** for LBW/Bowled dismissal
- **4 points** for 3-wicket haul
- **8 points** for 4-wicket haul
- **16 points** for 5-wicket haul
- **12 points** per maiden over

### Fielding Points
- **8 points** per catch
- **12 points** per stumping (Wicket-keeper only)
- **12 points** for direct run out
- **6 points** for indirect run out

### Strike Rate Bonus (Min 10 balls faced)
- **6 points** for SR > 170
- **4 points** for SR 150-170
- **-2 points** for SR < 70
- **-4 points** for SR < 50

### Economy Rate Bonus (Min 2 overs bowled)
- **6 points** for ER < 5
- **4 points** for ER 5-6
- **-2 points** for ER 9-10
- **-4 points** for ER > 11

## User Guide

### Accessing Fantasy League
1. Login to auction app
2. Click **"🏆 Fantasy League"** button in header
3. Opens fantasy league interface

### Viewing Leaderboard
1. Click **"🏆 Leaderboard"** tab
2. Select gameweek from dropdown
3. See all teams ranked by points
4. Click team to expand and see player breakdown

### Viewing Your Team
1. Click **"👥 My Team"** tab
2. Select gameweek
3. See your total points
4. See individual player performance with detailed stats

## Admin Guide

### Setting Up Gameweek
1. Login as Admin
2. Go to Fantasy League → Admin tab
3. Enter gameweek number (1, 2, 3, etc.)
4. Set status:
   - **Upcoming**: Not started yet
   - **Active**: Currently ongoing
   - **Completed**: Finished
5. Click **"Set Gameweek"**

### Entering Player Stats
After a match is played in real IPL:

1. Go to Admin tab
2. Enter **Match ID** (e.g., "MI_vs_CSK_GW1")
3. Select **Gameweek** number
4. **Select Player** from dropdown (shows all sold players)
5. **Enter Statistics:**
   - Batting: Runs, Balls, 4s, 6s
   - Bowling: Wickets, Overs, Runs Conceded, Maidens
   - Fielding: Catches, Stumpings, Run Outs
6. Click **"Calculate Points"** to preview
7. Click **"Submit Stats"** to save

Points are automatically calculated and leaderboard updates instantly!

### Workflow for Each Gameweek

**Before Gameweek:**
1. Set gameweek as "Active"
2. Notify teams that gameweek has started

**During Gameweek:**
1. Watch real IPL matches
2. Enter player stats as matches complete
3. Players and teams see points updating in real-time

**After Gameweek:**
1. Ensure all match stats are entered
2. Set gameweek as "Completed"
3. Create next gameweek and set as "Active"

## Data Management

### Excel Sheets Added
Three new sheets in `auction_data.xlsx`:

**1. Gameweeks**
- Gameweek number
- Status (Upcoming/Active/Completed)
- Start/End dates

**2. Matches** (Reserved for future use)
- Match details
- Teams playing
- Winners

**3. Player Performance**
- Match ID and Gameweek
- Player ID and name
- All performance stats
- Calculated fantasy points

### Backup Data
- Use **"📥 Download Excel File"** button in admin panel
- Download before/after each gameweek
- Backup contains all auction + fantasy data

## Features Summary

✅ **Gameweek System**: Organize matches by gameweek number
✅ **Dream11 Scoring**: Official Dream11-style point calculation
✅ **Real-time Updates**: All users see points as they're entered
✅ **Leaderboard**: Rank all teams by performance
✅ **Detailed Stats**: View individual player contributions
✅ **Admin Controls**: Easy stats entry interface
✅ **Mobile Responsive**: Works on all devices
✅ **Data Persistence**: All stats saved to Excel

## API Endpoints

### Fantasy League APIs
- `GET /api/fantasy/gameweek/current` - Get current gameweek
- `POST /api/fantasy/gameweek` - Create/update gameweek
- `POST /api/fantasy/performance` - Submit player stats
- `GET /api/fantasy/leaderboard/:gameweek` - Get leaderboard
- `GET /api/fantasy/team/:teamId/gameweek/:gameweek` - Get team performance

## Tips & Best Practices

### For Admin:
- Enter stats immediately after each match
- Double-check statistics before submitting
- Use "Calculate Points" to verify before submitting
- Download Excel file after each gameweek
- Set gameweek status appropriately

### For Teams:
- Check leaderboard regularly
- Track your position throughout gameweek
- Compare your players with rivals
- Plan strategy for future auctions based on performance

### For Competition:
- Run gameweeks matching real IPL schedule
- Create excitement by announcing leader after each GW
- Consider prizes for overall winner
- Use chat to discuss player performances

## Future Enhancements
- Auto-import stats from cricket APIs
- Match-by-match breakdown
- Player comparison tool
- Historical performance graphs
- Weekly/seasonal winner announcements
- Points prediction based on upcoming matches

## Troubleshooting

### Stats not showing up:
- Ensure gameweek number matches
- Check if player was sold in auction
- Verify Match ID is consistent

### Points calculation seems wrong:
- Review the scoring formula above
- Check if all stats were entered correctly
- Strike Rate/Economy bonuses need minimum balls/overs

### Leaderboard empty:
- Ensure stats have been entered for that gameweek
- Check current gameweek is set correctly
- Refresh the page

---

**Your auction app is now a complete fantasy league platform! 🎉**
