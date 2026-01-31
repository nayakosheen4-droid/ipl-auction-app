const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const ExcelJS = require('exceljs');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// Constants
const DATA_PATH = path.join(__dirname, '../data/auction_data.xlsx');
const TEAMS = [
  { id: 1, name: 'Mumbai Indians', password: 'mi2024', budget: 100, color: '#004BA0' },
  { id: 2, name: 'Chennai Super Kings', password: 'csk2024', budget: 100, color: '#FDB913' },
  { id: 3, name: 'Royal Challengers Bangalore', password: 'rcb2024', budget: 100, color: '#EC1C24' },
  { id: 4, name: 'Kolkata Knight Riders', password: 'kkr2024', budget: 100, color: '#3A225D' },
  { id: 5, name: 'Delhi Capitals', password: 'dc2024', budget: 100, color: '#004C93' },
  { id: 6, name: 'Punjab Kings', password: 'pbks2024', budget: 100, color: '#DD1F2D' },
  { id: 7, name: 'Rajasthan Royals', password: 'rr2024', budget: 100, color: '#254AA5' },
  { id: 8, name: 'Sunrisers Hyderabad', password: 'srh2024', budget: 100, color: '#FF822A' }
];

// In-memory state
let auctionState = {
  currentPlayer: null,
  currentBid: 0,
  currentBidder: null,
  teamsOut: [],
  auctionActive: false,
  teams: JSON.parse(JSON.stringify(TEAMS)) // Deep copy
};

// WebSocket clients
let clients = new Map(); // teamId -> [WebSocket connections]

// Initialize Excel file if doesn't exist
async function initializeExcel() {
  if (!fs.existsSync(path.join(__dirname, '../data'))) {
    fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
  }

  if (!fs.existsSync(DATA_PATH)) {
    const workbook = new ExcelJS.Workbook();
    
    // Available Players Sheet
    const playersSheet = workbook.addWorksheet('Available Players');
    playersSheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Position', key: 'position', width: 20 },
      { header: 'Base Price', key: 'basePrice', width: 15 }
    ];

    // Sample players
    const samplePlayers = [
      { id: 1, name: 'Virat Kohli', position: 'Batsman', basePrice: 0.5 },
      { id: 2, name: 'Rohit Sharma', position: 'Batsman', basePrice: 0.5 },
      { id: 3, name: 'Jasprit Bumrah', position: 'Bowler', basePrice: 0.5 },
      { id: 4, name: 'Rashid Khan', position: 'All-rounder', basePrice: 0.5 },
      { id: 5, name: 'KL Rahul', position: 'Wicket-keeper', basePrice: 0.5 },
      { id: 6, name: 'Mohammed Shami', position: 'Bowler', basePrice: 0.5 },
      { id: 7, name: 'Hardik Pandya', position: 'All-rounder', basePrice: 0.5 },
      { id: 8, name: 'Ravindra Jadeja', position: 'All-rounder', basePrice: 0.5 },
      { id: 9, name: 'Rishabh Pant', position: 'Wicket-keeper', basePrice: 0.5 },
      { id: 10, name: 'Yuzvendra Chahal', position: 'Bowler', basePrice: 0.5 },
      { id: 11, name: 'Shikhar Dhawan', position: 'Batsman', basePrice: 0.5 },
      { id: 12, name: 'David Warner', position: 'Batsman', basePrice: 0.5 },
      { id: 13, name: 'AB de Villiers', position: 'Batsman', basePrice: 0.5 },
      { id: 14, name: 'Glenn Maxwell', position: 'All-rounder', basePrice: 0.5 },
      { id: 15, name: 'Kagiso Rabada', position: 'Bowler', basePrice: 0.5 },
      { id: 16, name: 'Jos Buttler', position: 'Wicket-keeper', basePrice: 0.5 },
      { id: 17, name: 'Pat Cummins', position: 'Bowler', basePrice: 0.5 },
      { id: 18, name: 'Trent Boult', position: 'Bowler', basePrice: 0.5 },
      { id: 19, name: 'Andre Russell', position: 'All-rounder', basePrice: 0.5 },
      { id: 20, name: 'Suryakumar Yadav', position: 'Batsman', basePrice: 0.5 }
    ];

    playersSheet.addRows(samplePlayers);

    // Sold Players Sheet
    const soldSheet = workbook.addWorksheet('Sold Players');
    soldSheet.columns = [
      { header: 'Player ID', key: 'playerId', width: 10 },
      { header: 'Player Name', key: 'playerName', width: 30 },
      { header: 'Position', key: 'position', width: 20 },
      { header: 'Team ID', key: 'teamId', width: 10 },
      { header: 'Team Name', key: 'teamName', width: 30 },
      { header: 'Final Price', key: 'finalPrice', width: 15 }
    ];

    await workbook.xlsx.writeFile(DATA_PATH);
    console.log('Excel file initialized with sample data');
  }
}

// Read available players
async function getAvailablePlayers() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(DATA_PATH);
  
  const playersSheet = workbook.getWorksheet('Available Players');
  const soldSheet = workbook.getWorksheet('Sold Players');
  
  const soldPlayerIds = new Set();
  soldSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) { // Skip header
      soldPlayerIds.add(row.getCell(1).value);
    }
  });

  const players = [];
  playersSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) { // Skip header
      const playerId = row.getCell(1).value;
      if (!soldPlayerIds.has(playerId)) {
        players.push({
          id: playerId,
          name: row.getCell(2).value,
          position: row.getCell(3).value,
          basePrice: row.getCell(4).value
        });
      }
    }
  });

  return players;
}

