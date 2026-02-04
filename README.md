# 🏏 IPL Auction & Fantasy League

A complete real-time web-based IPL auction and fantasy league platform with automatic stats fetching from real IPL matches!

## Features

✨ **Auction Features:**
- 🎯 **Player Nomination**: Select players from Excel database and nominate them for auction
- 💰 **Live Bidding**: Real-time bidding with increments of ₹0.5, ₹1, ₹1.5, or ₹2 Cr
- 📊 **Budget Tracking**: Track each team's remaining budget in real-time
- 🚫 **Out System**: Teams can mark themselves out; last team standing wins the player
- 👥 **Team Management**: View your current team roster and spending
- 🔐 **Multi-user Login**: Multiple users can login to the same team with a shared password
- ⚡ **Real-time Updates**: WebSocket-based live updates for all participants
- 🎴 **RTM (Right to Match)**: Franchise teams can use their RTM card once to match the winning bid
- 🔧 **Admin Panel**: Admin access to manually award players for testing
- 🛡️ **Smart Bidding**: Prevents teams from bidding on their own highest bid
- 🔄 **Turn-Based System**: Random nomination order with position restrictions

🏆 **Fantasy League Features:**
- 🤖 **Auto Stats Fetching**: Automatically pulls player stats from real IPL matches
- 📈 **Dream11 Scoring**: Official Dream11-style fantasy point calculation
- 🎮 **Gameweek System**: Organize matches by gameweek
- 🏅 **Live Leaderboard**: Real-time team rankings with detailed player breakdown
- 📊 **Performance Tracking**: View individual player stats and points
- 🔔 **Real-time Notifications**: Get notified when stats are updated
- 🌐 **Cricket API Integration**: Free API with 100 calls/day
- 💾 **Auto Database Updates**: Stats saved to Excel automatically

🎁 **Additional Features:**
- 🎨 Modern, beautiful UI with team colors
- 📱 Fully responsive mobile design
- 🔍 Player search and filtering by position
- 💬 Real-time chat during auctions
- ⏱️ Automatic countdown timers
- 📥 Excel file download for backups
- 🔄 Full auction data management

## Tech Stack

