// Cricket API Integration
const axios = require('axios');

// API Configuration
const CRICKET_API_BASE = 'https://api.cricapi.com/v1';
const API_KEY = process.env.CRICKET_API_KEY || '';

// Cache for reducing API calls
let matchesCache = {
  data: null,
  timestamp: 0,
  ttl: 5 * 60 * 1000 // 5 minutes
};

/**
 * Get current/recent matches
 */
async function getCurrentMatches() {
  try {
    // Check cache first
    const now = Date.now();
    if (matchesCache.data && (now - matchesCache.timestamp) < matchesCache.ttl) {
      console.log('📦 Using cached matches data');
      return matchesCache.data;
    }
    
    if (!API_KEY) {
      console.warn('⚠️  CRICKET_API_KEY not set. Please add it to environment variables.');
      return { data: [] };
    }
    
    console.log('🌐 Fetching current matches from Cricket API...');
    const response = await axios.get(`${CRICKET_API_BASE}/currentMatches`, {
      params: { apikey: API_KEY, offset: 0 },
      timeout: 10000
    });
    
    // Update cache
    matchesCache.data = response.data;
    matchesCache.timestamp = now;
    
    return response.data;
  } catch (error) {
    console.error('❌ Error fetching matches:', error.message);
    return { data: [] };
  }
}

/**
 * Get detailed scorecard for a match
 */
async function getMatchScorecard(matchId) {
  try {
    if (!API_KEY) {
      console.warn('⚠️  CRICKET_API_KEY not set');
      return null;
    }
    
    console.log(`🌐 Fetching scorecard for match ${matchId}...`);
    const response = await axios.get(`${CRICKET_API_BASE}/match_scorecard`, {
      params: { apikey: API_KEY, id: matchId },
      timeout: 10000
    });
    
    return response.data;
  } catch (error) {
    console.error(`❌ Error fetching scorecard for ${matchId}:`, error.message);
    return null;
  }
}

/**
 * Get fantasy points for a match (if API provides it)
 */
async function getMatchFantasyPoints(matchId) {
  try {
    if (!API_KEY) {
      return null;
    }
    
    const response = await axios.get(`${CRICKET_API_BASE}/match_points`, {
      params: { apikey: API_KEY, id: matchId },
      timeout: 10000
    });
    
    return response.data;
  } catch (error) {
    console.error(`❌ Error fetching fantasy points for ${matchId}:`, error.message);
    return null;
  }
}

/**
 * Filter IPL matches from all matches
 */
function filterIPLMatches(matchesData) {
  if (!matchesData || !matchesData.data) {
    return [];
  }
  
  return matchesData.data.filter(match => {
    const matchName = (match.name || '').toLowerCase();
    const seriesName = (match.series || match.seriesName || '').toLowerCase();
    const matchType = (match.matchType || '').toLowerCase();
    
    // Check if it's an IPL match
    const isIPL = seriesName.includes('ipl') || 
                  seriesName.includes('indian premier league') ||
                  matchName.includes('ipl');
    
    // Only include T20 matches
    const isT20 = matchType === 't20' || matchType === 't20i';
    
    return isIPL && isT20;
  });
}

/**
 * Parse player stats from scorecard
 */
function parsePlayerStats(scorecard) {
  const playerStats = [];
  
  if (!scorecard || !scorecard.data) {
    return playerStats;
  }
  
  const data = scorecard.data;
  
  // Parse batting stats
  if (data.score) {
    data.score.forEach(inning => {
      if (inning.r && Array.isArray(inning.r)) {
        inning.r.forEach(batsman => {
          const playerName = batsman.batsmanName || batsman.batsman;
          const runs = parseInt(batsman.r) || 0;
          const balls = parseInt(batsman.b) || 0;
          const fours = parseInt(batsman['4s']) || 0;
          const sixes = parseInt(batsman['6s']) || 0;
          const strikeRate = parseFloat(batsman.sr) || 0;
          
          // Find or create player entry
          let player = playerStats.find(p => p.playerName === playerName);
          if (!player) {
            player = {
              playerName,
              runs: 0,
              ballsFaced: 0,
              fours: 0,
              sixes: 0,
              wickets: 0,
              oversBowled: 0,
              runsConceded: 0,
              maidens: 0,
              catches: 0,
              stumpings: 0,
              runOuts: 0,
              strikeRate: 0,
              economyRate: 0
            };
            playerStats.push(player);
          }
          
          player.runs = runs;
          player.ballsFaced = balls;
          player.fours = fours;
          player.sixes = sixes;
          player.strikeRate = strikeRate;
        });
      }
    });
  }
  
  // Parse bowling stats
  if (data.score) {
    data.score.forEach(inning => {
      if (inning.w && Array.isArray(inning.w)) {
        inning.w.forEach(bowler => {
          const playerName = bowler.bowlerName || bowler.bowler;
          const overs = parseFloat(bowler.o) || 0;
          const maidens = parseInt(bowler.m) || 0;
          const runs = parseInt(bowler.r) || 0;
          const wickets = parseInt(bowler.w) || 0;
          const economy = parseFloat(bowler.eco) || 0;
          
          // Find or create player entry
          let player = playerStats.find(p => p.playerName === playerName);
          if (!player) {
            player = {
              playerName,
              runs: 0,
              ballsFaced: 0,
              fours: 0,
              sixes: 0,
              wickets: 0,
              oversBowled: 0,
              runsConceded: 0,
              maidens: 0,
              catches: 0,
              stumpings: 0,
              runOuts: 0,
              strikeRate: 0,
              economyRate: 0
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
  }
  
  return playerStats;
}

/**
 * Match player names (fuzzy matching)
 */
function matchPlayerName(apiPlayerName, ourPlayerName) {
  const normalize = (name) => name.toLowerCase().replace(/[^a-z]/g, '');
  const apiNorm = normalize(apiPlayerName);
  const ourNorm = normalize(ourPlayerName);
  
  // Exact match
  if (apiNorm === ourNorm) return true;
  
  // Contains match (handles different name formats)
  if (apiNorm.includes(ourNorm) || ourNorm.includes(apiNorm)) return true;
  
  // Split and check if major parts match (e.g., "Virat Kohli" vs "V Kohli")
  const apiParts = apiNorm.split(' ').filter(p => p.length > 2);
  const ourParts = ourNorm.split(' ').filter(p => p.length > 2);
  
  if (apiParts.length > 0 && ourParts.length > 0) {
    // Check if last names match (most reliable)
    if (apiParts[apiParts.length - 1] === ourParts[ourParts.length - 1]) {
      return true;
    }
  }
  
  return false;
}

module.exports = {
  getCurrentMatches,
  getMatchScorecard,
  getMatchFantasyPoints,
  filterIPLMatches,
  parsePlayerStats,
  matchPlayerName,
  setApiKey: (key) => { API_KEY = key; }
};
