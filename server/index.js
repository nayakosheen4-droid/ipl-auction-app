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
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    // Set proper content types
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
    
    // Disable caching for dynamic files to ensure users get latest version
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Constants
const DATA_PATH = path.join(__dirname, '../data/auction_data.xlsx');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2024';
const TEAMS = [
  { id: 1, name: 'Mumbai Indians', password: 'mi2024', budget: 100, color: '#004BA0', rtmUsed: false },
  { id: 2, name: 'Chennai Super Kings', password: 'csk2024', budget: 100, color: '#FDB913', rtmUsed: false },
  { id: 3, name: 'Royal Challengers Bangalore', password: 'rcb2024', budget: 100, color: '#EC1C24', rtmUsed: false },
  { id: 4, name: 'Kolkata Knight Riders', password: 'kkr2024', budget: 100, color: '#3A225D', rtmUsed: false },
  { id: 5, name: 'Delhi Capitals', password: 'dc2024', budget: 100, color: '#004C93', rtmUsed: false },
  { id: 6, name: 'Punjab Kings', password: 'pbks2024', budget: 100, color: '#DD1F2D', rtmUsed: false },
  { id: 7, name: 'Rajasthan Royals', password: 'rr2024', budget: 100, color: '#254AA5', rtmUsed: false },
  { id: 8, name: 'Sunrisers Hyderabad', password: 'srh2024', budget: 100, color: '#FF822A', rtmUsed: false }
];

// In-memory state
let auctionState = {
  currentPlayer: null,
  currentBid: 0,
  currentBidder: null,
  teamsOut: [],
  auctionActive: false,
  rtmPhase: false,
  rtmEligibleTeam: null,
  pendingWinner: null,
  pendingPrice: null,
  teams: JSON.parse(JSON.stringify(TEAMS)) // Deep copy
};

// WebSocket clients
let clients = new Map(); // teamId -> [WebSocket connections]

// Chat history (store last 30 minutes)
let chatHistory = [];
const CHAT_RETENTION_TIME = 30 * 60 * 1000; // 30 minutes in milliseconds

// Clean old chat messages
function cleanOldChatMessages() {
  const now = Date.now();
  chatHistory = chatHistory.filter(msg => {
    const msgTime = new Date(msg.timestamp).getTime();
    return (now - msgTime) < CHAT_RETENTION_TIME;
  });
}

// Clean chat messages every 5 minutes
setInterval(cleanOldChatMessages, 5 * 60 * 1000);

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
      { header: 'Base Price', key: 'basePrice', width: 15 },
      { header: 'Franchise ID', key: 'franchiseId', width: 15 }
    ];

    // Sample players with franchise assignments
    const samplePlayers = [
      { id: 1, name: 'Virat Kohli', position: 'Batsman', basePrice: 0.5, franchiseId: 3 },
      { id: 2, name: 'Rohit Sharma', position: 'Batsman', basePrice: 0.5, franchiseId: 1 },
      { id: 3, name: 'Jasprit Bumrah', position: 'Bowler', basePrice: 0.5, franchiseId: 1 },
      { id: 4, name: 'Rashid Khan', position: 'All-rounder', basePrice: 0.5, franchiseId: 8 },
      { id: 5, name: 'KL Rahul', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 6 },
      { id: 6, name: 'Mohammed Shami', position: 'Bowler', basePrice: 0.5, franchiseId: 8 },
      { id: 7, name: 'Hardik Pandya', position: 'All-rounder', basePrice: 0.5, franchiseId: 1 },
      { id: 8, name: 'Ravindra Jadeja', position: 'All-rounder', basePrice: 0.5, franchiseId: 2 },
      { id: 9, name: 'Rishabh Pant', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 5 },
      { id: 10, name: 'Yuzvendra Chahal', position: 'Bowler', basePrice: 0.5, franchiseId: 7 },
      { id: 11, name: 'Shikhar Dhawan', position: 'Batsman', basePrice: 0.5, franchiseId: 6 },
      { id: 12, name: 'David Warner', position: 'Batsman', basePrice: 0.5, franchiseId: 8 },
      { id: 13, name: 'AB de Villiers', position: 'Batsman', basePrice: 0.5, franchiseId: 3 },
      { id: 14, name: 'Glenn Maxwell', position: 'All-rounder', basePrice: 0.5, franchiseId: 3 },
      { id: 15, name: 'Kagiso Rabada', position: 'Bowler', basePrice: 0.5, franchiseId: 5 },
      { id: 16, name: 'Jos Buttler', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 7 },
      { id: 17, name: 'Pat Cummins', position: 'Bowler', basePrice: 0.5, franchiseId: 4 },
      { id: 18, name: 'Trent Boult', position: 'Bowler', basePrice: 0.5, franchiseId: 7 },
      { id: 19, name: 'Andre Russell', position: 'All-rounder', basePrice: 0.5, franchiseId: 4 },
      { id: 20, name: 'Suryakumar Yadav', position: 'Batsman', basePrice: 0.5, franchiseId: 1 }
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
      { header: 'Final Price', key: 'finalPrice', width: 15 },
      { header: 'RTM Used', key: 'rtmUsed', width: 10 }
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
      const playerId = row.getCell(1).value;
      soldPlayerIds.add(playerId);
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
          basePrice: row.getCell(4).value,
          franchiseId: row.getCell(5).value
        });
      }
    }
  });

  console.log(`Loaded ${players.length} available players (${soldPlayerIds.size} sold)`);
  return players;
}

