// Automatic Stats Fetching Service
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const path = require('path');
const {
  getCurrentMatches,
  getSchedule,
  getMatchScorecard,
  filterIPLMatches,
  parsePlayerStats,
  matchPlayerName
} = require('./cricketApi');
const { calculateFantasyPoints } = require('./fantasy');

const DATA_PATH = path.join(__dirname, '../data/auction_data.xlsx');

let broadcastCallback = null;
let currentGameweek = 1;
let currentSeason = process.env.IPL_SEASON || '2025'; // e.g. IPL2025
let processedMatches = new Set(); // Track matches we've already processed

/**
 * Set broadcast function for WebSocket updates
 */
function setBroadcast(fn) {
  broadcastCallback = fn;
}

/**
 * Set current gameweek
 */
function setCurrentGameweek(gw) {
  currentGameweek = gw;
  console.log(`📅 Auto-stats service set to gameweek ${gw}`);
}

/**
 * Set current season for schedule (e.g. '2025' or 'IPL2025')
 */
function setCurrentSeason(season) {
  currentSeason = String(season || '2025').replace(/\D/g, '') || '2025';
  console.log(`📅 Auto-stats service set to season IPL ${currentSeason}`);
}

/**
 * Broadcast update to all connected clients
 */
function broadcast(message) {
  if (broadcastCallback) {
    broadcastCallback(message);
  }
}

/**
 * Get all sold players from Excel
 */
async function getAllSoldPlayers() {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    const soldSheet = workbook.getWorksheet('Sold Players');
    
    const players = [];
    soldSheet.eachRow((row, num) => {
      if (num > 1) {
        players.push({
          playerId: row.getCell(1).value,
          playerName: row.getCell(2).value,
          position: row.getCell(3).value,
          teamId: row.getCell(4).value,
          teamName: row.getCell(5).value
        });
      }
    });
    
    return players;
  } catch (err) {
    console.error('❌ Error loading sold players:', err.message);
    return [];
  }
}

/**
 * Check if performance already exists
 */
async function performanceExists(matchId, playerId) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    const perfSheet = workbook.getWorksheet('Player Performance');
    
    let exists = false;
    perfSheet.eachRow((row, num) => {
      if (num > 1 && row.getCell(1).value === matchId && row.getCell(3).value === playerId) {
        exists = true;
      }
    });
    
    return exists;
  } catch (err) {
    return false;
  }
}

/**
 * Save player performance to Excel
 */
async function savePlayerPerformance(matchId, gameweek, player, stats, fantasyPoints) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    const perfSheet = workbook.getWorksheet('Player Performance');
    
    // Check if already exists
    let existingRow = null;
    perfSheet.eachRow((row, num) => {
      if (num > 1 && row.getCell(1).value === matchId && row.getCell(3).value === player.playerId) {
        existingRow = num;
      }
    });
    
    const perfData = {
      matchId,
      gameweek,
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      runs: stats.runs || 0,
      ballsFaced: stats.ballsFaced || 0,
      fours: stats.fours || 0,
      sixes: stats.sixes || 0,
      wickets: stats.wickets || 0,
      oversBowled: stats.oversBowled || 0,
      runsConceded: stats.runsConceded || 0,
      maidens: stats.maidens || 0,
      catches: stats.catches || 0,
      stumpings: stats.stumpings || 0,
      runOuts: stats.runOuts || 0,
      fantasyPoints
    };
    
    if (existingRow) {
      // Update existing
      const row = perfSheet.getRow(existingRow);
      Object.keys(perfData).forEach((key, index) => {
        row.getCell(index + 1).value = perfData[key];
      });
      row.commit();
    } else {
      // Add new
      perfSheet.addRow(perfData);
    }
    
    await workbook.xlsx.writeFile(DATA_PATH);
    return true;
  } catch (err) {
    console.error(`❌ Error saving performance for ${player.playerName}:`, err.message);
    return false;
  }
}

/**
 * Process a completed match
 */
