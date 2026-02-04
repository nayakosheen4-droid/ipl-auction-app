// Cricket API Integration with Multiple Providers
const axios = require('axios');

// API Provider Configuration
const API_PROVIDER = process.env.CRICKET_API_PROVIDER || 'rapidapi'; // 'rapidapi' or 'cricketdata'

// RapidAPI Cricbuzz (RECOMMENDED - More reliable, free tier available)
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const RAPIDAPI_HOST = 'free-cricbuzz-cricket-api.p.rapidapi.com';
const RAPIDAPI_BASE = `https://${RAPIDAPI_HOST}`;

// CricketData.org (Alternative)
const CRICKET_API_BASE = 'https://api.cricapi.com/v1';
const CRICKET_API_KEY = process.env.CRICKET_API_KEY || '';

// Active API Key based on provider
const API_KEY = API_PROVIDER === 'rapidapi' ? RAPIDAPI_KEY : CRICKET_API_KEY;

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
      console.warn(`⚠️  API Key not set for provider: ${API_PROVIDER}`);
      console.warn('   Set RAPIDAPI_KEY (recommended) or CRICKET_API_KEY environment variable');
      return { data: [] };
    }
    
    console.log(`🌐 Fetching matches from ${API_PROVIDER.toUpperCase()} API...`);
    
    let response;
    if (API_PROVIDER === 'rapidapi') {
      response = await getRapidAPIMatches();
    } else {
      response = await getCricketDataMatches();
    }
    
    // Update cache
    matchesCache.data = response;
    matchesCache.timestamp = now;
    
    return response;
  } catch (error) {
    console.error('❌ Error fetching matches:', error.message);
    return { data: [] };
  }
}

/**
 * Get matches from RapidAPI Cricbuzz
 */
async function getRapidAPIMatches() {
  // Try multiple possible endpoints
  const possibleEndpoints = [
    '/matches',
    '/cricket-matches', 
    '/live-matches',
    '/schedule',
    '/cricket-schedule'
  ];
  
  for (const endpoint of possibleEndpoints) {
    try {
      console.log(`🔍 Trying endpoint: ${endpoint}`);
      const response = await axios.get(`${RAPIDAPI_BASE}${endpoint}`, {
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': RAPIDAPI_HOST
        },
        timeout: 10000
      });
      
      console.log(`✅ Success with endpoint: ${endpoint}`);
      console.log('📊 Raw response structure:', JSON.stringify(response.data).substring(0, 500));
      console.log('📊 Response keys:', Object.keys(response.data));
      
      // Transform RapidAPI response to common format
      const transformed = transformRapidAPIMatches(response.data);
      console.log(`📋 Transformed to ${transformed.length} matches`);
      
      return {
        data: transformed
      };
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`   ❌ Endpoint ${endpoint} not found, trying next...`);
        continue;
      } else {
        console.error(`   ❌ Error with ${endpoint}:`, error.message);
        if (error.response) {
          console.error('      Status:', error.response.status);
          console.error('      Data:', JSON.stringify(error.response.data));
        }
      }
    }
  }
  
  // If all endpoints fail, return empty
  console.error('❌ All endpoints failed. This API might not have a matches list endpoint.');
  console.log('💡 You can still test specific matches using the Test Match feature!');
  return { data: [] };
}

/**
 * Get matches from CricketData.org
 */