// Get sold players for a team
async function getTeamPlayers(teamId) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(DATA_PATH);
  
  const soldSheet = workbook.getWorksheet('Sold Players');
  const players = [];

  soldSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) { // Skip header
      const rowTeamId = row.getCell(4).value;
      if (rowTeamId === teamId) {
        players.push({
          playerId: row.getCell(1).value,
          playerName: row.getCell(2).value,
          position: row.getCell(3).value,
          finalPrice: row.getCell(6).value
        });
      }
    }
  });

  return players;
}

// Save sold player
async function saveSoldPlayer(player, teamId, teamName, finalPrice) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(DATA_PATH);
  
  const soldSheet = workbook.getWorksheet('Sold Players');
  soldSheet.addRow({
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    teamId: teamId,
    teamName: teamName,
    finalPrice: finalPrice
  });

  await workbook.xlsx.writeFile(DATA_PATH);
}

// Broadcast to all connected clients
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach((wsArray) => {
    wsArray.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'register') {
        const teamId = data.teamId;
        if (!clients.has(teamId)) {
          clients.set(teamId, []);
        }
        clients.get(teamId).push(ws);
        ws.teamId = teamId;
        
        // Send current state
        ws.send(JSON.stringify({
          type: 'state',
          state: auctionState
        }));
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  ws.on('close', () => {
    if (ws.teamId && clients.has(ws.teamId)) {
      const teamClients = clients.get(ws.teamId);
      const index = teamClients.indexOf(ws);
      if (index > -1) {
        teamClients.splice(index, 1);
      }
      if (teamClients.length === 0) {
        clients.delete(ws.teamId);
      }
    }
  });
});

// API Routes

// Login
app.post('/api/login', (req, res) => {
  const { teamName, password } = req.body;
  const team = TEAMS.find(t => t.name === teamName && t.password === password);
  
  if (team) {
    res.json({ 
      success: true, 
      team: { 
        id: team.id, 
        name: team.name, 
        color: team.color 
      } 
    });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Get available players
app.get('/api/players/available', async (req, res) => {
  try {
    const players = await getAvailablePlayers();
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get team players
app.get('/api/team/:teamId/players', async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const players = await getTeamPlayers(teamId);
    const team = auctionState.teams.find(t => t.id === teamId);
    res.json({ 
      players, 
      budget: team ? team.budget : 100 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Nominate player
app.post('/api/auction/nominate', async (req, res) => {
  try {
    const { playerId, teamId } = req.body;
    const players = await getAvailablePlayers();
    const player = players.find(p => p.id === playerId);

    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    if (auctionState.auctionActive) {
      return res.status(400).json({ error: 'Auction already in progress' });
    }

    auctionState = {
      currentPlayer: player,
      currentBid: player.basePrice,
      currentBidder: teamId,
      teamsOut: [],
      auctionActive: true,
      teams: auctionState.teams
    };

    broadcast({ type: 'auction_start', state: auctionState });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Place bid
app.post('/api/auction/bid', (req, res) => {
  try {
    const { teamId, increment } = req.body;

    if (!auctionState.auctionActive) {
      return res.status(400).json({ error: 'No active auction' });
    }

    const team = auctionState.teams.find(t => t.id === teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const newBid = auctionState.currentBid + increment;
    if (newBid > team.budget) {
      return res.status(400).json({ error: 'Insufficient budget' });
    }

    // Remove team from out list if they were out
    auctionState.teamsOut = auctionState.teamsOut.filter(id => id !== teamId);
    
    auctionState.currentBid = newBid;
    auctionState.currentBidder = teamId;

    broadcast({ type: 'bid_update', state: auctionState });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark team as out
app.post('/api/auction/out', async (req, res) => {
  try {
    const { teamId } = req.body;

    if (!auctionState.auctionActive) {
      return res.status(400).json({ error: 'No active auction' });
    }

    if (!auctionState.teamsOut.includes(teamId)) {
      auctionState.teamsOut.push(teamId);
    }

    // Check if all but one team is out
    const activeTeams = auctionState.teams.length - auctionState.teamsOut.length;
    
    if (activeTeams <= 1) {
      // Auction complete
      const winningTeam = auctionState.teams.find(t => t.id === auctionState.currentBidder);
      
      if (winningTeam) {
        winningTeam.budget -= auctionState.currentBid;
        
        await saveSoldPlayer(
          auctionState.currentPlayer,
          winningTeam.id,
          winningTeam.name,
          auctionState.currentBid
        );

        broadcast({ 
          type: 'auction_complete', 
          winner: winningTeam.name,
          player: auctionState.currentPlayer.name,
          price: auctionState.currentBid,
          teams: auctionState.teams
        });

        auctionState = {
          currentPlayer: null,
          currentBid: 0,
          currentBidder: null,
          teamsOut: [],
          auctionActive: false,
          teams: auctionState.teams
        };
      }
    } else {
      broadcast({ type: 'team_out', state: auctionState });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current auction state
app.get('/api/auction/state', (req, res) => {
  res.json(auctionState);
});

// Get all teams with budgets
app.get('/api/teams', (req, res) => {
  res.json(auctionState.teams.map(t => ({
    id: t.id,
    name: t.name,
    budget: t.budget,
    color: t.color
  })));
});

// Reset auction (admin function)
app.post('/api/auction/reset', (req, res) => {
  auctionState = {
    currentPlayer: null,
    currentBid: 0,
    currentBidder: null,
    teamsOut: [],
    auctionActive: false,
    teams: JSON.parse(JSON.stringify(TEAMS))
  };
  broadcast({ type: 'reset', state: auctionState });
  res.json({ success: true });
});

// Initialize and start server
initializeExcel().then(() => {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});

