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
  { id: 1, name: 'Mumbai Indians', shorthand: 'MI', password: 'mi2026', budget: 100, color: '#004BA0', rtmUsed: false },
  { id: 2, name: 'Chennai Super Kings', shorthand: 'CSK', password: 'csk2026', budget: 100, color: '#FDB913', rtmUsed: false },
  { id: 3, name: 'Royal Challengers Bangalore', shorthand: 'RCB', password: 'rcb2026', budget: 100, color: '#EC1C24', rtmUsed: false },
  { id: 4, name: 'Kolkata Knight Riders', shorthand: 'KKR', password: 'kkr2026', budget: 100, color: '#3A225D', rtmUsed: false },
  { id: 5, name: 'Delhi Capitals', shorthand: 'DC', password: 'dc2026', budget: 100, color: '#004C93', rtmUsed: false },
  { id: 6, name: 'Punjab Kings', shorthand: 'PBKS', password: 'pbks2026', budget: 100, color: '#DD1F2D', rtmUsed: false },
  { id: 7, name: 'Rajasthan Royals', shorthand: 'RR', password: 'rr2026', budget: 100, color: '#254AA5', rtmUsed: false },
  { id: 8, name: 'Sunrisers Hyderabad', shorthand: 'SRH', password: 'srh2026', budget: 100, color: '#FF822A', rtmUsed: false },
  { id: 9, name: 'Gujarat Titans', shorthand: 'GT', password: 'gt2026', budget: 100, color: '#1C2E4A', rtmUsed: false },
  { id: 10, name: 'Lucknow Super Giants', shorthand: 'LSG', password: 'lsg2026', budget: 100, color: '#3D9BE9', rtmUsed: false }
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
  timerActive: false,
  timeRemaining: 0,
  rtmTimerActive: false,
  rtmTimeRemaining: 0,
  nominationOrder: [], // Array of team IDs in random order
  currentTurnIndex: 0, // Index in nominationOrder
  currentTurnTeam: null, // Team ID whose turn it is
  teams: JSON.parse(JSON.stringify(TEAMS)) // Deep copy
};

// Timer management
let auctionTimer = null;
let rtmTimer = null;

// Helper function to shuffle array (Fisher-Yates)
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Initialize nomination order
function initializeNominationOrder() {
  // Exclude Admin (id: 0) from nomination order - they only control, don't play
  const teamIds = TEAMS.map(t => t.id).filter(id => id !== 0);
  auctionState.nominationOrder = shuffleArray(teamIds);
  auctionState.currentTurnIndex = 0;
  auctionState.currentTurnTeam = auctionState.nominationOrder[0];
  
  console.log('🎲 Nomination order set (Admin excluded):', auctionState.nominationOrder.map(id => {
    const team = TEAMS.find(t => t.id === id);
    return team ? team.name : id;
  }).join(' → '));
  
  return auctionState.nominationOrder;
}

// Get overseas player count for a team
async function getTeamOverseasCount(teamId) {
  try {
    const players = await getTeamPlayers(teamId);
    return players.filter(p => p.overseas === true || p.overseas === 'true').length;
  } catch (err) {
    console.error('Error counting overseas players:', err);
    return 0;
  }
}

// Check if team can nominate
async function canTeamNominate(teamId) {
  const team = auctionState.teams.find(t => t.id === teamId);
  
  if (!team) {
    return { canNominate: false, reason: 'Team not found', allowedPositions: [] };
  }
  
  // Check budget - need at least 0.5 Cr
  if (team.budget < 0.5) {
    return { canNominate: false, reason: 'Insufficient budget', allowedPositions: [] };
  }
  
  // Get team's current players
  const players = await getTeamPlayers(teamId);
  const totalPlayers = players.length;
  
  // Count by position
  const positionCounts = {
    'Wicket-keeper': 0,
    'Batsman': 0,
    'Bowler': 0,
    'All-rounder': 0
  };
  
  players.forEach(p => {
    if (positionCounts.hasOwnProperty(p.position)) {
      positionCounts[p.position]++;
    }
  });
  
  // Squad rules
  const MIN_WK = 1, MIN_BOWLER = 3, MIN_BATSMAN = 3, MIN_ALLROUNDER = 2;
  const MIN_PLAYERS = 16, MAX_PLAYERS = 18;
  
  // Calculate remaining slots
  const remainingSlots = MAX_PLAYERS - totalPlayers;
  
  // If no slots left
  if (remainingSlots <= 0) {
    return { canNominate: false, reason: 'Squad full (18 players)', allowedPositions: [] };
  }
  
  // Calculate missing positions
  const missingWK = Math.max(0, MIN_WK - positionCounts['Wicket-keeper']);
  const missingBowler = Math.max(0, MIN_BOWLER - positionCounts['Bowler']);
  const missingBatsman = Math.max(0, MIN_BATSMAN - positionCounts['Batsman']);
  const missingAllrounder = Math.max(0, MIN_ALLROUNDER - positionCounts['All-rounder']);
  
  const totalMissing = missingWK + missingBowler + missingBatsman + missingAllrounder;
  
  // If slots remaining equals or less than missing positions, restrict nominations
  if (remainingSlots <= totalMissing) {
    const allowedPositions = [];
    if (missingWK > 0) allowedPositions.push('Wicket-keeper');
    if (missingBowler > 0) allowedPositions.push('Bowler');
    if (missingBatsman > 0) allowedPositions.push('Batsman');
    if (missingAllrounder > 0) allowedPositions.push('All-rounder');
    
    if (allowedPositions.length === 0) {
      return { canNominate: true, reason: 'Can nominate any position', allowedPositions: [] };
    }
    
    return { 
      canNominate: true, 
      reason: `Must nominate: ${allowedPositions.join(' or ')}`,
      allowedPositions: allowedPositions,
      restricted: true
    };
  }
  
  return { canNominate: true, reason: 'Can nominate any position', allowedPositions: [], restricted: false };
}