// Get sold players for a team
async function getTeamPlayers(teamId) {
  console.log(`📥 Fetching players for team ID: ${teamId}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(DATA_PATH);
  
  const soldSheet = workbook.getWorksheet('Sold Players');
  const players = [];

  soldSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) { // Skip header
      const rowTeamId = row.getCell(4).value;
      console.log(`  Row ${rowNumber}: TeamID=${rowTeamId}, Player=${row.getCell(2).value}, Match=${rowTeamId === teamId}`);
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

  console.log(`✅ Found ${players.length} players for team ${teamId}`);
  return players;
}

// Save sold player
async function saveSoldPlayer(player, teamId, teamName, finalPrice, rtmUsed = false) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    
    const soldSheet = workbook.getWorksheet('Sold Players');
    
    // Add the row with explicit column values
    const newRow = soldSheet.addRow([
      player.id,
      player.name,
      player.position,
      teamId,
      teamName,
      finalPrice,
      rtmUsed ? 'Yes' : 'No'
    ]);
    
    // Commit the row
    newRow.commit();
    
    // Write to file
    await workbook.xlsx.writeFile(DATA_PATH);
    
    // Verify the save worked
    const verifyWorkbook = new ExcelJS.Workbook();
    await verifyWorkbook.xlsx.readFile(DATA_PATH);
    const verifySoldSheet = verifyWorkbook.getWorksheet('Sold Players');
    let rowCount = 0;
    verifySoldSheet.eachRow((row, num) => {
      if (num > 1) rowCount++;
    });
    
    console.log(`✅ Player ${player.name} saved to Excel for team ${teamName} at ₹${finalPrice} Cr (Total sold: ${rowCount})`);
  } catch (err) {
    console.error(`❌ Error saving player ${player.name}:`, err.message);
    throw err;
  }
}

// Load team state from Excel (budgets and RTM usage)
async function loadTeamStateFromExcel() {
  try {
    console.log('📖 Loading team state from Excel...');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    
    const soldSheet = workbook.getWorksheet('Sold Players');
    
    // Calculate spending and RTM usage for each team
    const teamSpending = {};
    const teamRTMUsed = {};
    
    soldSheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) { // Skip header
        const teamId = row.getCell(4).value;
        const finalPrice = row.getCell(6).value;
        const rtmUsed = row.getCell(7).value === 'Yes';
        
        console.log(`  Processing: Team ${teamId}, Price ${finalPrice}, RTM ${rtmUsed}`);
        
        if (!teamSpending[teamId]) {
          teamSpending[teamId] = 0;
        }
        teamSpending[teamId] += finalPrice;
        
        if (rtmUsed) {
          teamRTMUsed[teamId] = true;
        }
      }
    });
    
    console.log('💰 Team spending:', teamSpending);
    
    // Update team budgets and RTM status
    auctionState.teams.forEach(team => {
      const spent = teamSpending[team.id] || 0;
      team.budget = 100 - spent; // Initial budget is 100
      team.rtmUsed = teamRTMUsed[team.id] || false;
      console.log(`  Team ${team.id} (${team.name}): Spent ₹${spent} Cr, Budget ₹${team.budget} Cr`);
    });
    
    console.log('✅ Team state loaded from Excel');
  } catch (err) {
    console.error('Error loading team state:', err);
  }
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

// Complete auction helper
async function completeAuction(winningTeam, finalPrice, isRTM) {
  try {
    console.log(`🔄 Completing auction: ${auctionState.currentPlayer.name} to ${winningTeam.name} for ₹${finalPrice} Cr`);
    
    winningTeam.budget -= finalPrice;
    if (isRTM) {
      winningTeam.rtmUsed = true;
    }
    
    await saveSoldPlayer(
      auctionState.currentPlayer,
      winningTeam.id,
      winningTeam.name,
      finalPrice,
      isRTM
    );

    broadcast({ 
      type: 'auction_complete', 
      winner: winningTeam.name,
      player: auctionState.currentPlayer.name,
      price: finalPrice,
      rtmUsed: isRTM,
      teams: auctionState.teams
    });

    auctionState = {
      currentPlayer: null,
      currentBid: 0,
      currentBidder: null,
      teamsOut: [],
      auctionActive: false,
      rtmPhase: false,
      rtmEligibleTeam: null,
      pendingWinner: null,
      pendingPrice: null,
      teams: auctionState.teams
    };
    
    console.log(`✅ Auction completed successfully`);
  } catch (err) {
    console.error(`❌ Error completing auction:`, err);
    throw err;
  }
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
        
        // Send chat history
        cleanOldChatMessages(); // Clean before sending
        if (chatHistory.length > 0) {
          ws.send(JSON.stringify({
            type: 'chat_history',
            messages: chatHistory
          }));
        }
      } else if (data.type === 'chat') {
        // Store chat message in history
        const chatMessage = {
          type: 'chat',
          message: data.message,
          teamId: data.teamId,
          teamName: data.teamName,
          timestamp: data.timestamp
        };
        
        chatHistory.push(chatMessage);
        
        // Broadcast chat message to all connected clients
        broadcast(chatMessage);
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
  
  // Check for admin login
  if (teamName === 'Admin' && password === ADMIN_PASSWORD) {
    res.json({ 
      success: true, 
      isAdmin: true,
      team: { 
        id: 0, 
        name: 'Admin', 
        color: '#000000' 
      } 
    });
    return;
  }
  
  const team = TEAMS.find(t => t.name === teamName && t.password === password);
  
  if (team) {
    res.json({ 
      success: true,
      isAdmin: false,
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

// Get team players with position breakdown
app.get('/api/team/:teamId/players', async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    console.log(`\n🔍 API Request: Get players for team ${teamId}`);
    const players = await getTeamPlayers(teamId);
    const team = auctionState.teams.find(t => t.id === teamId);
    console.log(`  Team found in auctionState: ${team ? team.name : 'NOT FOUND'}`);
    console.log(`  Budget: ${team ? team.budget : 'N/A'}`);
    
    // Calculate position counts
    const positionCounts = {
      'Batsman': 0,
      'Bowler': 0,
      'All-rounder': 0,
      'Wicket-keeper': 0
    };
    
    players.forEach(player => {
      if (positionCounts.hasOwnProperty(player.position)) {
        positionCounts[player.position]++;
      }
    });
    
    // Calculate max bid (16 players minimum with 0.5 Cr each)
    const totalPlayers = players.length;
    const playersNeeded = Math.max(0, 16 - totalPlayers);
    const reservedForMinimum = playersNeeded * 0.5;
    const maxBid = Math.max(0.5, team ? team.budget - reservedForMinimum : 0);
    
    // Check squad composition requirements
    const minRequirements = {
      'Wicket-keeper': 1,
      'Bowler': 3,
      'Batsman': 3,
      'All-rounder': 2
    };
    
    const squadStatus = {
      meetsMinimum: totalPlayers >= 16,
      atMaximum: totalPlayers >= 18,
      requirements: {}
    };
    
    Object.keys(minRequirements).forEach(position => {
      const count = positionCounts[position];
      const min = minRequirements[position];
      squadStatus.requirements[position] = {
        current: count,
        minimum: min,
        met: count >= min,
        needed: Math.max(0, min - count)
      };
    });
    
    const response = { 
      players, 
      budget: team ? team.budget : 100,
      positionCounts,
      maxBid: Math.round(maxBid * 10) / 10, // Round to 1 decimal
      squadStatus,
      totalPlayers
    };
    console.log(`  Returning:`, response);
    res.json(response);
  } catch (err) {
    console.error(`❌ Error getting team players:`, err);
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
      // Check if RTM is applicable
      const winningTeam = auctionState.teams.find(t => t.id === auctionState.currentBidder);
      const franchiseTeam = auctionState.teams.find(t => t.id === auctionState.currentPlayer.franchiseId);
      
      // RTM is applicable if:
      // 1. Player has a franchise assignment
      // 2. Franchise team hasn't used RTM yet
      // 3. Franchise team is not the winning bidder
      // 4. Franchise team has enough budget
      if (franchiseTeam && 
          !franchiseTeam.rtmUsed && 
          franchiseTeam.id !== winningTeam.id &&
          franchiseTeam.budget >= auctionState.currentBid) {
        
        // Enter RTM phase
        auctionState.rtmPhase = true;
        auctionState.rtmEligibleTeam = franchiseTeam.id;
        auctionState.pendingWinner = winningTeam;
        auctionState.pendingPrice = auctionState.currentBid;
        auctionState.auctionActive = false;
        
        broadcast({ 
          type: 'rtm_opportunity',
          state: auctionState,
          franchiseTeam: franchiseTeam.name,
          winningTeam: winningTeam.name,
          player: auctionState.currentPlayer.name,
          price: auctionState.currentBid
        });
      } else {
        // No RTM, complete auction normally
        await completeAuction(winningTeam, auctionState.currentBid, false);
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

// Get all teams with detailed info (player counts, etc)
app.get('/api/teams/detailed', async (req, res) => {
  try {
    const teamsWithDetails = await Promise.all(auctionState.teams.map(async (team) => {
      const players = await getTeamPlayers(team.id);
      return {
        id: team.id,
        name: team.name,
        budget: team.budget,
        color: team.color,
        playerCount: players.length,
        rtmUsed: team.rtmUsed
      };
    }));
    res.json(teamsWithDetails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset auction (admin function)
app.post('/api/auction/reset', (req, res) => {
  auctionState = {
    currentPlayer: null,
    currentBid: 0,
    currentBidder: null,
    teamsOut: [],
    auctionActive: false,
    rtmPhase: false,
    rtmEligibleTeam: null,
    pendingWinner: null,
    pendingPrice: null,
    teams: JSON.parse(JSON.stringify(TEAMS))
  };
  broadcast({ type: 'reset', state: auctionState });
  res.json({ success: true });
});

// Use RTM
app.post('/api/auction/rtm', async (req, res) => {
  try {
    const { teamId, useRTM } = req.body;

    if (!auctionState.rtmPhase) {
      return res.status(400).json({ error: 'No RTM opportunity available' });
    }

    if (teamId !== auctionState.rtmEligibleTeam) {
      return res.status(403).json({ error: 'Not eligible for RTM' });
    }

    const franchiseTeam = auctionState.teams.find(t => t.id === teamId);
    
    if (useRTM) {
      // Franchise team uses RTM and gets the player
      await completeAuction(franchiseTeam, auctionState.pendingPrice, true);
    } else {
      // Franchise team declines RTM, pending winner gets the player
      await completeAuction(auctionState.pendingWinner, auctionState.pendingPrice, false);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Manually complete auction
app.post('/api/admin/complete-auction', async (req, res) => {
  try {
    console.log('📋 Admin complete auction request:', req.body);
    const { teamId, customPrice } = req.body;

    if (!auctionState.auctionActive) {
      console.log('❌ No active auction');
      return res.status(400).json({ error: 'No active auction' });
    }

    const team = auctionState.teams.find(t => t.id === teamId);
    if (!team) {
      console.log('❌ Team not found:', teamId);
      return res.status(404).json({ error: 'Team not found' });
    }

    const finalPrice = customPrice || auctionState.currentBid;
    
    if (finalPrice > team.budget) {
      return res.status(400).json({ error: `Team only has ₹${team.budget} Cr budget` });
    }

    console.log(`✅ Admin awarding ${auctionState.currentPlayer.name} to ${team.name} at ₹${finalPrice} Cr`);
    await completeAuction(team, finalPrice, false);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Admin complete auction error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Initialize and start server
initializeExcel().then(async () => {
  await loadTeamStateFromExcel();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});