async function processMatch(match) {
  const matchId = match.id;
  const matchName = match.name || 'Unknown';
  
  // Skip if already processed
  if (processedMatches.has(matchId)) {
    return;
  }
  
  console.log(`\n🏏 Processing match: ${matchName} (ID: ${matchId})`);
  
  try {
    // Get scorecard
    const scorecard = await getMatchScorecard(matchId);
    if (!scorecard || !scorecard.data) {
      console.log('⚠️  No scorecard data available yet');
      return;
    }
    
    // Parse player stats from scorecard
    const apiPlayerStats = parsePlayerStats(scorecard);
    console.log(`📊 Found stats for ${apiPlayerStats.length} players`);
    
    // Get our sold players
    const soldPlayers = await getAllSoldPlayers();
    console.log(`👥 Matching against ${soldPlayers.length} sold players`);
    
    let matchedCount = 0;
    let savedCount = 0;
    
    // Match and save stats for our players
    for (const apiStats of apiPlayerStats) {
      // Try to find matching player in our database
      const matchedPlayer = soldPlayers.find(sp => 
        matchPlayerName(apiStats.playerName, sp.playerName)
      );
      
      if (matchedPlayer) {
        matchedCount++;
        
        // Check if we already have this data
        const exists = await performanceExists(matchId, matchedPlayer.playerId);
        if (exists) {
          console.log(`⏭️  Already have stats for ${matchedPlayer.playerName}`);
          continue;
        }
        
        // Calculate fantasy points
        const fantasyPoints = calculateFantasyPoints(apiStats, matchedPlayer.position);
        
        console.log(`✅ ${matchedPlayer.playerName}: ${fantasyPoints} points`);
        console.log(`   Runs: ${apiStats.runs}, Wickets: ${apiStats.wickets}, Catches: ${apiStats.catches}`);
        
        // Save to Excel
        const saved = await savePlayerPerformance(
          matchId,
          currentGameweek,
          matchedPlayer,
          apiStats,
          fantasyPoints
        );
        
        if (saved) {
          savedCount++;
          
          // Broadcast update to all clients
          broadcast({
            type: 'auto_stats_update',
            gameweek: currentGameweek,
            matchId,
            matchName,
            playerId: matchedPlayer.playerId,
            playerName: matchedPlayer.playerName,
            teamName: matchedPlayer.teamName,
            fantasyPoints,
            stats: {
              runs: apiStats.runs,
              wickets: apiStats.wickets,
              catches: apiStats.catches
            }
          });
        }
        
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`\n📈 Match processing complete:`);
    console.log(`   - Matched: ${matchedCount} players`);
    console.log(`   - Saved: ${savedCount} new performances`);
    
    // Mark match as processed
    processedMatches.add(matchId);
    
    // Broadcast completion
    if (savedCount > 0) {
      broadcast({
        type: 'match_processed',
        matchId,
        matchName,
        gameweek: currentGameweek,
        playersUpdated: savedCount
      });
    }
    
  } catch (err) {
    console.error(`❌ Error processing match ${matchId}:`, err.message);
  }
}

/**
 * Check for completed IPL matches and fetch stats.
 * Schedule-first: get schedule for current season → filter completed → fetch scorecard & stats per match.
 */
async function checkAndFetchStats() {
  console.log('\n🔍 Checking for completed IPL matches (schedule-first)...');

  try {
    // 1) Get schedule for current season (IPL 2025, etc.)
    const scheduleData = await getSchedule(currentSeason);
    let iplMatches = scheduleData.data || [];

    // 2) If schedule is empty, fallback to live/recent/upcoming
    if (iplMatches.length === 0) {
      console.log('📋 No schedule for season, trying current/live matches...');
      const currentData = await getCurrentMatches();
      iplMatches = filterIPLMatches(currentData);
    }

    console.log(`📋 Found ${iplMatches.length} IPL matches (season ${currentSeason})`);

    if (iplMatches.length === 0) {
      console.log('⚠️  No IPL matches found. Set IPL_SEASON or IPL_SERIES_ID_2025 for schedule, or ensure API returns live/recent matches.');
      return;
    }

    // 3) Process completed matches only
    const completedMatches = iplMatches.filter(m =>
      m.matchEnded === true ||
      (m.status && /won|completed|finished|complete/i.test(String(m.status)))
    );

    console.log(`✅ ${completedMatches.length} completed matches to process`);

    for (const match of completedMatches) {
      await processMatch(match);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (err) {
    console.error('❌ Error in auto-stats check:', err.message);
  }
}

/**
 * Manual trigger for testing/immediate fetch
 */
async function triggerImmediateFetch() {
  console.log('🚀 Manual stats fetch triggered');
  await checkAndFetchStats();
}

/**
 * Start the auto-stats service
 */
function startAutoStatsService() {
  console.log('\n🚀 Starting Auto-Stats Service');
  console.log('   - Checking every 10 minutes for completed matches');
  console.log('   - Will auto-fetch and calculate fantasy points');
  
  // Run immediately on start
  setTimeout(() => {
    checkAndFetchStats();
  }, 5000); // Wait 5 seconds after server start
  
  // Schedule to run every 10 minutes
  // Cron format: minute hour day month weekday
  cron.schedule('*/10 * * * *', () => {
    checkAndFetchStats();
  });
  
  console.log('✅ Auto-Stats Service running!\n');
}

/**
 * Get scorecard + player stats + league players with fantasy points (preview, no save).
 * Used by admin UI to show match detail before "Add to leaderboard".
 */
async function getMatchScorecardPreview(matchId, matchName = null) {
  try {
    const scorecard = await getMatchScorecard(matchId);
    if (!scorecard || !scorecard.data) {
      return {
        success: false,
        error: 'No scorecard data available for this match ID. Use a match ID from Cricbuzz.com (in the URL: .../live-cricket-scores/12345/...) or load schedule when IPL/live matches are available.'
      };
    }
    const apiPlayerStats = parsePlayerStats(scorecard);
    const soldPlayers = await getAllSoldPlayers();
    const leaguePlayers = [];
    for (const apiStats of apiPlayerStats) {
      const matchedPlayer = soldPlayers.find(sp =>
        matchPlayerName(apiStats.playerName, sp.playerName)
      );
      if (matchedPlayer) {
        const fantasyPoints = calculateFantasyPoints(apiStats, matchedPlayer.position);
        leaguePlayers.push({
          playerId: matchedPlayer.playerId,
          playerName: matchedPlayer.playerName,
          teamName: matchedPlayer.teamName,
          position: matchedPlayer.position,
          runs: apiStats.runs || 0,
          ballsFaced: apiStats.ballsFaced || 0,
          fours: apiStats.fours || 0,
          sixes: apiStats.sixes || 0,
          wickets: apiStats.wickets || 0,
          oversBowled: apiStats.oversBowled || 0,
          runsConceded: apiStats.runsConceded || 0,
          catches: apiStats.catches || 0,
          stumpings: apiStats.stumpings || 0,
          fantasyPoints
        });
      }
    }
    return {
      success: true,
      matchId,
      matchName: matchName || `Match ${matchId}`,
      allPlayers: apiPlayerStats.map(p => ({
        playerName: p.playerName,
        runs: p.runs || 0,
        ballsFaced: p.ballsFaced || 0,
        fours: p.fours || 0,
        sixes: p.sixes || 0,
        wickets: p.wickets || 0,
        oversBowled: p.oversBowled || 0,
        runsConceded: p.runsConceded || 0,
        catches: p.catches || 0,
        stumpings: p.stumpings || 0
      })),
      leaguePlayers
    };
  } catch (err) {
    console.error(`❌ getMatchScorecardPreview ${matchId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Clear processed matches cache (for testing)
 */
function clearProcessedCache() {
  processedMatches.clear();
  console.log('🗑️  Cleared processed matches cache');
}

/**
 * Test specific match by ID (for testing any match, not just IPL)
 */
async function testSpecificMatch(matchId) {
  console.log(`\n🧪 TEST MODE: Processing match ${matchId}`);
  
  try {
    // Create a mock match object
    const testMatch = {
      id: matchId,
      name: `Test Match ${matchId}`,
      matchEnded: true, // Pretend it's completed for testing
      status: 'Testing'
    };
    
    // Remove from processed cache so we can reprocess
    processedMatches.delete(matchId);
    
    // Process the match
    await processMatch(testMatch);
    
    console.log(`✅ Test processing complete for match ${matchId}`);
  } catch (err) {
    console.error(`❌ Error testing match ${matchId}:`, err.message);
  }
}

module.exports = {
  startAutoStatsService,
  setBroadcast,
  setCurrentGameweek,
  setCurrentSeason,
  getMatchScorecardPreview,
  triggerImmediateFetch,
  clearProcessedCache,
  testSpecificMatch
};
