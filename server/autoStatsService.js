/**
 * Auto-stats and match scorecard preview – uses cricketdata.org only.
 */
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const path = require('path');
const cricketdata = require('./cricketdataService');
const { calculateFantasyPoints } = require('./fantasy');

const DATA_PATH = path.join(__dirname, '../data/auction_data.xlsx');

let broadcastCallback = null;
let currentGameweek = 1;
let currentSeason = process.env.IPL_SEASON || '2025';
let processedMatches = new Set();

function setBroadcast(fn) {
  broadcastCallback = fn;
}

function setCurrentGameweek(gw) {
  currentGameweek = gw;
  console.log('📅 Auto-stats: gameweek', gw);
}

function setCurrentSeason(season) {
  currentSeason = String(season || '2025').replace(/\D/g, '') || '2025';
  console.log('📅 Auto-stats: season IPL', currentSeason);
}

function broadcast(message) {
  if (broadcastCallback) broadcastCallback(message);
}

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
    console.error('❌ getAllSoldPlayers:', err.message);
    return [];
  }
}

async function performanceExists(matchId, playerId) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    const perfSheet = workbook.getWorksheet('Player Performance');
    let exists = false;
    perfSheet.eachRow((row, num) => {
      if (num > 1 && row.getCell(1).value === matchId && row.getCell(3).value === playerId) exists = true;
    });
    return exists;
  } catch (err) {
    return false;
  }
}

async function savePlayerPerformance(matchId, gameweek, player, stats, fantasyPoints) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DATA_PATH);
    const perfSheet = workbook.getWorksheet('Player Performance');
    let existingRow = null;
    perfSheet.eachRow((row, num) => {
      if (num > 1 && row.getCell(1).value === matchId && row.getCell(3).value === player.playerId) existingRow = num;
    });
    const perfData = [
      matchId, gameweek, player.playerId, player.playerName, player.position,
      stats.runs || 0, stats.ballsFaced || 0, stats.fours || 0, stats.sixes || 0,
      stats.wickets || 0, stats.oversBowled || 0, stats.runsConceded || 0, stats.maidens || 0,
      stats.catches || 0, stats.stumpings || 0, stats.runOuts || 0, fantasyPoints
    ];
    if (existingRow) {
      const row = perfSheet.getRow(existingRow);
      perfData.forEach((value, index) => { row.getCell(index + 1).value = value; });
      row.commit();
    } else {
      perfSheet.addRow(perfData);
    }
    await workbook.xlsx.writeFile(DATA_PATH);
    return true;
  } catch (err) {
    console.error('❌ savePlayerPerformance:', err.message);
    return false;
  }
}

function parsePlayerStats(scorecard) {
  const playerStats = [];
  if (!scorecard || !scorecard.data || !scorecard.data.score) return playerStats;
  const data = scorecard.data;
  data.score.forEach(inning => {
    if (inning.r && Array.isArray(inning.r)) {
      inning.r.forEach(batsman => {
        const playerName = batsman.batsmanName || batsman.batsman;
        const runs = parseInt(batsman.r) || 0;
        const balls = parseInt(batsman.b) || 0;
        const fours = parseInt(batsman['4s']) || 0;
        const sixes = parseInt(batsman['6s']) || 0;
        let player = playerStats.find(p => p.playerName === playerName);
        if (!player) {
          player = {
            playerName,
            runs: 0, ballsFaced: 0, fours: 0, sixes: 0, wickets: 0, oversBowled: 0,
            runsConceded: 0, maidens: 0, catches: 0, stumpings: 0, runOuts: 0, strikeRate: 0, economyRate: 0
          };
          playerStats.push(player);
        }
        player.runs = runs;
        player.ballsFaced = balls;
        player.fours = fours;
        player.sixes = sixes;
        player.strikeRate = balls ? Math.round((runs / balls) * 100) : 0;
      });
    }
    if (inning.w && Array.isArray(inning.w)) {
      inning.w.forEach(bowler => {
        const playerName = bowler.bowlerName || bowler.bowler;
        const overs = parseFloat(bowler.o) || 0;
        const maidens = parseInt(bowler.m) || 0;
        const runs = parseInt(bowler.r) || 0;
        const wickets = parseInt(bowler.w) || 0;
        const economy = parseFloat(bowler.eco) || 0;
        let player = playerStats.find(p => p.playerName === playerName);
        if (!player) {
          player = {
            playerName,
            runs: 0, ballsFaced: 0, fours: 0, sixes: 0, wickets: 0, oversBowled: 0,
            runsConceded: 0, maidens: 0, catches: 0, stumpings: 0, runOuts: 0, strikeRate: 0, economyRate: 0
          };
          playerStats.push(player);
        }
        player.wickets = wickets;
        player.oversBowled = overs;
        player.runsConceded = runs;
        player.maidens = maidens;
        player.economyRate = economy;
      });
    }
  });
  return playerStats;
}