// Full reset function - clears all data and resets to initial state
async function performFullReset() {
  try {
    console.log('🔄 Performing full auction reset...');
    
    // Stop any active timers
    stopAuctionTimer();
    stopRTMTimer();
    
    // Clear sold players from Excel
    if (fs.existsSync(DATA_PATH)) {
      console.log('📄 Clearing sold players from Excel...');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(DATA_PATH);
      
      const soldSheet = workbook.getWorksheet('Sold Players');
      if (soldSheet) {
        // Get all row numbers except header
        const rowsToDelete = [];
        soldSheet.eachRow((row, rowNumber) => {
          if (rowNumber > 1) { // Skip header
            rowsToDelete.push(rowNumber);
          }
        });
        
        // Delete rows in reverse order to avoid index shifting
        for (let i = rowsToDelete.length - 1; i >= 0; i--) {
          soldSheet.spliceRows(rowsToDelete[i], 1);
        }
        
        await workbook.xlsx.writeFile(DATA_PATH);
        console.log(`✅ Cleared ${rowsToDelete.length} sold players from Excel`);
      }
    }
    
    // Reset all team data to initial state
    auctionState.teams = JSON.parse(JSON.stringify(TEAMS));
    
    // Reset auction state completely
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
      timerActive: false,
      timeRemaining: 0,
      rtmTimerActive: false,
      rtmTimeRemaining: 0,
      nominationOrder: [],
      currentTurnIndex: 0,
      currentTurnTeam: null,
      teams: JSON.parse(JSON.stringify(TEAMS))
    };
    
    console.log('✅ Full auction reset completed successfully');
    console.log('   - All sold players cleared');
    console.log('   - All team budgets reset to ₹100 Cr');
    console.log('   - All RTM statuses reset');
    console.log('   - Nomination order cleared');
  } catch (err) {
    console.error('❌ Error during full reset:', err);
    throw err;
  }
}

// Move to next team's turn
async function advanceToNextTurn() {
  if (auctionState.nominationOrder.length === 0) {
    console.log('⚠️  No nomination order set');
    return;
  }
  
  const maxAttempts = auctionState.nominationOrder.length;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    // Move to next team
    auctionState.currentTurnIndex = (auctionState.currentTurnIndex + 1) % auctionState.nominationOrder.length;
    auctionState.currentTurnTeam = auctionState.nominationOrder[auctionState.currentTurnIndex];
    
    const team = auctionState.teams.find(t => t.id === auctionState.currentTurnTeam);
    const teamName = team ? team.name : 'Unknown';
    
    // Check if team can nominate
    const canNominate = await canTeamNominate(auctionState.currentTurnTeam);
    
    if (canNominate.canNominate) {
      console.log(`✅ Turn advanced to: ${teamName}`);
      broadcast({
        type: 'turn_change',
        state: auctionState
      });
      return;
    } else {
      console.log(`⏭️  Skipping ${teamName}: ${canNominate.reason}`);
      attempts++;
    }
  }
  
  console.log('⚠️  All teams unable to nominate - auction may be complete');
}

// WebSocket clients
let clients = new Map(); // teamId -> [WebSocket connections]

// Chat history (store last 30 minutes)
let chatHistory = [];
const CHAT_RETENTION_TIME = 30 * 60 * 1000; // 30 minutes in milliseconds