async function getCricketDataMatches() {
  try {
    const response = await axios.get(`${CRICKET_API_BASE}/currentMatches`, {
      params: { apikey: CRICKET_API_KEY, offset: 0 },
      timeout: 10000
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ CricketData API error:', error.message);
    throw error;
  }
}

/**
 * Transform RapidAPI response to common format
 */
function transformRapidAPIMatches(rapidData) {
  const matches = [];
  
  console.log('🔍 Analyzing response structure...');
  
  // Check if response has data directly in an array
  if (Array.isArray(rapidData)) {
    console.log('📦 Response is array format');
    rapidData.forEach(match => {
      if (match) {
        matches.push({
          id: match.id || match.matchId || match.match_id,
          name: match.name || match.title || `${match.team1} vs ${match.team2}`,
          matchType: match.matchType || match.format || match.match_type,
          status: match.status || match.state,
          series: match.series || match.tournament || match.competition,
          seriesName: match.series || match.tournament || match.competition,
          matchEnded: match.matchEnded || match.completed || match.state === 'Complete',
          team1: match.team1 || match.teamA,
          team2: match.team2 || match.teamB,
          venue: match.venue || match.ground
        });
      }
    });
  }
  // Check for typeMatches structure (original Cricbuzz format)
  else if (rapidData && rapidData.typeMatches) {
    console.log('📦 Response has typeMatches structure');
    rapidData.typeMatches.forEach(typeMatch => {
      if (typeMatch.seriesMatches) {
        typeMatch.seriesMatches.forEach(seriesMatch => {
          if (seriesMatch.seriesAdWrapper && seriesMatch.seriesAdWrapper.matches) {
            seriesMatch.seriesAdWrapper.matches.forEach(matchInfo => {
              const match = matchInfo.matchInfo;
              if (match) {
                matches.push({
                  id: match.matchId?.toString(),
                  name: `${match.team1?.teamName} vs ${match.team2?.teamName}`,
                  matchType: match.matchFormat,
                  status: match.status,
                  series: seriesMatch.seriesAdWrapper.seriesName,
                  seriesName: seriesMatch.seriesAdWrapper.seriesName,
                  matchEnded: match.state === 'Complete',
                  team1: match.team1?.teamName,
                  team2: match.team2?.teamName,
                  venue: match.venueInfo?.ground
                });
              }
            });
          }
        });
      }
    });
  }
  // Check for matches array directly
  else if (rapidData && rapidData.matches) {
    console.log('📦 Response has matches array');
    rapidData.matches.forEach(match => {
      if (match) {
        matches.push({
          id: match.id || match.matchId,
          name: match.name || match.title,
          matchType: match.matchType || match.format,
          status: match.status,
          series: match.series || match.tournament,
          seriesName: match.series || match.tournament,
          matchEnded: match.matchEnded || match.completed,
          team1: match.team1,
          team2: match.team2,
          venue: match.venue
        });
      }
    });
  }
  // Log if structure is unrecognized
  else {
    console.log('⚠️  Unrecognized response structure');
    console.log('   Available keys:', rapidData ? Object.keys(rapidData).join(', ') : 'null');
    console.log('   Sample data:', JSON.stringify(rapidData).substring(0, 300));
  }
  
  console.log(`✅ Transformed ${matches.length} matches`);
  return matches;
}

/**
 * Get detailed scorecard for a match
 */
async function getMatchScorecard(matchId) {
  try {
    if (!API_KEY) {
      console.warn(`⚠️  API Key not set for provider: ${API_PROVIDER}`);
      return null;
    }
    
    console.log(`🌐 Fetching scorecard for match ${matchId} from ${API_PROVIDER.toUpperCase()}...`);
    
    if (API_PROVIDER === 'rapidapi') {
      return await getRapidAPIScorecard(matchId);
    } else {
      return await getCricketDataScorecard(matchId);
    }
  } catch (error) {
    console.error(`❌ Error fetching scorecard for ${matchId}:`, error.message);
    return null;
  }
}

/**
 * Get scorecard from RapidAPI Cricbuzz
 */
async function getRapidAPIScorecard(matchId) {
  try {
    const response = await axios.get(`${RAPIDAPI_BASE}/cricket-match-info`, {
      params: { matchid: matchId },
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
      },
      timeout: 10000
    });
    
    console.log(`✅ RapidAPI scorecard received for match ${matchId}`);
    
    // Transform to common format
    return {
      data: transformRapidAPIScorecard(response.data)
    };
  } catch (error) {
    console.error('❌ RapidAPI scorecard error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data).substring(0, 200));
    }
    return null;
  }
}

/**
 * Get scorecard from CricketData.org
 */
async function getCricketDataScorecard(matchId) {
  try {
    const response = await axios.get(`${CRICKET_API_BASE}/match_scorecard`, {
      params: { apikey: CRICKET_API_KEY, id: matchId },
      timeout: 10000
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ CricketData scorecard error:', error.message);
    return null;
  }
}

/**
 * Transform RapidAPI scorecard to common format
 */
function transformRapidAPIScorecard(rapidData) {
  const scorecard = { score: [] };
  
  if (!rapidData || !rapidData.scoreCard) {
    return scorecard;
  }
  
  rapidData.scoreCard.forEach(inning => {
    const inningData = {
      r: [], // batting
      w: []  // bowling
    };
    
    // Parse batting
    if (inning.batTeamDetails && inning.batTeamDetails.batsmenData) {
      Object.values(inning.batTeamDetails.batsmenData).forEach(batsman => {
        if (batsman.batId) {
          inningData.r.push({
            batsmanName: batsman.batName,
            batsman: batsman.batName,
            r: batsman.runs,
            b: batsman.balls,
            '4s': batsman.fours,
            '6s': batsman.sixes,
            sr: batsman.strikeRate
          });
        }
      });
    }
    
    // Parse bowling
    if (inning.bowlTeamDetails && inning.bowlTeamDetails.bowlersData) {
      Object.values(inning.bowlTeamDetails.bowlersData).forEach(bowler => {
        if (bowler.bowlId) {
          inningData.w.push({
            bowlerName: bowler.bowlName,
            bowler: bowler.bowlName,
            o: bowler.overs,
            m: bowler.maidens,
            r: bowler.runs,
            w: bowler.wickets,
            eco: bowler.economy
          });
        }
      });
    }
    
    scorecard.score.push(inningData);
  });
  
  return scorecard;
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
  getApiProvider: () => API_PROVIDER,
  getApiKeyStatus: () => ({
    provider: API_PROVIDER,
    configured: !!API_KEY,
    recommended: 'rapidapi'
  })
};