function matchPlayerName(apiPlayerName, ourPlayerName) {
  const normalize = name => (name || '').toLowerCase().replace(/[^a-z]/g, '');
  const apiNorm = normalize(apiPlayerName);
  const ourNorm = normalize(ourPlayerName);
  if (apiNorm === ourNorm) return true;
  if (apiNorm.includes(ourNorm) || ourNorm.includes(apiNorm)) return true;
  const apiParts = apiNorm.split(/\s+/).filter(p => p.length > 2);
  const ourParts = ourNorm.split(/\s+/).filter(p => p.length > 2);
  if (apiParts.length && ourParts.length && apiParts[apiParts.length - 1] === ourParts[ourParts.length - 1]) return true;
  return false;
}

async function processMatch(match) {
  const matchId = match.id;
  const matchName = match.name || 'Unknown';
  if (processedMatches.has(matchId)) return;
  console.log(`🏏 Processing: ${matchName} (${matchId})`);
  try {
    const scorecard = await cricketdata.getMatchScorecard(matchId);
    if (!scorecard || !scorecard.data) {
      console.log('⚠️  No scorecard yet');
      return;
    }
    const apiPlayerStats = parsePlayerStats(scorecard);
    const soldPlayers = await getAllSoldPlayers();
    let savedCount = 0;
    for (const apiStats of apiPlayerStats) {
      const matchedPlayer = soldPlayers.find(sp => matchPlayerName(apiStats.playerName, sp.playerName));
      if (!matchedPlayer) continue;
      if (await performanceExists(matchId, matchedPlayer.playerId)) continue;
      const fantasyPoints = calculateFantasyPoints(apiStats, matchedPlayer.position);
      const saved = await savePlayerPerformance(matchId, currentGameweek, matchedPlayer, apiStats, fantasyPoints);
      if (saved) {
        savedCount++;
        broadcast({
          type: 'auto_stats_update',
          gameweek: currentGameweek,
          matchId,
          matchName,
          playerId: matchedPlayer.playerId,
          playerName: matchedPlayer.playerName,
          teamName: matchedPlayer.teamName,
          fantasyPoints,
          stats: { runs: apiStats.runs, wickets: apiStats.wickets, catches: apiStats.catches }
        });
      }
    }
    processedMatches.add(matchId);
    if (savedCount > 0) {
      broadcast({ type: 'match_processed', matchId, matchName, gameweek: currentGameweek, playersUpdated: savedCount });
    }
  } catch (err) {
    console.error(`❌ processMatch ${matchId}:`, err.message);
  }
}

async function checkAndFetchStats() {
  console.log('🔍 Checking IPL 2025 completed matches...');
  try {
    const { data: iplMatches } = await cricketdata.getIPL2025Schedule();
    const completed = (iplMatches || []).filter(m =>
      m.matchEnded === true || (m.status && /won|completed|finished|complete/i.test(String(m.status)))
    );
    for (const match of completed) {
      await processMatch(match);
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch (err) {
    console.error('❌ checkAndFetchStats:', err.message);
  }
}

function triggerImmediateFetch() {
  console.log('🚀 Manual stats fetch');
  checkAndFetchStats();
}

function startAutoStatsService() {
  console.log('🚀 Auto-stats service started (cricketdata.org, IPL 2025)');
  setTimeout(() => checkAndFetchStats(), 5000);
  cron.schedule('*/10 * * * *', () => checkAndFetchStats());
}

async function getMatchScorecardPreview(matchId, matchName = null) {
  try {
    const scorecard = await cricketdata.getMatchScorecard(matchId);
    if (!scorecard || !scorecard.data) {
      return {
        success: false,
        error: 'No scorecard for this match. Select a completed IPL 2025 match from the schedule.'
      };
    }
    const apiPlayerStats = parsePlayerStats(scorecard);
    const soldPlayers = await getAllSoldPlayers();
    const leaguePlayers = [];
    for (const apiStats of apiPlayerStats) {
      const matchedPlayer = soldPlayers.find(sp => matchPlayerName(apiStats.playerName, sp.playerName));
      if (matchedPlayer) {
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
          fantasyPoints: calculateFantasyPoints(apiStats, matchedPlayer.position)
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
    console.error('❌ getMatchScorecardPreview:', err.message);
    return { success: false, error: err.message };
  }
}

function clearProcessedCache() {
  processedMatches.clear();
  console.log('🗑️  Cleared processed matches cache');
}

async function testSpecificMatch(matchId) {
  console.log(`🧪 Test: adding match ${matchId} to leaderboard`);
  processedMatches.delete(matchId);
  await processMatch({ id: matchId, name: `Match ${matchId}`, matchEnded: true, status: 'Completed' });
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