// Auto-Stats Service
const autoStatsService = require('./autoStatsService');
let autoStatsEnabled = false;

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
      { header: 'Franchise ID', key: 'franchiseId', width: 15 },
      { header: 'Overseas', key: 'overseas', width: 10 }
    ];

    // IPL 2026 Players - Based on actual IPL 2026 squads (Updated Feb 2026)
    // Franchise IDs: 1=MI, 2=CSK, 3=RCB, 4=KKR, 5=DC, 6=PBKS, 7=RR, 8=SRH, 9=GT, 10=LSG
    const samplePlayers = [
      // Mumbai Indians (1) - Captain: Hardik Pandya
      { id: 1, name: 'Hardik Pandya', position: 'All-rounder', basePrice: 0.5, franchiseId: 1 },
      { id: 2, name: 'Rohit Sharma', position: 'Batsman', basePrice: 0.5, franchiseId: 1 },
      { id: 3, name: 'Jasprit Bumrah', position: 'Bowler', basePrice: 0.5, franchiseId: 1 },
      { id: 4, name: 'Suryakumar Yadav', position: 'Batsman', basePrice: 0.5, franchiseId: 1 },
      { id: 5, name: 'Tilak Varma', position: 'Batsman', basePrice: 0.5, franchiseId: 1 },
      { id: 6, name: 'Trent Boult', position: 'Bowler', basePrice: 0.5, franchiseId: 1 },
      { id: 7, name: 'Mitchell Santner', position: 'All-rounder', basePrice: 0.5, franchiseId: 1 },
      { id: 8, name: 'Quinton de Kock', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 1 },
      { id: 9, name: 'Deepak Chahar', position: 'Bowler', basePrice: 0.5, franchiseId: 1 },
      { id: 10, name: 'Shardul Thakur', position: 'All-rounder', basePrice: 0.5, franchiseId: 1 },
      
      // Chennai Super Kings (2) - Captain: Ruturaj Gaikwad
      { id: 11, name: 'MS Dhoni', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 2 },
      { id: 12, name: 'Ruturaj Gaikwad', position: 'Batsman', basePrice: 0.5, franchiseId: 2 },
      { id: 13, name: 'Sanju Samson', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 2 },
      { id: 14, name: 'Shivam Dube', position: 'All-rounder', basePrice: 0.5, franchiseId: 2 },
      { id: 15, name: 'Ravindra Jadeja', position: 'All-rounder', basePrice: 0.5, franchiseId: 2 },
      { id: 16, name: 'Khaleel Ahmed', position: 'Bowler', basePrice: 0.5, franchiseId: 2 },
      { id: 17, name: 'Noor Ahmad', position: 'Bowler', basePrice: 0.5, franchiseId: 2 },
      { id: 18, name: 'Matt Henry', position: 'Bowler', basePrice: 0.5, franchiseId: 2 },
      { id: 19, name: 'Rahul Chahar', position: 'Bowler', basePrice: 0.5, franchiseId: 2 },
      { id: 20, name: 'Dewald Brevis', position: 'Batsman', basePrice: 0.5, franchiseId: 2 },
      
      // Royal Challengers Bangalore (3) - Captain: Rajat Patidar, Champions 2025
      { id: 21, name: 'Virat Kohli', position: 'Batsman', basePrice: 0.5, franchiseId: 3 },
      { id: 22, name: 'Rajat Patidar', position: 'Batsman', basePrice: 0.5, franchiseId: 3 },
      { id: 23, name: 'Phil Salt', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 3 },
      { id: 24, name: 'Josh Hazlewood', position: 'Bowler', basePrice: 0.5, franchiseId: 3 },
      { id: 25, name: 'Yash Dayal', position: 'Bowler', basePrice: 0.5, franchiseId: 3 },
      { id: 26, name: 'Venkatesh Iyer', position: 'All-rounder', basePrice: 0.5, franchiseId: 3 },
      { id: 27, name: 'Krunal Pandya', position: 'All-rounder', basePrice: 0.5, franchiseId: 3 },
      { id: 28, name: 'Bhuvneshwar Kumar', position: 'Bowler', basePrice: 0.5, franchiseId: 3 },
      { id: 29, name: 'Tim David', position: 'All-rounder', basePrice: 0.5, franchiseId: 3 },
      { id: 30, name: 'Jitesh Sharma', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 3 },
      
      // Kolkata Knight Riders (4) - Biggest Buy: Cameron Green Rs 25.20 Cr
      { id: 31, name: 'Cameron Green', position: 'All-rounder', basePrice: 0.5, franchiseId: 4 },
      { id: 32, name: 'Rinku Singh', position: 'Batsman', basePrice: 0.5, franchiseId: 4 },
      { id: 33, name: 'Sunil Narine', position: 'All-rounder', basePrice: 0.5, franchiseId: 4 },
      { id: 34, name: 'Varun Chakravarthy', position: 'Bowler', basePrice: 0.5, franchiseId: 4 },
      { id: 35, name: 'Andre Russell', position: 'All-rounder', basePrice: 0.5, franchiseId: 4 },
      { id: 36, name: 'Ajinkya Rahane', position: 'Batsman', basePrice: 0.5, franchiseId: 4 },
      { id: 37, name: 'Harshit Rana', position: 'Bowler', basePrice: 0.5, franchiseId: 4 },
      { id: 38, name: 'Ramandeep Singh', position: 'All-rounder', basePrice: 0.5, franchiseId: 4 },
      { id: 39, name: 'Rovman Powell', position: 'All-rounder', basePrice: 0.5, franchiseId: 4 },
      { id: 40, name: 'Umran Malik', position: 'Bowler', basePrice: 0.5, franchiseId: 4 },
      
      // Delhi Capitals (5) - Captain: Axar Patel
      { id: 41, name: 'Axar Patel', position: 'All-rounder', basePrice: 0.5, franchiseId: 5 },
      { id: 42, name: 'KL Rahul', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 5 },
      { id: 43, name: 'Abishek Porel', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 5 },
      { id: 44, name: 'Tristan Stubbs', position: 'Batsman', basePrice: 0.5, franchiseId: 5 },
      { id: 45, name: 'Kuldeep Yadav', position: 'Bowler', basePrice: 0.5, franchiseId: 5 },
      { id: 46, name: 'Mitchell Starc', position: 'Bowler', basePrice: 0.5, franchiseId: 5 },
      { id: 47, name: 'T Natarajan', position: 'Bowler', basePrice: 0.5, franchiseId: 5 },
      { id: 48, name: 'Nitish Rana', position: 'Batsman', basePrice: 0.5, franchiseId: 5 },
      { id: 49, name: 'Karun Nair', position: 'Batsman', basePrice: 0.5, franchiseId: 5 },
      { id: 50, name: 'Mukesh Kumar', position: 'Bowler', basePrice: 0.5, franchiseId: 5 },
      
      // Punjab Kings (6) - Captain: Shreyas Iyer
      { id: 51, name: 'Shreyas Iyer', position: 'Batsman', basePrice: 0.5, franchiseId: 6 },
      { id: 52, name: 'Prabhsimran Singh', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 6 },
      { id: 53, name: 'Shashank Singh', position: 'All-rounder', basePrice: 0.5, franchiseId: 6 },
      { id: 54, name: 'Marcus Stoinis', position: 'All-rounder', basePrice: 0.5, franchiseId: 6 },
      { id: 55, name: 'Arshdeep Singh', position: 'Bowler', basePrice: 0.5, franchiseId: 6 },
      { id: 56, name: 'Yuzvendra Chahal', position: 'Bowler', basePrice: 0.5, franchiseId: 6 },
      { id: 57, name: 'Marco Jansen', position: 'All-rounder', basePrice: 0.5, franchiseId: 6 },
      { id: 58, name: 'Lockie Ferguson', position: 'Bowler', basePrice: 0.5, franchiseId: 6 },
      { id: 59, name: 'Priyansh Arya', position: 'Batsman', basePrice: 0.5, franchiseId: 6 },
      { id: 60, name: 'Nehal Wadhera', position: 'Batsman', basePrice: 0.5, franchiseId: 6 },
      
      // Rajasthan Royals (7) - Lost Sanju Samson to CSK
      { id: 61, name: 'Yashasvi Jaiswal', position: 'Batsman', basePrice: 0.5, franchiseId: 7 },
      { id: 62, name: 'Riyan Parag', position: 'All-rounder', basePrice: 0.5, franchiseId: 7 },
      { id: 63, name: 'Dhruv Jurel', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 7 },
      { id: 64, name: 'Shimron Hetmyer', position: 'Batsman', basePrice: 0.5, franchiseId: 7 },
      { id: 65, name: 'Sandeep Sharma', position: 'Bowler', basePrice: 0.5, franchiseId: 7 },
      { id: 66, name: 'Maheesh Theekshana', position: 'Bowler', basePrice: 0.5, franchiseId: 7 },
      { id: 67, name: 'Wanindu Hasaranga', position: 'All-rounder', basePrice: 0.5, franchiseId: 7 },
      { id: 68, name: 'Jofra Archer', position: 'Bowler', basePrice: 0.5, franchiseId: 7 },
      
      // Sunrisers Hyderabad (8) - Captain: Pat Cummins
      { id: 69, name: 'Pat Cummins', position: 'Bowler', basePrice: 0.5, franchiseId: 8 },
      { id: 70, name: 'Travis Head', position: 'Batsman', basePrice: 0.5, franchiseId: 8 },
      { id: 71, name: 'Abhishek Sharma', position: 'All-rounder', basePrice: 0.5, franchiseId: 8 },
      { id: 72, name: 'Heinrich Klaasen', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 8 },
      { id: 73, name: 'Nitish Kumar Reddy', position: 'All-rounder', basePrice: 0.5, franchiseId: 8 },
      { id: 74, name: 'Ishan Kishan', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 8 },
      { id: 75, name: 'Harshal Patel', position: 'Bowler', basePrice: 0.5, franchiseId: 8 },
      { id: 76, name: 'Jaydev Unadkat', position: 'Bowler', basePrice: 0.5, franchiseId: 8 },
      { id: 77, name: 'Brydon Carse', position: 'Bowler', basePrice: 0.5, franchiseId: 8 },
      
      // Gujarat Titans (9) - Captain: Shubman Gill
      { id: 78, name: 'Shubman Gill', position: 'Batsman', basePrice: 0.5, franchiseId: 9 },
      { id: 79, name: 'Rashid Khan', position: 'All-rounder', basePrice: 0.5, franchiseId: 9 },
      { id: 80, name: 'Jos Buttler', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 9 },
      { id: 81, name: 'Washington Sundar', position: 'All-rounder', basePrice: 0.5, franchiseId: 9 },
      { id: 82, name: 'Kagiso Rabada', position: 'Bowler', basePrice: 0.5, franchiseId: 9 },
      { id: 83, name: 'Mohammed Siraj', position: 'Bowler', basePrice: 0.5, franchiseId: 9 },
      { id: 84, name: 'Prasidh Krishna', position: 'Bowler', basePrice: 0.5, franchiseId: 9 },
      { id: 85, name: 'Sai Sudharsan', position: 'Batsman', basePrice: 0.5, franchiseId: 9 },
      { id: 86, name: 'Ishant Sharma', position: 'Bowler', basePrice: 0.5, franchiseId: 9 },
      
      // Lucknow Super Giants (10) - Captain: Rishabh Pant
      { id: 87, name: 'Rishabh Pant', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 10 },
      { id: 88, name: 'Nicholas Pooran', position: 'Wicket-keeper', basePrice: 0.5, franchiseId: 10 },
      { id: 89, name: 'Mohammed Shami', position: 'Bowler', basePrice: 0.5, franchiseId: 10 },
      { id: 90, name: 'Mitchell Marsh', position: 'All-rounder', basePrice: 0.5, franchiseId: 10 },
      { id: 91, name: 'Aiden Markram', position: 'Batsman', basePrice: 0.5, franchiseId: 10 },
      { id: 92, name: 'Mayank Yadav', position: 'Bowler', basePrice: 0.5, franchiseId: 10 },
      { id: 93, name: 'Avesh Khan', position: 'Bowler', basePrice: 0.5, franchiseId: 10 },
      { id: 94, name: 'Mohsin Khan', position: 'Bowler', basePrice: 0.5, franchiseId: 10 },
      { id: 95, name: 'Shahbaz Ahmed', position: 'All-rounder', basePrice: 0.5, franchiseId: 10 },
      { id: 96, name: 'Arjun Tendulkar', position: 'All-rounder', basePrice: 0.5, franchiseId: 10 }
    ];
    
    // List of overseas (non-Indian) player names  
    const overseasPlayers = [
      'Trent Boult', 'Mitchell Santner', 'Quinton de Kock', 'Noor Ahmad', 'Matt Henry', 'Dewald Brevis',
      'Phil Salt', 'Josh Hazlewood', 'Tim David', 'Cameron Green', 'Andre Russell', 'Sunil Narine',
      'Rovman Powell', 'Tristan Stubbs', 'Mitchell Starc', 'Marcus Stoinis', 'Marco Jansen',
      'Lockie Ferguson', 'Shimron Hetmyer', 'Maheesh Theekshana', 'Wanindu Hasaranga', 'Jofra Archer',
      'Pat Cummins', 'Travis Head', 'Heinrich Klaasen', 'Brydon Carse', 'Rashid Khan', 'Jos Buttler',
      'Kagiso Rabada', 'Nicholas Pooran', 'Mitchell Marsh', 'Aiden Markram'
    ];
    
    // Add overseas field to all players
    const playersWithOverseas = samplePlayers.map(player => ({
      ...player,
      overseas: overseasPlayers.includes(player.name)
    }));

    playersSheet.addRows(playersWithOverseas);

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
    
    // Gameweeks Sheet
    const gameweeksSheet = workbook.addWorksheet('Gameweeks');
    gameweeksSheet.columns = [
      { header: 'Gameweek', key: 'gameweek', width: 12 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Start Date', key: 'startDate', width: 20 },
      { header: 'End Date', key: 'endDate', width: 20 }
    ];
    
    // Matches Sheet
    const matchesSheet = workbook.addWorksheet('Matches');
    matchesSheet.columns = [
      { header: 'Match ID', key: 'matchId', width: 12 },
      { header: 'Gameweek', key: 'gameweek', width: 12 },
      { header: 'Team 1', key: 'team1', width: 25 },
      { header: 'Team 2', key: 'team2', width: 25 },
      { header: 'Winner', key: 'winner', width: 25 },
      { header: 'Match Date', key: 'matchDate', width: 20 },
      { header: 'Status', key: 'status', width: 15 }
    ];
    
    // Player Performance Sheet
    const perfSheet = workbook.addWorksheet('Player Performance');
    perfSheet.columns = [
      { header: 'Match ID', key: 'matchId', width: 12 },
      { header: 'Gameweek', key: 'gameweek', width: 12 },
      { header: 'Player ID', key: 'playerId', width: 10 },
      { header: 'Player Name', key: 'playerName', width: 30 },
      { header: 'Position', key: 'position', width: 20 },
      { header: 'Runs', key: 'runs', width: 10 },
      { header: 'Balls Faced', key: 'ballsFaced', width: 12 },
      { header: 'Fours', key: 'fours', width: 10 },
      { header: 'Sixes', key: 'sixes', width: 10 },
      { header: 'Wickets', key: 'wickets', width: 10 },
      { header: 'Overs Bowled', key: 'oversBowled', width: 12 },
      { header: 'Runs Conceded', key: 'runsConceded', width: 15 },
      { header: 'Maidens', key: 'maidens', width: 10 },
      { header: 'Catches', key: 'catches', width: 10 },
      { header: 'Stumpings', key: 'stumpings', width: 12 },
      { header: 'Run Outs', key: 'runOuts', width: 12 },
      { header: 'Fantasy Points', key: 'fantasyPoints', width: 15 }
    ];

    await workbook.xlsx.writeFile(DATA_PATH);
    console.log('Excel file initialized with sample data and fantasy league sheets');
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
        // Get player details from Players sheet to check overseas status
        const playersSheet = workbook.getWorksheet('Players');
        let isOverseas = false;
        const playerId = row.getCell(1).value;
        
        playersSheet.eachRow((playerRow, playerRowNumber) => {
          if (playerRowNumber > 1 && playerRow.getCell(1).value === playerId) {
            isOverseas = playerRow.getCell(6).value === true || playerRow.getCell(6).value === 'true';
          }
        });
        
        players.push({
          playerId: playerId,
          playerName: row.getCell(2).value,
          position: row.getCell(3).value,
          finalPrice: row.getCell(6).value,
          overseas: isOverseas
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
    console.log(`💾 Saving player to Excel: ${player.name} → ${teamName} for ₹${finalPrice} Cr`);
    console.log(`📂 Excel file path: ${DATA_PATH}`);
    console.log(`📁 Data directory exists: ${fs.existsSync(path.join(__dirname, '../data'))}`);
    console.log(`📄 Excel file exists: ${fs.existsSync(DATA_PATH)}`);
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    
    const soldSheet = workbook.getWorksheet('Sold Players');
    
    if (!soldSheet) {
      throw new Error('"Sold Players" sheet not found in Excel file');
    }
    
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
    
    console.log(`  Added row: ${JSON.stringify(newRow.values)}`);
    
    // Commit the row
    newRow.commit();
    
    // Write to file
    console.log(`  Writing to file: ${DATA_PATH}`);
    await workbook.xlsx.writeFile(DATA_PATH);
    console.log(`  File written successfully`);
    
    // Verify the save worked
    const verifyWorkbook = new ExcelJS.Workbook();
    await verifyWorkbook.xlsx.readFile(DATA_PATH);
    const verifySoldSheet = verifyWorkbook.getWorksheet('Sold Players');
    let rowCount = 0;
    verifySoldSheet.eachRow((row, num) => {
      if (num > 1) rowCount++;
    });
    
    console.log(`✅ Player ${player.name} saved to Excel for team ${teamName} at ₹${finalPrice} Cr (Total sold: ${rowCount})`);
    console.log(`⚠️  NOTE: Without a Railway volume, this data will be lost on redeploy!`);
  } catch (err) {
    console.error(`❌ Error saving player ${player.name}:`, err.message);
    console.error(`   Stack:`, err.stack);
    throw err;
  }
}

// Load team state from Excel (budgets and RTM usage)
async function loadTeamStateFromExcel() {
  try {
    console.log('📖 Loading team state from Excel...');
    console.log(`📂 Excel file path: ${DATA_PATH}`);
    console.log(`📁 Data directory exists: ${fs.existsSync(path.join(__dirname, '../data'))}`);
    console.log(`📄 Excel file exists: ${fs.existsSync(DATA_PATH)}`);
    
    if (!fs.existsSync(DATA_PATH)) {
      console.log('⚠️  Excel file not found - this is expected on first run or after redeploy without volume');
      console.log('⚠️  To persist data across redeploys, set up a Railway volume at /app/data');
      console.log('⚠️  See RAILWAY_VOLUME_SETUP.md for instructions');
      return;
    }
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    
    const soldSheet = workbook.getWorksheet('Sold Players');
    
    if (!soldSheet) {
      console.log('⚠️  "Sold Players" sheet not found in Excel file');
      return;
    }
    
    // Calculate spending and RTM usage for each team
    const teamSpending = {};
    const teamRTMUsed = {};
    let playerCount = 0;
    
    soldSheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) { // Skip header
        const teamId = row.getCell(4).value;
        const finalPrice = row.getCell(6).value;
        const rtmUsed = row.getCell(7).value === 'Yes';
        
        playerCount++;
        console.log(`  Row ${rowNumber}: Team ${teamId}, Price ${finalPrice}, RTM ${rtmUsed}`);
        
        if (!teamSpending[teamId]) {
          teamSpending[teamId] = 0;
        }
        teamSpending[teamId] += finalPrice;
        
        if (rtmUsed) {
          teamRTMUsed[teamId] = true;
        }
      }
    });
    
    console.log(`📊 Total players loaded from Excel: ${playerCount}`);
    console.log('💰 Team spending:', teamSpending);
    
    // Update team budgets and RTM status
    auctionState.teams.forEach(team => {
      const spent = teamSpending[team.id] || 0;
      team.budget = 100 - spent; // Initial budget is 100
      team.rtmUsed = teamRTMUsed[team.id] || false;
      console.log(`  ${team.name}: Spent ₹${spent} Cr, Remaining Budget ₹${team.budget} Cr, RTM Used: ${team.rtmUsed}`);
    });
    
    console.log('✅ Team state successfully loaded from Excel');
  } catch (err) {
    console.error('❌ Error loading team state from Excel:', err.message);
    console.error('   Stack:', err.stack);
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

// Initialize auto-stats service with broadcast capability
autoStatsService.setBroadcast(broadcast);

// Timer functions
function startAuctionTimer() {
  // Clear any existing timer
  stopAuctionTimer();
  
  auctionState.timerActive = true;
  auctionState.timeRemaining = 30;
  
  console.log('⏱️  Starting 30-second countdown timer');
  
  // Broadcast initial timer state
  broadcast({
    type: 'timer_start',
    state: auctionState
  });
  
  // Start countdown
  auctionTimer = setInterval(async () => {
    auctionState.timeRemaining--;
    
    // Broadcast timer update
    broadcast({
      type: 'timer_tick',
      state: auctionState
    });
    
    console.log(`⏱️  Timer: ${auctionState.timeRemaining} seconds remaining`);
    
    // When timer reaches 0, complete the auction
    if (auctionState.timeRemaining <= 0) {
      stopAuctionTimer();
      
      console.log('⏱️  Timer expired! Processing auction completion...');
      
      // Complete auction with current highest bidder
      if (auctionState.currentBidder) {
        const winningTeam = auctionState.teams.find(t => t.id === auctionState.currentBidder);
        const franchiseTeam = auctionState.teams.find(t => t.id === auctionState.currentPlayer.franchiseId);
        
        // Check if RTM is applicable
        // RTM is applicable if:
        // 1. Player has a franchise assignment
        // 2. Franchise team hasn't used RTM yet
        // 3. Franchise team is not the winning bidder
        // 4. Franchise team has enough budget
        // 5. Franchise team is not marked out
        const franchiseIsOut = auctionState.teamsOut.includes(franchiseTeam?.id);
        
        if (franchiseTeam && 
            !franchiseTeam.rtmUsed && 
            franchiseTeam.id !== winningTeam.id &&
            franchiseTeam.budget >= auctionState.currentBid &&
            !franchiseIsOut) {
          
          console.log(`🎯 RTM opportunity available for ${franchiseTeam.name}`);
          
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
          
          // Start RTM timer
          startRTMTimer();
        } else {
          // No RTM, complete auction normally
          if (winningTeam) {
            await completeAuction(winningTeam, auctionState.currentBid, false);
          }
        }
      }
    }
  }, 1000); // Tick every second
}

function stopAuctionTimer() {
  if (auctionTimer) {
    clearInterval(auctionTimer);
    auctionTimer = null;
  }
  auctionState.timerActive = false;
  auctionState.timeRemaining = 0;
}

function checkAndStartTimer() {
  // Only start timer if auction is active and not in RTM phase
  if (!auctionState.auctionActive || auctionState.rtmPhase || auctionState.timerActive) {
    return;
  }
  
  // Count teams that are still in (not out)
  const activeTeams = auctionState.teams.filter(t => !auctionState.teamsOut.includes(t.id));
  
  // If only one team remains and there's a bid, start the timer
  if (activeTeams.length === 1 && auctionState.currentBidder) {
    console.log(`⏱️  Only ${activeTeams[0].name} remains! Starting timer...`);
    startAuctionTimer();
  }
}

// RTM Timer functions
function startRTMTimer() {
  // Clear any existing RTM timer
  stopRTMTimer();
  
  auctionState.rtmTimerActive = true;
  auctionState.rtmTimeRemaining = 30;
  
  console.log('⏱️  Starting 30-second RTM countdown timer');
  
  // Broadcast initial RTM timer state
  broadcast({
    type: 'rtm_timer_start',
    state: auctionState
  });
  
  // Start countdown
  rtmTimer = setInterval(async () => {
    auctionState.rtmTimeRemaining--;
    
    // Broadcast RTM timer update
    broadcast({
      type: 'rtm_timer_tick',
      state: auctionState
    });
    
    console.log(`⏱️  RTM Timer: ${auctionState.rtmTimeRemaining} seconds remaining`);
    
    // When timer reaches 0, auto-decline RTM
    if (auctionState.rtmTimeRemaining <= 0) {
      stopRTMTimer();
      
      console.log('⏱️  RTM Timer expired! Auto-declining...');
      
      // Auto-decline RTM
      if (auctionState.pendingWinner) {
        await completeAuction(auctionState.pendingWinner, auctionState.pendingPrice, false);
        
        broadcast({
          type: 'rtm_declined',
          message: 'RTM opportunity expired - player sold to highest bidder'
        });
      }
    }
  }, 1000); // Tick every second
}

function stopRTMTimer() {
  if (rtmTimer) {
    clearInterval(rtmTimer);
    rtmTimer = null;
  }
  auctionState.rtmTimerActive = false;
  auctionState.rtmTimeRemaining = 0;
}

// Complete auction helper
async function completeAuction(winningTeam, finalPrice, isRTM) {
  try {
    console.log(`🔄 Completing auction: ${auctionState.currentPlayer.name} to ${winningTeam.name} for ₹${finalPrice} Cr`);
    
    // Stop any active timers
    stopAuctionTimer();
    stopRTMTimer();
    
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
      timerActive: false,
      timeRemaining: 0,
      rtmTimerActive: false,
      rtmTimeRemaining: 0,
      nominationOrder: auctionState.nominationOrder,
      currentTurnIndex: auctionState.currentTurnIndex,
      currentTurnTeam: auctionState.currentTurnTeam,
      teams: auctionState.teams
    };
    
    console.log(`✅ Auction completed successfully`);
    
    // Advance to next team's turn
    await advanceToNextTurn();
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
      } else if (data.type === 'admin_reset_auction') {
        // Admin reset current auction only (not full reset)
        if (auctionState.auctionActive) {
          stopAuctionTimer();
          auctionState.teamsOut = [];
          auctionState.currentBidder = null;
          auctionState.currentBid = 0.5;
          
          broadcast({
            type: 'state',
            state: auctionState
          });
        }
      } else if (data.type === 'admin_full_reset') {
        // Admin full reset - clear everything
        await performFullReset();
        broadcast({
          type: 'full_reset',
          message: 'Full auction reset completed!'
        });
      } else if (data.type === 'admin_mark_team_out') {
        // Admin mark team out
        if (auctionState.auctionActive && data.teamId) {
          if (!auctionState.teamsOut.includes(data.teamId)) {
            auctionState.teamsOut.push(data.teamId);
            
            broadcast({
              type: 'team_out',
              state: auctionState
            });
            
            // Check if only one team remains and start timer
            checkAndStartTimer();
          }
        }
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
    
    // Count overseas players
    const overseasCount = players.filter(p => p.overseas === true || p.overseas === 'true').length;
    
    const response = { 
      players, 
      budget: team ? team.budget : 100,
      positionCounts,
      maxBid: Math.round(maxBid * 10) / 10, // Round to 1 decimal
      squadStatus,
      totalPlayers,
      overseasCount,
      overseasLimit: 10
    };
    console.log(`  Returning:`, response);
    res.json(response);
  } catch (err) {
    console.error(`❌ Error getting team players:`, err);
    res.status(500).json({ error: err.message });
  }
});

