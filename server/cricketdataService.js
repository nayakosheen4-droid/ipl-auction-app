/**
 * Cricketdata.org (api.cricapi.com/v1) – series and match data.
 * Uses API key from env CRICKETDATA_API_KEY.
 * Default series: env CRICKETDATA_SERIES_ID or f3e5c7dd-332c-4893-9067-aa2bfe6d2b85.
 */
const axios = require('axios');

const BASE = 'https://api.cricapi.com/v1';
const API_KEY = process.env.CRICKETDATA_API_KEY || '1bc3a7a7-86f7-4726-a09f-2550067eb2b5';

const DEFAULT_SERIES_ID = 'f3e5c7dd-332c-4893-9067-aa2bfe6d2b85';
const CACHE_TTL = 15 * 60 * 1000;
let scheduleCache = { data: null, seriesId: null, ts: 0 };

function hasValidKey() {
  return !!API_KEY && API_KEY.length > 10;
}

/**
 * Fetch series_info by id (returns series details + matches).
 */
async function getSeriesInfo(seriesId) {
  if (!hasValidKey()) return null;
  try {
    const { data } = await axios.get(`${BASE}/series_info`, {
      params: { apikey: API_KEY, id: seriesId },
      timeout: 15000
    });
    if (data.status === 'failure' || data.status !== 'success') return null;
    return data;
  } catch (err) {
    console.error('cricketdata series_info:', err.message);
    return null;
  }
}

/**
 * Fetch matches list (current/recent/upcoming). Optional offset for pagination.
 */
async function getMatches(offset = 0) {
  if (!hasValidKey()) return { data: [] };
  try {
    const { data } = await axios.get(`${BASE}/matches`, {
      params: { apikey: API_KEY, offset },
      timeout: 15000
    });
    if (data.status === 'failure' || data.status !== 'success') return { data: [] };
    return { data: data.data || [] };
  } catch (err) {
    console.error('cricketdata matches:', err.message);
    return { data: [] };
  }
}

/**
 * Get configured series ID (env CRICKETDATA_SERIES_ID or CRICKETDATA_IPL2025_SERIES_ID, else default).
 */
function getConfiguredSeriesId() {
  return process.env.CRICKETDATA_SERIES_ID || process.env.CRICKETDATA_IPL2025_SERIES_ID || DEFAULT_SERIES_ID;
}

/**
 * Get schedule (all matches) for a series by id. Uses series_info API.
 */
async function getScheduleBySeriesId(seriesId) {
  if (!hasValidKey() || !seriesId) return { data: [], seriesName: null };
  const series = await getSeriesInfo(seriesId);
  if (!series || !series.data) return { data: [], seriesName: null };
  const raw = series.data;
  const matches = raw.matches || raw.data || [];
  const arr = Array.isArray(matches) ? matches : [];
  const seriesName = raw.name || raw.seriesName || 'Series';
  const list = arr.map(m => ({
    id: m.id || m.matchId,
    name: m.name || (m.team1 && m.team2 ? `${m.team1} vs ${m.team2}` : 'Match'),
    matchType: m.matchType || 't20',
    status: m.status || '',
    series: seriesName,
    seriesName,
    matchEnded: !!(m.matchEnded || (m.status && /won|complete|finished/i.test(String(m.status)))),
    team1: m.team1,
    team2: m.team2,
    venue: m.venue,
    date: m.date
  })).filter(m => m.id);
  return { data: list, seriesName };
}

/**
 * Get schedule for the configured series (same as getIPL2025Schedule for backwards compatibility).
 */
async function getIPL2025Schedule() {
  if (!hasValidKey()) return { data: [] };
  const seriesId = getConfiguredSeriesId();
  if (scheduleCache.data && scheduleCache.seriesId === seriesId && Date.now() - scheduleCache.ts < CACHE_TTL) {
    return { data: scheduleCache.data };
  }
  const { data: list, seriesName } = await getScheduleBySeriesId(seriesId);
  scheduleCache = { data: list, seriesId, ts: Date.now() };
  if (list.length) console.log('cricketdata: schedule for series', seriesId, seriesName || '', '→', list.length, 'matches');
  return { data: list };
}

/**
 * Get match scorecard by match id.
 */
async function getMatchScorecard(matchId) {
  if (!hasValidKey()) return null;
  try {
    const { data } = await axios.get(`${BASE}/match_scorecard`, {
      params: { apikey: API_KEY, id: matchId },
      timeout: 15000
    });
    if (data.status === 'failure' || data.status !== 'success') return null;
    return normalizeScorecard(data);
  } catch (err) {
    console.error('cricketdata match_scorecard:', err.message);
    return null;
  }
}

/**
 * Normalize cricketdata scorecard to our common format: { data: { score: [ { r: [], w: [] } ] } }.
 */
function normalizeScorecard(data) {
  const raw = data.data || data;
  const score = [];
  const innings = raw.scoreCard || raw.scorecard || raw.innings || raw.data?.scoreCard || [];
  const arr = Array.isArray(innings) ? innings : (innings && innings.length ? [innings] : []);
  for (const inn of arr) {
    const inningData = { r: [], w: [] };
    const bat = inn.batTeamDetails || inn.battingDetails || inn.batsmen || inn.batsmenData;
    const batList = bat?.batsmenData || bat?.batsmen || (Array.isArray(bat) ? bat : (bat && typeof bat === 'object' ? Object.values(bat) : []));
    if (Array.isArray(batList)) {
      for (const b of batList) {
        if (!b) continue;
        const name = b.batName || b.batsmanName || b.name;
        if (!name && !b.batId) continue;
        inningData.r.push({
          batsmanName: name || 'Unknown',
          batsman: name || 'Unknown',
          r: b.runs ?? b.r ?? 0,
          b: b.balls ?? b.b ?? 0,
          '4s': b.fours ?? b['4s'] ?? 0,
          '6s': b.sixes ?? b['6s'] ?? 0,
          sr: b.strikeRate ?? b.sr ?? 0
        });
      }
    }
    const bowl = inn.bowlTeamDetails || inn.bowlingDetails || inn.bowlers || inn.bowlersData;
    const bowlList = bowl?.bowlersData || bowl?.bowlers || (Array.isArray(bowl) ? bowl : (bowl && typeof bowl === 'object' ? Object.values(bowl) : []));
    if (Array.isArray(bowlList)) {
      for (const b of bowlList) {
        if (!b) continue;
        const name = b.bowlName || b.bowlerName || b.name;
        if (!name && !b.bowlId) continue;
        inningData.w.push({
          bowlerName: name || 'Unknown',
          bowler: name || 'Unknown',
          o: b.overs ?? b.o ?? 0,
          m: b.maidens ?? b.m ?? 0,
          r: b.runs ?? b.r ?? 0,
          w: b.wickets ?? b.w ?? 0,
          eco: b.economy ?? b.eco ?? 0
        });
      }
    }
    if (inningData.r.length || inningData.w.length) score.push(inningData);
  }
  return { data: { score } };
}

module.exports = {
  hasValidKey: () => hasValidKey(),
  getIPL2025Schedule,
  getScheduleBySeriesId,
  getConfiguredSeriesId,
  getMatchScorecard,
  getSeriesInfo,
  getMatches
};