- **Backend**: Node.js, Express, WebSocket (ws), node-cron
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Database**: Excel (using ExcelJS library)
- **Real-time**: WebSocket for live bidding updates
- **API Integration**: Cricket Data API (cricketdata.org)
- **Automation**: Scheduled jobs for auto stats fetching

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- Cricket API key (optional, for auto-stats - [Get FREE key](https://cricketdata.org/signup.aspx))

### Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Start the server:**
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

3. **Access the application:**
Open your browser and navigate to:
```
http://localhost:3000
```

### 🤖 Enable Auto-Stats (Optional but Recommended)

To enable automatic stats fetching from real IPL matches:

1. **Get FREE API Key:**
   - Visit [cricketdata.org/signup.aspx](https://cricketdata.org/signup.aspx)
   - Sign up with your email (free forever - 100 API calls/day)
   - Check email for your API key

2. **Set Environment Variable:**
   ```bash
   export CRICKET_API_KEY="your_api_key_here"
   ```

3. **For Railway/Render deployment:**
   - Add `CRICKET_API_KEY` in environment variables
   - Service will automatically restart with auto-stats enabled

4. **Verify:**
   - Login as Admin
   - Go to Fantasy League → Admin tab
   - Check "API Key: ✓ Configured"

📖 **Full Setup Guide:** See [AUTO_STATS_SETUP.md](./AUTO_STATS_SETUP.md) for detailed instructions

## Usage

### Login
1. Select your team from the dropdown
2. Enter the team password
3. Click "Join Auction"

**Default Passwords:**
- Mumbai Indians: `mi2024`
- Chennai Super Kings: `csk2024`
- Royal Challengers Bangalore: `rcb2024`
- Kolkata Knight Riders: `kkr2024`
- Delhi Capitals: `dc2024`
- Punjab Kings: `pbks2024`
- Rajasthan Royals: `rr2024`
- Sunrisers Hyderabad: `srh2024`
- **Admin**: `admin2024`

### Starting an Auction
1. Browse available players in the left panel
2. Use filters to search by position or name
3. Click on a player to nominate them for auction
4. Auction starts with base price of ₹0.5 Cr

### Bidding
1. When auction is active, use the bid buttons to increase your offer
2. Choose increment: +0.5 Cr, +1 Cr, +1.5 Cr, or +2 Cr
3. Your budget is automatically checked before allowing bids
4. Click "Mark Out" when you want to stop bidding

### Winning a Player
- When all teams except one have marked "Out", the auction ends
- The last bidding team wins the player
- Player is automatically added to the team's roster
- Budget is deducted from the winning team
- Player is removed from available players list

### Viewing Your Team
- Click "View My Team" button in the header
- See all your purchased players
- View remaining budget and total spent
- Track team composition by position

### RTM (Right to Match)
- Players are assigned to franchise teams
- When a player's auction ends, their franchise team gets an RTM opportunity
- The franchise team can match the winning bid to acquire the player
- Each team can use RTM only once during the entire auction
- RTM option appears only if:
  - Team hasn't used RTM yet
  - Team is not the current winning bidder
  - Team has sufficient budget

### Admin Features
- Login with Admin credentials to access admin panel
- Manually award any player to any team during testing
- Useful for quickly testing different auction scenarios
- Admin can see all auction activity but cannot bid

## Excel Database Structure

The application automatically creates an Excel file at `data/auction_data.xlsx` with two sheets:

### Available Players Sheet
| Column | Description |
|--------|-------------|
| ID | Unique player identifier |
| Name | Player name |
| Position | Batsman/Bowler/All-rounder/Wicket-keeper |
| Base Price | Starting price for auction (₹0.5 Cr) |
| Franchise ID | Team ID of franchise team (for RTM) |

### Sold Players Sheet
| Column | Description |
|--------|-------------|
| Player ID | Reference to player ID |
| Player Name | Name of the sold player |
| Position | Player position |
| Team ID | ID of the team that bought the player |
| Team Name | Name of the team |
| Final Price | Winning bid amount |
| RTM Used | Whether RTM card was used (Yes/No) |

## Configuration

### Changing Team Passwords
Edit the `TEAMS` constant in `server/index.js`:

```javascript
const TEAMS = [
  { id: 1, name: 'Mumbai Indians', password: 'your_password', budget: 100, color: '#004BA0' },
  // ... other teams
];
```

### Changing Initial Budget
Modify the `budget` value in the `TEAMS` array (default: ₹100 Cr)

### Changing Base Price
Edit the base price in the sample players array or modify directly in Excel

### Adding More Players
1. Stop the server
2. Open `data/auction_data.xlsx`
3. Add rows to "Available Players" sheet
4. Save and restart the server

## API Endpoints

### Authentication
- `POST /api/login` - Team login

### Players
- `GET /api/players/available` - Get all available players
- `GET /api/team/:teamId/players` - Get team's purchased players

### Auction
- `POST /api/auction/nominate` - Nominate a player for auction
- `POST /api/auction/bid` - Place a bid
- `POST /api/auction/out` - Mark team as out
- `POST /api/auction/rtm` - Use or decline RTM card
- `GET /api/auction/state` - Get current auction state
- `POST /api/auction/reset` - Reset auction (admin)

### Admin
- `POST /api/admin/complete-auction` - Manually complete auction and award player

### Teams
- `GET /api/teams` - Get all teams with budgets

## WebSocket Events

### Client → Server
```json
{
  "type": "register",
  "teamId": 1
}
```

### Server → Client
- `state` - Current auction state
- `auction_start` - New auction started
- `bid_update` - Bid placed
- `team_out` - Team marked out
- `rtm_opportunity` - RTM card available for franchise team
- `auction_complete` - Player sold (with RTM status)
- `reset` - Auction reset

## Troubleshooting

### Port Already in Use
Change the port in `server/index.js`:
```javascript
const PORT = process.env.PORT || 3001; // Change 3000 to 3001
```

### WebSocket Connection Issues
Ensure your firewall allows WebSocket connections on the server port.

### Excel File Locked
Close the Excel file if you have it open while the server is running.

## Future Enhancements

- 🎥 Video conferencing integration
- ⏱️ Auction timer for faster bidding
- 📊 Analytics dashboard
- 🎮 Admin panel for auction control
- 📱 Mobile app version
- 🔐 Enhanced authentication
- 💬 Chat functionality
- 📤 Export final teams as PDF

## License

MIT License - feel free to use and modify!

## Support

For issues or questions, please open an issue on the repository.

---

**Happy Bidding! 🏏🎉**

