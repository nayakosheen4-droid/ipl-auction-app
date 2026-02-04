// Automatic Stats Fetching Service
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const path = require('path');
const {
  getCurrentMatches,
  getMatchScorecard,
  filterIPLMatches,
  parsePlayerStats,
  matchPlayerName
} = require('./cricketApi');
const { calculateFantasyPoints } = require('./fantasy');

const DATA_PATH = path.join(__dirname, '../data/auction_data.xlsx');

let broadcastCallback = null;
let currentGameweek = 1;
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
 * Check for completed IPL matches and fetch stats
 */
async function checkAndFetchStats() {
  console.log('\n🔍 Checking for completed IPL matches...');
  
  try {
    // Get current matches
    const matchesData = await getCurrentMatches();
    const iplMatches = filterIPLMatches(matchesData);
    
    console.log(`📋 Found ${iplMatches.length} IPL matches`);
    
    if (iplMatches.length === 0) {
      console.log('⚠️  No IPL matches found. This is normal if IPL season hasn\'t started.');
      return;
    }
    
    // Process completed matches
    const completedMatches = iplMatches.filter(m => 
      m.matchEnded === true || 
      m.status?.toLowerCase().includes('won') ||
      m.status?.toLowerCase().includes('completed')
    );
    
    console.log(`✅ ${completedMatches.length} completed matches to process`);
    
    for (const match of completedMatches) {
      await processMatch(match);
      // Delay between matches to respect API limits
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
 * Clear processed matches cache (for testing)
 */
function clearProcessedCache() {
  processedMatches.clear();
  console.log('🗑️  Cleared processed matches cache');
}

module.exports = {
  startAutoStatsService,
  setBroadcast,
  setCurrentGameweek,
  triggerImmediateFetch,
  clearProcessedCache
};