// Nominate player
// Initialize auction with nomination order
app.post('/api/auction/initialize', (req, res) => {
  try {
    if (auctionState.auctionActive) {
      return res.status(400).json({ error: 'Auction already in progress' });
    }
    
    initializeNominationOrder();
    
    broadcast({ 
      type: 'nomination_order_set', 
      state: auctionState,
      message: 'Nomination order has been set!'
    });
    
    res.json({ 
      success: true, 
      nominationOrder: auctionState.nominationOrder,
      currentTurnTeam: auctionState.currentTurnTeam
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Nominate player for auction
app.post('/api/auction/nominate', async (req, res) => {
  try {
    const { playerId, teamId } = req.body;
    
    // Check if nomination order is set
    if (auctionState.nominationOrder.length === 0) {
      return res.status(400).json({ error: 'Auction not initialized. Please initialize first.' });
    }
    
    // Check if it's this team's turn (admins can bypass)
    if (teamId !== 0 && teamId !== auctionState.currentTurnTeam) {
      const currentTeam = auctionState.teams.find(t => t.id === auctionState.currentTurnTeam);
      return res.status(403).json({ 
        error: `Not your turn! It's ${currentTeam ? currentTeam.name : 'another team'}'s turn to nominate.` 
      });
    }
    
    const players = await getAvailablePlayers();
    const player = players.find(p => p.id === playerId);

    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Add franchise shorthand to player info
    const franchise = TEAMS.find(t => t.id === player.franchiseId);
    player.franchiseShorthand = franchise ? franchise.shorthand : 'N/A';

    if (auctionState.auctionActive) {
      return res.status(400).json({ error: 'Auction already in progress' });
    }
    
    // Check if team can nominate and if position is allowed
    if (teamId !== 0) { // Skip check for admin
      const nominationCheck = await canTeamNominate(teamId);
      
      if (!nominationCheck.canNominate) {
        return res.status(400).json({ error: nominationCheck.reason });
      }
      
      // If restricted, check if nominated player position is allowed
      if (nominationCheck.restricted && nominationCheck.allowedPositions.length > 0) {
        if (!nominationCheck.allowedPositions.includes(player.position)) {
          return res.status(400).json({ 
            error: `You must nominate a ${nominationCheck.allowedPositions.join(' or ')} to meet minimum requirements!` 
          });
        }
      }
    }

    auctionState = {
      currentPlayer: player,
      currentBid: player.basePrice,
      currentBidder: teamId,
      teamsOut: [],
      auctionActive: true,
      rtmPhase: false,
      rtmEligibleTeam: null,
      pendingWinner: null,
      pendingPrice: null,
      timerActive: false,
      timeRemaining: 0,
      rtmTimerActive: false,
      rtmTimeRemaining: 0,
      nominationOrder: auctionState.nominationOrder,
      currentTurnIndex: auctionState.currentTurnIndex,
      currentTurnTeam: auctionState.currentTurnTeam,
      teams: auctionState.teams
    };

    broadcast({ type: 'auction_start', state: auctionState });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Place bid
app.post('/api/auction/bid', async (req, res) => {
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
    
    // Check overseas quota if current player is overseas
    if (auctionState.currentPlayer && auctionState.currentPlayer.overseas) {
      const overseasCount = await getTeamOverseasCount(teamId);
      if (overseasCount >= 10) {
        return res.status(400).json({ 
          error: 'Cannot bid on overseas player - Maximum 10 overseas players limit reached!' 
        });
      }
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

    broadcast({ type: 'team_out', state: auctionState });
    
    // Check if only one team remains and start timer
    checkAndStartTimer();

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
  try {
    console.log('📡 API /api/teams requested');
    
    if (!auctionState || !auctionState.teams) {
      console.error('❌ ERROR: auctionState.teams is undefined!');
      console.error('   auctionState:', auctionState);
      return res.status(500).json({ 
        error: 'Server state not initialized', 
        teams: TEAMS.map(t => ({
          id: t.id,
          name: t.name,
          shorthand: t.shorthand,
          budget: t.budget,
          color: t.color
        }))
      });
    }
    
    console.log('  Teams in state:', auctionState.teams.length);
    
    const teamsData = auctionState.teams.map(t => ({
      id: t.id,
      name: t.name,
      shorthand: t.shorthand,
      budget: t.budget,
      color: t.color
    }));
    
    console.log('  Sending teams:', teamsData.map(t => `${t.name} (${t.shorthand})`).join(', '));
    res.json(teamsData);
  } catch (error) {
    console.error('❌ ERROR in /api/teams:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all teams with detailed info (player counts, etc)
app.get('/api/teams/detailed', async (req, res) => {
  try {
    const teamsWithDetails = await Promise.all(auctionState.teams.map(async (team) => {
      const players = await getTeamPlayers(team.id);
      return {
        id: team.id,
        name: team.name,
        shorthand: team.shorthand,
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

    // Stop RTM timer
    stopRTMTimer();

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

// Admin: Download Excel file
app.get('/api/admin/download-excel', (req, res) => {
  try {
    console.log('📥 Admin downloading Excel file');
    
    if (!fs.existsSync(DATA_PATH)) {
      console.log('❌ Excel file not found');
      return res.status(404).json({ error: 'Excel file not found' });
    }
    
    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=auction_data.xlsx');
    
    // Stream the file to response
    const fileStream = fs.createReadStream(DATA_PATH);
    fileStream.pipe(res);
    
    fileStream.on('end', () => {
      console.log('✅ Excel file downloaded successfully');
    });
    
    fileStream.on('error', (err) => {
      console.error('❌ Error streaming Excel file:', err);
      res.status(500).json({ error: 'Failed to download Excel file' });
    });
  } catch (err) {
    console.error('❌ Error downloading Excel file:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// FANTASY LEAGUE API ENDPOINTS
// ========================================

const { calculateFantasyPoints, SCORING_RULES } = require('./fantasy');

// Get current gameweek
app.get('/api/fantasy/gameweek/current', async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    const gwSheet = workbook.getWorksheet('Gameweeks');
    
    let currentGW = null;
    gwSheet.eachRow((row, num) => {
      if (num > 1 && row.getCell(2).value === 'Active') {
        currentGW = {
          gameweek: row.getCell(1).value,
          status: row.getCell(2).value,
          startDate: row.getCell(3).value,
          endDate: row.getCell(4).value
        };
      }
    });
    
    res.json(currentGW || { gameweek: 0, status: 'Not Started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create/Update gameweek
app.post('/api/fantasy/gameweek', async (req, res) => {
  try {
    const { gameweek, status, startDate, endDate } = req.body;
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    const gwSheet = workbook.getWorksheet('Gameweeks');
    
    // Check if gameweek exists
    let existingRow = null;
    gwSheet.eachRow((row, num) => {
      if (num > 1 && row.getCell(1).value === gameweek) {
        existingRow = num;
      }
    });
    
    if (existingRow) {
      // Update existing
      const row = gwSheet.getRow(existingRow);
      row.getCell(2).value = status;
      row.getCell(3).value = startDate;
      row.getCell(4).value = endDate;
      row.commit();
    } else {
      // Add new
      gwSheet.addRow({ gameweek, status, startDate, endDate });
    }
    
    await workbook.xlsx.writeFile(DATA_PATH);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit player performance for a match
app.post('/api/fantasy/performance', async (req, res) => {
  try {
    const { matchId, gameweek, playerId, playerName, position, stats } = req.body;
    
    // Calculate fantasy points
    const fantasyPoints = calculateFantasyPoints(stats, position);
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    const perfSheet = workbook.getWorksheet('Player Performance');
    
    // Check if performance already exists
    let existingRow = null;
    perfSheet.eachRow((row, num) => {
      if (num > 1 && row.getCell(1).value === matchId && row.getCell(3).value === playerId) {
        existingRow = num;
      }
    });
    
    const perfData = [
      matchId,
      gameweek,
      playerId,
      playerName,
      position,
      stats.runs || 0,
      stats.ballsFaced || 0,
      stats.fours || 0,
      stats.sixes || 0,
      stats.wickets || 0,
      stats.oversBowled || 0,
      stats.runsConceded || 0,
      stats.maidens || 0,
      stats.catches || 0,
      stats.stumpings || 0,
      stats.runOuts || 0,
      fantasyPoints
    ];
    
    if (existingRow) {
      // Update existing
      const row = perfSheet.getRow(existingRow);
      perfData.forEach((value, index) => {
        row.getCell(index + 1).value = value;
      });
      row.commit();
    } else {
      // Add new
      perfSheet.addRow(perfData);
    }
    
    await workbook.xlsx.writeFile(DATA_PATH);
    
    broadcast({
      type: 'performance_updated',
      gameweek,
      playerId,
      playerName,
      fantasyPoints
    });
    
    res.json({ success: true, fantasyPoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get leaderboard for a gameweek
app.get('/api/fantasy/leaderboard/:gameweek', async (req, res) => {
  try {
    const gameweek = parseInt(req.params.gameweek);
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    
    const perfSheet = workbook.getWorksheet('Player Performance');
    const soldSheet = workbook.getWorksheet('Sold Players');
    
    // Get all sold players with team info
    const teamPlayers = {};
    soldSheet.eachRow((row, num) => {
      if (num > 1) {
        const playerId = row.getCell(1).value;
        const teamId = row.getCell(4).value;
        const teamName = row.getCell(5).value;
        
        if (!teamPlayers[teamId]) {
          teamPlayers[teamId] = {
            teamId,
            teamName,
            players: [],
            totalPoints: 0
          };
        }
        
        teamPlayers[teamId].players.push({
          playerId,
          playerName: row.getCell(2).value,
          position: row.getCell(3).value,
          points: 0
        });
      }
    });
    
    // Get performance data for this gameweek
    perfSheet.eachRow((row, num) => {
      if (num > 1 && row.getCell(2).value === gameweek) {
        const playerId = row.getCell(3).value;
        const fantasyPoints = row.getCell(17).value || 0;
        
        // Find which team this player belongs to
        Object.keys(teamPlayers).forEach(teamId => {
          const player = teamPlayers[teamId].players.find(p => p.playerId === playerId);
          if (player) {
            player.points = fantasyPoints;
            player.runs = row.getCell(6).value || 0;
            player.wickets = row.getCell(10).value || 0;
            player.catches = row.getCell(14).value || 0;
            teamPlayers[teamId].totalPoints += fantasyPoints;
          }
        });
      }
    });
    
    // Convert to array and sort by points
    const leaderboard = Object.values(teamPlayers).sort((a, b) => b.totalPoints - a.totalPoints);
    
    res.json({ gameweek, leaderboard });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get team performance for a specific gameweek
app.get('/api/fantasy/team/:teamId/gameweek/:gameweek', async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const gameweek = parseInt(req.params.gameweek);
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    
    const perfSheet = workbook.getWorksheet('Player Performance');
    const soldSheet = workbook.getWorksheet('Sold Players');
    
    // Get team's players
    const teamPlayerIds = [];
    soldSheet.eachRow((row, num) => {
      if (num > 1 && row.getCell(4).value === teamId) {
        teamPlayerIds.push(row.getCell(1).value);
      }
    });
    
    // Get performance for team's players in this gameweek
    const playerPerformances = [];
    let totalPoints = 0;
    
    perfSheet.eachRow((row, num) => {
      if (num > 1 && row.getCell(2).value === gameweek) {
        const playerId = row.getCell(3).value;
        if (teamPlayerIds.includes(playerId)) {
          const perf = {
            playerId,
            playerName: row.getCell(4).value,
            position: row.getCell(5).value,
            runs: row.getCell(6).value || 0,
            wickets: row.getCell(10).value || 0,
            catches: row.getCell(14).value || 0,
            fantasyPoints: row.getCell(17).value || 0
          };
          playerPerformances.push(perf);
          totalPoints += perf.fantasyPoints;
        }
      }
    });
    
    res.json({ teamId, gameweek, players: playerPerformances, totalPoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// AUTO-STATS API ENDPOINTS
// ========================================

// Get auto-stats service status
app.get('/api/autostats/status', (req, res) => {
  const cricketApi = require('./cricketApi');
  const apiStatus = cricketApi.getApiKeyStatus();
  
  res.json({
    enabled: autoStatsEnabled,
    apiKeyConfigured: apiStatus.configured,
    apiProvider: apiStatus.provider,
    recommendedProvider: apiStatus.recommended
  });
});

// Enable/disable auto-stats service
app.post('/api/autostats/toggle', (req, res) => {
  try {
    const { enabled } = req.body;
    autoStatsEnabled = enabled;
    
    if (enabled) {
      autoStatsService.startAutoStatsService();
      console.log('✅ Auto-stats service enabled');
    } else {
      console.log('⏸️  Auto-stats service disabled');
    }
    
    res.json({ success: true, enabled: autoStatsEnabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger immediate stats fetch (for testing/manual)
app.post('/api/autostats/fetch', async (req, res) => {
  try {
    console.log('🚀 Manual stats fetch triggered via API');
    
    // Don't wait for completion, respond immediately
    res.json({ success: true, message: 'Stats fetch started in background' });
    
    // Run in background
    autoStatsService.triggerImmediateFetch();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set current gameweek for auto-stats
app.post('/api/autostats/gameweek', (req, res) => {
  try {
    const { gameweek } = req.body;
    
    if (!gameweek || gameweek < 1) {
      return res.status(400).json({ error: 'Invalid gameweek' });
    }
    
    autoStatsService.setCurrentGameweek(gameweek);
    res.json({ success: true, gameweek });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear processed matches cache (for testing)
app.post('/api/autostats/clear-cache', (req, res) => {
  try {
    autoStatsService.clearProcessedCache();
    res.json({ success: true, message: 'Cache cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test: Fetch specific match by ID (for testing any match)
app.post('/api/autostats/test-match', async (req, res) => {
  try {
    const { matchId } = req.body;
    
    if (!matchId) {
      return res.status(400).json({ error: 'matchId required' });
    }
    
    console.log(`🧪 TEST MODE: Fetching match ${matchId}`);
    
    // Don't wait for completion, respond immediately
    res.json({ 
      success: true, 
      message: `Testing match ${matchId} in background`,
      matchId 
    });
    
    // Process in background
    autoStatsService.testSpecificMatch(matchId);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get recent matches list (for finding match IDs)
app.get('/api/autostats/matches', async (req, res) => {
  try {
    const cricketApi = require('./cricketApi');
    const matchesData = await cricketApi.getCurrentMatches();
    
    // Return all matches with their IDs for testing
    const matches = matchesData.data || [];
    const matchList = matches.map(m => ({
      id: m.id,
      name: m.name,
      series: m.series || m.seriesName,
      status: m.status,
      matchType: m.matchType,
      matchEnded: m.matchEnded
    }));
    
    res.json({ 
      success: true, 
      count: matchList.length,
      matches: matchList 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Initialize and start server
initializeExcel().then(async () => {
  await loadTeamStateFromExcel();
  
  // Start auto-stats service if API key is configured
  if (process.env.CRICKET_API_KEY) {
    console.log('🏏 Cricket API key found - enabling auto-stats service');
    autoStatsEnabled = true;
    autoStatsService.startAutoStatsService();
  } else {
    console.log('⚠️  CRICKET_API_KEY not set - auto-stats disabled');
    console.log('   Set CRICKET_API_KEY environment variable to enable automatic stats fetching');
  }
  
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});

