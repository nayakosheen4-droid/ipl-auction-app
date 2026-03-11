#!/usr/bin/env node
/**
 * Build fantasy points Excel from Cricket Data API (free-tier friendly).
 *
 * Preserves all data to minimise API calls:
 * - Schedule: uses cricketdata/schedule.json when present; only calls series_info when missing.
 * - Scorecards: uses cricketdata/scorecards/<matchId>.json when present; only calls match_scorecard
 *   for completed matches not yet cached. Fetched IDs are recorded in fetched-match-ids.json.
 *
 * Workbook: Sheet 1 = Schedule (all matches with date/venue/status), Sheet 2 = Fantasy Points,
 * then Group 1–8 (each with per-round opponent columns R1 Opp, R2 Opp, …).
 * Env: .env with CRICKETDATA_API_KEY and optional CRICKETDATA_SERIES_ID.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');

const { loadConfig, fetchSeriesMatches, fetchMatchDetails } = require('./api');
const { normalizeMatch } = require('./normalizeMatch');
const {
  buildRowsForMatch,
  getMatchDate,
  getMatchName,
  battingBreakdown,
  strikeRateBreakdown,
  bowlingBreakdown,
  economyBreakdown,
  fieldingBreakdown,
} = require('./fantasyScoring');

const OUT_PATH = path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26_from_api.xlsx');
/** Persisted list of match IDs we have already successfully fetched (so we do not call match_scorecard again). */
const FETCHED_IDS_PATH = path.join(__dirname, 'fetched-match-ids.json');
/** Schedule from series_info (matchList) – loaded from file when present to avoid API call. */
const SCHEDULE_JSON_PATH = path.join(__dirname, 'schedule.json');
/** Cached scorecard responses per match ID – avoid calling match_scorecard again for same match. */
const SCORECARDS_DIR = path.join(__dirname, 'scorecards');

/** Empty = include all teams (T20 WC has 20+ nations). Set to an array of country names to filter. */
const ALLOWED_COUNTRIES = [];

const ESPN_EXTRAS_PATH = path.join(__dirname, 'espn-extras.json');

function loadEspnExtras() {
  if (!fs.existsSync(ESPN_EXTRAS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(ESPN_EXTRAS_PATH, 'utf8')); } catch { return {}; }
}

const SHEET_COLUMNS = [
  { header: 'Player Name', key: 'playerName', width: 20 },
  { header: 'Country', key: 'country', width: 18 },
  { header: 'Match Name', key: 'matchName', width: 28 },
  { header: 'Match Date', key: 'matchDate', width: 11 },
  { header: 'Round', key: 'roundNumber', width: 6 },
  { header: 'Fantasy Points', key: 'fantasyPoints', width: 14 },
  { header: 'Pts Playing', key: 'ptsPlaying', width: 10 },
  { header: 'Pts POTM', key: 'ptsPOTM', width: 8 },
  { header: 'Runs', key: 'runs', width: 5 },
  { header: '4s', key: 'fours', width: 4 },
  { header: '6s', key: 'sixes', width: 4 },
  { header: 'Balls', key: 'ballsFaced', width: 5 },
  { header: 'Dismissed', key: 'dismissed', width: 6 },
  { header: 'Pts Runs', key: 'ptsRuns', width: 8 },
  { header: 'Pts 4s', key: 'ptsFours', width: 7 },
  { header: 'Pts 6s', key: 'ptsSixes', width: 7 },
  { header: 'Pts Milestone', key: 'ptsMilestone', width: 10 },
  { header: 'Pts Duck', key: 'ptsDuck', width: 8 },
  { header: 'Batting Pts', key: 'battingPts', width: 10 },
  { header: 'SR', key: 'strikeRate', width: 6 },
  { header: 'Pts SR', key: 'ptsSR', width: 6 },
  { header: 'Wickets', key: 'wickets', width: 7 },
  { header: 'LBW/Bowled', key: 'lbwBowled', width: 10 },
  { header: 'Dots', key: 'dots', width: 5 },
  { header: 'Maidens', key: 'maidens', width: 7 },
  { header: 'Runs Conceded', key: 'runsConceded', width: 11 },
  { header: 'Balls Bowled', key: 'ballsBowled', width: 11 },
  { header: 'Pts Wickets', key: 'ptsWickets', width: 10 },
  { header: 'Pts LBW/Bowl', key: 'ptsLBWBowled', width: 11 },
  { header: 'Pts Dots', key: 'ptsDots', width: 8 },
  { header: 'Pts Maidens', key: 'ptsMaidens', width: 10 },
  { header: 'Pts Wkt Bonus', key: 'ptsWktBonus', width: 11 },
  { header: 'Bowling Pts', key: 'bowlingPts', width: 11 },
  { header: 'Overs', key: 'overs', width: 5 },
  { header: 'Economy', key: 'economy', width: 7 },
  { header: 'Pts Economy', key: 'ptsEconomy', width: 10 },
  { header: 'Catches', key: 'catches', width: 7 },
  { header: 'Stumpings', key: 'stumpings', width: 9 },
  { header: 'Direct RO', key: 'directRunOut', width: 8 },
  { header: 'RO Assist', key: 'runOutAssist', width: 8 },
  { header: 'Pts Catches', key: 'ptsCatches', width: 10 },
  { header: 'Pts 3 Catch', key: 'pts3Catch', width: 9 },
  { header: 'Pts Stumping', key: 'ptsStumpings', width: 11 },
  { header: 'Pts Direct RO', key: 'ptsDirectRO', width: 11 },
  { header: 'Pts RO Assist', key: 'ptsAssistRO', width: 11 },
  { header: 'Fielding Pts', key: 'fieldingPts', width: 11 },
];

function getMatchId(m) {
  return m.id || m.matchId || m.unique_id || m.match_id;
}

function hasFullMatchData(m) {
  return m.innings || m.scorecard || m.info;
}

/** True if series_info indicates this match has finished (so scorecard may be available). */
function isMatchEnded(m) {
  if (m.matchEnded === true) return true;
  const status = String(m.status || '').toLowerCase();
  return /won|complete|finished|result|drawn|tied|abandoned/.test(status);
}

function loadFetchedIds() {
  if (!fs.existsSync(FETCHED_IDS_PATH)) return new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(FETCHED_IDS_PATH, 'utf8'));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    return new Set();
  }
}

function saveFetchedId(fetchedIds, id) {
  fetchedIds.add(id);
  fs.writeFileSync(FETCHED_IDS_PATH, JSON.stringify([...fetchedIds].sort(), null, 2), 'utf8');
}

function loadScheduleFromFile() {
  if (!fs.existsSync(SCHEDULE_JSON_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(SCHEDULE_JSON_PATH, 'utf8'));
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch (e) {
    return null;
  }
}

function scorecardCachePath(matchId) {
  const safe = String(matchId).replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(SCORECARDS_DIR, `${safe}.json`);
}

function loadScorecardFromCache(matchId) {
  const filePath = scorecardCachePath(matchId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveScorecardToCache(matchId, rawResponse) {
  if (!fs.existsSync(SCORECARDS_DIR)) fs.mkdirSync(SCORECARDS_DIR, { recursive: true });
  fs.writeFileSync(scorecardCachePath(matchId), JSON.stringify(rawResponse, null, 0), 'utf8');
}

/** Normalize date to YYYY-MM-DD and sort teams for a stable match key (schedule vs scorecard). */
function makeMatchKey(dateStr, teamsArr) {
  let datePart = '';
  if (dateStr != null) {
    if (dateStr instanceof Date || (typeof dateStr === 'object' && typeof dateStr.getFullYear === 'function')) {
      datePart = dateStr.toISOString ? dateStr.toISOString().slice(0, 10) : String(dateStr).slice(0, 10);
    } else {
      const s = String(dateStr).trim();
      datePart = s.slice(0, 10);
    }
  }
  const teams = (teamsArr || []).filter(Boolean).map((t) => String(t).trim()).sort();
  return `${datePart}|${teams.join('|')}`;
}

/**
 * Build round number per (team, match) from the full schedule so Fantasy Points rounds align with
 * Group sheet opponents (R1 Opp, R2 Opp, ...). Returns { roundForTeamInMatch } where
 * roundForTeamInMatch[team][matchKey] = 1-based round.
 */
function buildRoundFromSchedule(matchList) {
  const sorted = [...matchList].sort((a, b) => String(a.date || a.dateTimeGMT || '').localeCompare(String(b.date || b.dateTimeGMT || '')));
  const teamMatchKeys = {};
  for (const m of sorted) {
    const teams = m.teams || (m.teamInfo && m.teamInfo.map((t) => t.name)) || [];
    if (teams.length < 2) continue;
    const key = makeMatchKey(m.date || m.dateTimeGMT, teams);
    for (const t of teams) {
      if (!t) continue;
      if (!teamMatchKeys[t]) teamMatchKeys[t] = [];
      teamMatchKeys[t].push(key);
    }
  }
  const roundForTeamInMatch = {};
  for (const [team, keys] of Object.entries(teamMatchKeys)) {
    roundForTeamInMatch[team] = {};
    let roundIndex = 0;
    for (const key of keys) {
      if (roundForTeamInMatch[team][key] == null) {
        roundIndex += 1;
        roundForTeamInMatch[team][key] = roundIndex;
      }
    }
  }
  return { roundForTeamInMatch };
}

function buildScheduleRows(matchList) {
  const sorted = [...matchList].sort((a, b) => String(a.date || a.dateTimeGMT || '').localeCompare(String(b.date || b.dateTimeGMT || '')));
  return sorted.map((m) => ({
    date: m.date || '',
    dateTimeGMT: m.dateTimeGMT || '',
    matchName: m.name || (m.teams && m.teams.length >= 2 ? `${m.teams[0]} vs ${m.teams[1]}` : ''),
    venue: m.venue || '',
    status: m.status || '',
  }));
}

function copySheet(srcSheet, destWorkbook) {
  const dest = destWorkbook.addWorksheet(srcSheet.name, { views: (srcSheet.views && srcSheet.views.length) ? srcSheet.views : [{ state: 'frozen', ySplit: 1 }] });
  const rowCount = srcSheet.rowCount || 0;
  const colCount = srcSheet.columnCount || 0;
  for (let r = 1; r <= rowCount; r++) {
    const srcRow = srcSheet.getRow(r);
    const destRow = dest.getRow(r);
    for (let c = 1; c <= (colCount || 20); c++) {
      const srcCell = srcRow.getCell(c);
      const destCell = destRow.getCell(c);
      if (srcCell.value !== undefined && srcCell.value !== null) destCell.value = srcCell.value;
      if (srcCell.font) destCell.font = srcCell.font;
      if (srcCell.alignment) destCell.alignment = srcCell.alignment;
    }
  }
  if (srcSheet.columns && srcSheet.columns.length) {
    dest.columns = srcSheet.columns.map((col) => ({ header: col.header, key: col.key, width: col.width || 10 }));
  }
}

function addScheduleSheetFirst(workbook, matchList) {
  const scheduleRows = buildScheduleRows(matchList);
  const scheduleSheet = workbook.addWorksheet('Schedule', { views: [{ state: 'frozen', ySplit: 1 }] });
  scheduleSheet.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Time (GMT)', key: 'dateTimeGMT', width: 18 },
    { header: 'Match', key: 'matchName', width: 50 },
    { header: 'Venue', key: 'venue', width: 28 },
    { header: 'Status', key: 'status', width: 24 },
  ];
  scheduleSheet.getRow(1).font = { bold: true };
  scheduleRows.forEach((r) => scheduleSheet.addRow(r));
  return scheduleSheet;
}

/**
 * series_info returns the full schedule: every scheduled match with id, name, teams, date,
 * dateTimeGMT, venue, status, matchEnded, etc. So you get all matches (past and future) with date.
 */
async function main() {
  const { seriesId, apiKey, apiKeys, baseUrl } = loadConfig();
  if (!seriesId || !apiKey) {
    console.error('Set seriesId and apiKey in cricketdata/config.json or env CRICKETDATA_SERIES_ID / CRICKETDATA_API_KEYS');
    process.exit(1);
  }
  if (apiKeys.length > 1) console.log('Loaded', apiKeys.length, 'API keys (will rotate on rate limit).');

  const fetchedIds = loadFetchedIds();
  if (fetchedIds.size) console.log('Already have scorecards for', fetchedIds.size, 'match(es); will use cache for those.');

  const forceRefreshSchedule = process.env.REFRESH_SCHEDULE === '1' || process.env.REFRESH_SCHEDULE === 'true';
  let matchList = !forceRefreshSchedule ? loadScheduleFromFile() : null;
  if (matchList && matchList.length > 0) {
    console.log('Using saved schedule from', SCHEDULE_JSON_PATH, '(' + matchList.length, 'matches). No API call.');
  } else {
    if (forceRefreshSchedule) console.log('REFRESH_SCHEDULE=1: fetching latest schedule from API...');
    else console.log('No saved schedule; fetching series (1 API call)...');
    try {
      matchList = await fetchSeriesMatches(seriesId, apiKey, baseUrl, apiKeys);
    } catch (e) {
      console.error('API error:', e.message);
      process.exit(1);
    }
    if (!matchList || matchList.length === 0) {
      console.error('No matches returned for series.');
      process.exit(1);
    }
    fs.writeFileSync(SCHEDULE_JSON_PATH, JSON.stringify(matchList, null, 2), 'utf8');
    console.log('Saved schedule to', SCHEDULE_JSON_PATH);
  }

  // After refreshing schedule, update POTM and dots from ESPN for any matches missing in espn-extras (e.g. semi-finals)
  if (forceRefreshSchedule) {
    console.log('Updating POTM and dots from ESPN for completed matches...');
    const fetchExtras = spawnSync(process.execPath, [path.join(__dirname, 'fetch-espn-extras.js')], {
      cwd: __dirname,
      stdio: 'inherit',
    });
    if (fetchExtras.status !== 0) console.warn('fetch-espn-extras.js exited with', fetchExtras.status);
  }

  // Abandoned / no-result matches – skip to save API calls
  const SKIP_MATCH_IDS = new Set([
    '67ed31aa-c844-4022-a1c0-0d7b7b64dc88', // Ireland vs Zimbabwe (abandoned)
    'c177a4ce-6d19-4264-b552-1fcd3af6506a', // New Zealand vs Pakistan (abandoned - rain)
  ]);

  const completedOnly = matchList
    .filter((m) => isMatchEnded(m))
    .sort((a, b) => String(a.date || a.dateTimeGMT || '').localeCompare(String(b.date || b.dateTimeGMT || '')));
  const totalCompleted = completedOnly.length;
  console.log('Completed matches in schedule:', totalCompleted);
  const matches = [];
  let fromCache = 0;
  let fromApi = 0;
  for (let i = 0; i < completedOnly.length; i++) {
    const m = completedOnly[i];
    const id = getMatchId(m);
    if (!id) continue;
    const matchLabel = (m.teams && m.teams.length >= 2) ? `${m.teams[0]} vs ${m.teams[1]}` : (m.name || id);
    if (SKIP_MATCH_IDS.has(id)) {
      console.log(`[${i + 1}/${totalCompleted}]`, 'Skipping (abandoned):', matchLabel);
      continue;
    }
    const progress = `[${i + 1}/${totalCompleted}]`;
    const forceRefetch = process.env.REFETCH_MATCH_ID && String(id).trim() === String(process.env.REFETCH_MATCH_ID).trim();
    let raw = forceRefetch ? null : loadScorecardFromCache(id);
    if (raw) {
      fromCache++;
      console.log(progress, 'Using cache:', matchLabel);
      if (raw.data) {
        if (!raw.data.teams && (m.teams || m.teamInfo)) raw.data.teams = m.teams || (m.teamInfo || []).map((t) => t.name).filter(Boolean);
        if (!raw.data.date && (m.date || m.dateTimeGMT)) raw.data.date = m.date || m.dateTimeGMT;
        if (!raw.data.info) raw.data.info = raw.data.info || {};
        if (!raw.data.info.teams && raw.data.teams) raw.data.info.teams = raw.data.teams;
        if (!raw.data.info.dates && raw.data.date) raw.data.info.dates = [raw.data.date];
      }
    } else {
      console.log(progress, forceRefetch ? 'Refetching from API (REFETCH_MATCH_ID):' : 'Fetching from API:', matchLabel, '...');
      try {
        raw = await fetchMatchDetails(id, apiKey, baseUrl, apiKeys);
        if (raw && raw.data) {
          if (!raw.data.teams && (m.teams || m.teamInfo)) raw.data.teams = m.teams || (m.teamInfo || []).map((t) => t.name).filter(Boolean);
          if (!raw.data.date && (m.date || m.dateTimeGMT)) raw.data.date = m.date || m.dateTimeGMT;
          if (!raw.data.info) raw.data.info = {};
          if (!raw.data.info.teams && raw.data.teams) raw.data.info.teams = raw.data.teams;
          if (!raw.data.info.dates && raw.data.date) raw.data.info.dates = [raw.data.date];
        }
        saveScorecardToCache(id, raw);
        saveFetchedId(fetchedIds, id);
        fromApi++;
        console.log(progress, 'Fetched and cached.', fromApi, 'from API so far. Waiting 1 min before next request...');
      } catch (e) {
        console.warn(progress, 'Could not fetch:', matchLabel, '-', e.message);
        continue;
      }
      await new Promise((r) => setTimeout(r, 60 * 1000));
    }
    const normalized = normalizeMatch(raw);
    if (normalized && (normalized.innings || normalized.stats)) matches.push(normalized);
  }
  console.log('Scorecards: ', fromCache, 'from cache,', fromApi, 'from API. Total scorecards:', matches.length);

  const scheduleRounds = matchList && matchList.length > 0 ? buildRoundFromSchedule(matchList) : null;

  console.log('Building workbook (Schedule + Fantasy Points + Group sheets)...');
  let rows = [];
  if (matches.length > 0) {
    matches.sort((a, b) => {
      const da = getMatchDate(a.info) || '';
      const db = getMatchDate(b.info) || '';
      return String(da).localeCompare(String(db));
    });
    const teamMatchOrder = {};
    matches.forEach((m, idx) => {
      const date = getMatchDate(m.info);
      const teams = m.info.teams || [];
      for (const t of teams) {
        if (!t) continue;
        if (!teamMatchOrder[t]) teamMatchOrder[t] = [];
        teamMatchOrder[t].push({ matchIndex: idx, date });
      }
    });
    const matchTeamRound = {};
    for (const [team, arr] of Object.entries(teamMatchOrder)) {
      arr.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      arr.forEach((item, i) => {
        matchTeamRound[`${item.matchIndex}_${team}`] = i + 1;
      });
    }
    if (scheduleRounds && scheduleRounds.roundForTeamInMatch) {
      const rf = scheduleRounds.roundForTeamInMatch;
      matches.forEach((match, matchIndex) => {
        const date = getMatchDate(match.info);
        const teams = match.info.teams || [];
        const matchKey = makeMatchKey(date, teams);
        for (const t of teams) {
          if (!t) continue;
          const round = rf[t] && rf[t][matchKey];
          if (round != null) matchTeamRound[`${matchIndex}_${t}`] = round;
        }
      });
    }
    rows = [];
    matches.forEach((match, matchIndex) => {
      rows.push(...buildRowsForMatch(match, matchIndex, matchTeamRound, ALLOWED_COUNTRIES));
    });
  }

  const espnExtras = loadEspnExtras();

  const R1_POTM_OVERRIDES = {
    'Netherlands vs Pakistan': 'Faheem Ashraf',
    'Pakistan vs Netherlands': 'Faheem Ashraf',
    'West Indies vs Scotland': 'Shimron Hetmyer',
    'India vs United States of America': 'Suryakumar Yadav',
    'England vs Nepal': 'Will Jacks',
    'Sri Lanka vs Ireland': 'Kamindu Mendis',
    'South Africa vs Canada': 'Lungi Ngidi',
    'New Zealand vs Afghanistan': 'Tim Seifert',
    'Scotland vs Italy': 'Michael Leask',
    'Zimbabwe vs Oman': 'Blessing Muzarabani',
    'Australia vs Ireland': 'Nathan Ellis',
  };

  const ESPN_NAME_MAP = {
    'Ziaur Rahman': 'Ziaur Rahman Sharifi',
    'PHKD Mendis': 'Kamindu Mendis',
    'MADI Hemantha': 'Dushan Hemantha',
    'Shaheen Shah Afridi': 'Shaheen Afridi',
    'LA Dawson': 'Liam Dawson',
    'JC Archer': 'Jofra Archer',
    'J Overton': 'Jamie Overton',
    'SM Curran': 'Sam Curran',
    'AU Rashid': 'Adil Rashid',
    'WG Jacks': 'Will Jacks',
    'JG Bethell': 'Jacob Bethell',
    'Mohammad Nawaz(3)': 'Mohammad Nawaz',
    'R Ngarava': 'Richard Ngarava',
    'R Ravindra': 'Rachin Ravindra',
    'MJ Henry': 'Matt Henry',
    'LH Ferguson': 'Lockie Ferguson',
    'MJ Santner': 'Mitchell Santner',
    'CE McConchie': 'Cole McConchie',
    'GD Phillips': 'Glenn Phillips',
    'IS Sodhi': 'Ish Sodhi',
    'B Muzarabani': 'Blessing Muzarabani',
    'B Evans': 'Brad Evans',
    'AG Cremer': 'Graeme Cremer',
    'D Myers': 'Dion Myers',
    'AJ Hosein': 'Akeal Hosein',
    'MW Forde': 'Matthew Forde',
    'G Motie': 'Gudakesh Motie',
    'S Joseph': 'Shamar Joseph',
    'JO Holder': 'Jason Holder',
  };

  function espnNameMatch(espnName, cricApiName, allCricApiNames) {
    const mapped = ESPN_NAME_MAP[espnName.replace(/\(\d+\)$/, '').trim()];
    if (mapped && mapped === cricApiName) return true;
    const clean = espnName.replace(/\(\d+\)$/, '').trim();
    if (clean === cricApiName || clean.toLowerCase() === cricApiName.toLowerCase()) return true;
    const espnParts = clean.split(/\s+/);
    const apiParts = cricApiName.split(/\s+/);
    const espnLast = espnParts[espnParts.length - 1].toLowerCase();
    const apiLast = apiParts[apiParts.length - 1].toLowerCase();
    if (espnLast !== apiLast) {
      if (cricApiName.toLowerCase().includes(espnLast) || clean.toLowerCase().includes(apiLast)) {
        const surnameMatches = allCricApiNames.filter(n => n.toLowerCase().includes(espnLast) || clean.toLowerCase().includes(n.split(/\s+/).pop().toLowerCase()));
        if (surnameMatches.length === 1) return true;
      }
      return false;
    }
    const surnameMatches = allCricApiNames.filter(n => n.split(/\s+/).pop().toLowerCase() === espnLast);
    if (surnameMatches.length === 1) return true;
    const espnFirst = espnParts[0].toLowerCase();
    const apiFirst = apiParts[0].toLowerCase();
    if (espnFirst === apiFirst) return true;
    if (espnFirst.length <= 3 && /^[A-Z]+$/i.test(espnFirst)) {
      if (espnFirst[espnFirst.length - 1].toLowerCase() === apiFirst[0].toLowerCase()) return true;
      if (espnFirst[0].toLowerCase() === apiFirst[0].toLowerCase()) return true;
    }
    if (apiFirst.length <= 3 && /^[A-Z]+$/i.test(apiFirst)) {
      if (apiFirst[0].toLowerCase() === espnFirst[0].toLowerCase()) return true;
    }
    if (espnParts.length > 2) {
      const espnMiddleLast = espnParts.slice(1).join(' ').toLowerCase();
      const apiMiddleLast = apiParts.length > 1 ? apiParts.slice(0, -1).join(' ').toLowerCase() : '';
      if (espnMiddleLast.includes(apiFirst) || apiMiddleLast.includes(espnFirst)) return true;
    }
    return false;
  }

  if (Object.keys(espnExtras).length > 0 && rows.length > 0) {
    const allPlayerNamesInMatch = {};
    for (const row of rows) {
      const mk = (row.matchName || '') + '|' + (row.matchDate || '');
      if (!allPlayerNamesInMatch[mk]) allPlayerNamesInMatch[mk] = [];
      allPlayerNamesInMatch[mk].push(row.playerName);
    }

    let potmApplied = 0, dotsApplied = 0;
    for (const row of rows) {
      const matchDate = row.matchDate != null ? String(row.matchDate).trim() : '';
      const matchNameRaw = (row.matchName || '').toString().trim();
      const matchName = matchNameRaw.includes(',') ? matchNameRaw.split(',')[0].trim() : matchNameRaw;
      const parts = matchName.split(/\s+vs\s+/).map(s => s.trim()).filter(Boolean);
      if (parts.length !== 2) continue;
      const key = makeMatchKey(matchDate, parts);
      const extras = espnExtras[key];
      if (!extras) continue;
      const mk = (row.matchName || '') + '|' + (row.matchDate || '');
      const allNames = allPlayerNamesInMatch[mk] || [];

      const isR1 = row.roundNumber === 1;
      let potmName = extras.potm ? extras.potm.trim() : null;
      if (isR1) {
        const overrideKey = Object.keys(R1_POTM_OVERRIDES).find(k =>
          matchName.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(matchName.toLowerCase())
        );
        if (overrideKey) potmName = R1_POTM_OVERRIDES[overrideKey];
      }

      if (potmName && row.playerName) {
        const playerName = row.playerName.trim();
        if (espnNameMatch(potmName, playerName, allNames)) {
          if (row.ptsPOTM !== 50) {
            row.ptsPOTM = 50;
            row.fantasyPoints = (row.fantasyPoints || 0) + 50;
            potmApplied++;
          }
        }
      }

      if (extras.dots && Object.keys(extras.dots).length > 0 && row.playerName) {
        const playerName = row.playerName.trim();
        let dotCount = null;
        for (const [espnRaw, count] of Object.entries(extras.dots)) {
          if (espnNameMatch(espnRaw, playerName, allNames)) {
            dotCount = count;
            break;
          }
        }
        if (dotCount != null && dotCount > 0 && (row.dots === 0 || row.dots === '' || row.dots == null)) {
          const oldDotPts = row.ptsDots || 0;
          row.dots = dotCount;
          row.ptsDots = dotCount;
          const dotDiff = row.ptsDots - oldDotPts;
          row.bowlingPts = (row.bowlingPts || 0) + dotDiff;
          row.fantasyPoints = (row.fantasyPoints || 0) + dotDiff;
          dotsApplied++;
        }
      }
    }
    if (potmApplied > 0) console.log('Applied POTM (50 pts) from ESPN for', potmApplied, 'player(s).');
    if (dotsApplied > 0) console.log('Applied dot ball data from ESPN for', dotsApplied, 'bowler(s).');
  }

  // Manual points overrides (player replacement, scoring corrections). England vs Sri Lanka (R5) now recalculated from refetched scorecard + ESPN; Dawson/Shanaka overrides removed.
  const POINTS_OVERRIDES = [
    { player: 'Dushan Hemantha', matchContains: ['England', 'Sri Lanka'], round: 5, pts: 29 },
  ];
  for (const row of rows) {
    const name = (row.playerName || '').toString().trim();
    const matchShort = (row.matchName || '').toString().split(',')[0].trim();
    const round = row.roundNumber;
    for (const o of POINTS_OVERRIDES) {
      if (name === o.player && round === o.round && o.matchContains.every(t => matchShort.includes(t))) {
        row.fantasyPoints = o.pts;
        row._pointsOverride = true;
        break;
      }
    }
  }

  // Recalculate Round 7 (England vs New Zealand) for all players from scorecard + ESPN dots + POTM
  const ENG_NZ_MATCH_KEY = '2026-02-27|England|New Zealand';
  const engNzExtras = espnExtras[ENG_NZ_MATCH_KEY];
  const engNzMatchIndex = matches.findIndex(
    (m) => makeMatchKey(getMatchDate(m.info), m.info.teams || []) === ENG_NZ_MATCH_KEY
  );
  if (engNzMatchIndex !== -1 && engNzExtras && engNzExtras.potm) {
    const match = matches[engNzMatchIndex];
    const stats = match.stats || {};
    const allNamesInMatch = rows
      .filter((r) => {
        const parts = (r.matchName || '').split(',').map((s) => s.trim());
        const short = parts[0] || '';
        const two = short.split(/\s+vs\s+/).map((s) => s.trim()).filter(Boolean);
        return makeMatchKey(r.matchDate, two) === ENG_NZ_MATCH_KEY;
      })
      .map((r) => r.playerName);
    let recalcCount = 0;
    for (const row of rows) {
      const matchShort = (row.matchName || '').toString().split(',')[0].trim();
      const parts = matchShort.split(/\s+vs\s+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length !== 2 || makeMatchKey(row.matchDate, parts) !== ENG_NZ_MATCH_KEY) continue;
      const playerName = (row.playerName || '').trim();
      const bat = battingBreakdown(stats.batting || {}, stats.bowling || {}, playerName);
      const sr = strikeRateBreakdown(stats.batting || {}, playerName);
      let dotCount = (stats.bowling && stats.bowling[playerName] && stats.bowling[playerName].dots) || 0;
      if (engNzExtras.dots && Object.keys(engNzExtras.dots).length > 0) {
        for (const [espnRaw, count] of Object.entries(engNzExtras.dots)) {
          if (espnNameMatch(espnRaw, playerName, allNamesInMatch)) {
            dotCount = count;
            break;
          }
        }
      }
      const bowlStat = stats.bowling && stats.bowling[playerName] ? { ...stats.bowling[playerName], dots: dotCount } : null;
      const bowl = bowlingBreakdown(bowlStat ? { [playerName]: bowlStat } : {}, playerName);
      const ec = economyBreakdown(stats.bowling || {}, playerName);
      const fl = fieldingBreakdown(stats.fielding || {}, playerName);
      const ptsPlaying = 4;
      const potmName = (engNzExtras.potm || '').trim();
      const ptsPOTM = potmName && espnNameMatch(potmName, playerName, allNamesInMatch) ? 50 : 0;
      const total = bat.battingPts + sr.ptsSR + bowl.bowlingPts + ec.ptsEconomy + fl.fieldingPts + ptsPlaying + ptsPOTM;
      row.fantasyPoints = Math.round(total * 10) / 10;
      row.ptsPOTM = ptsPOTM;
      row.ptsPlaying = ptsPlaying;
      row.ptsRuns = bat.ptsRuns;
      row.ptsFours = bat.ptsFours;
      row.ptsSixes = bat.ptsSixes;
      row.ptsMilestone = bat.ptsMilestone;
      row.ptsDuck = bat.ptsDuck;
      row.battingPts = bat.battingPts;
      row.ptsSR = sr.ptsSR;
      row.ptsWickets = bowl.ptsWickets;
      row.ptsLBWBowled = bowl.ptsLBWBowled;
      row.dots = bowl.dots;
      row.ptsDots = bowl.ptsDots;
      row.ptsMaidens = bowl.ptsMaidens;
      row.ptsWktBonus = bowl.ptsWktBonus;
      row.bowlingPts = bowl.bowlingPts;
      row.ptsEconomy = ec.ptsEconomy;
      row.ptsCatches = fl.ptsCatches;
      row.ptsStumpings = fl.ptsStumpings;
      row.ptsDirectRO = fl.ptsDirectRO;
      row.ptsAssistRO = fl.ptsAssistRO;
      row.fieldingPts = fl.fieldingPts;
      recalcCount++;
    }
    if (recalcCount > 0) console.log('Recalculated Round 7 (England vs NZ) points for', recalcCount, 'players.');
  }

  // Recalculate Round 5 (England vs Sri Lanka) from scorecard + ESPN dots + POTM (e.g. correct wicket count)
  const ENG_SL_MATCH_KEY = '2026-02-22|England|Sri Lanka';
  const engSlExtras = espnExtras[ENG_SL_MATCH_KEY];
  const engSlMatchIndex = matches.findIndex(
    (m) => makeMatchKey(getMatchDate(m.info), m.info.teams || []) === ENG_SL_MATCH_KEY
  );
  if (engSlMatchIndex !== -1) {
    const match = matches[engSlMatchIndex];
    const stats = match.stats || {};
    const allNamesInMatch = rows
      .filter((r) => {
        const parts = (r.matchName || '').split(',').map((s) => s.trim());
        const short = parts[0] || '';
        const two = short.split(/\s+vs\s+/).map((s) => s.trim()).filter(Boolean);
        return makeMatchKey(r.matchDate, two) === ENG_SL_MATCH_KEY;
      })
      .map((r) => r.playerName);
    let recalcCount = 0;
    for (const row of rows) {
      const matchShort = (row.matchName || '').toString().split(',')[0].trim();
      const parts = matchShort.split(/\s+vs\s+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length !== 2 || makeMatchKey(row.matchDate, parts) !== ENG_SL_MATCH_KEY) continue;
      const playerName = (row.playerName || '').trim();
      const bat = battingBreakdown(stats.batting || {}, stats.bowling || {}, playerName);
      const sr = strikeRateBreakdown(stats.batting || {}, playerName);
      let dotCount = (stats.bowling && stats.bowling[playerName] && stats.bowling[playerName].dots) || 0;
      if (engSlExtras && engSlExtras.dots && Object.keys(engSlExtras.dots).length > 0) {
        for (const [espnRaw, count] of Object.entries(engSlExtras.dots)) {
          if (espnNameMatch(espnRaw, playerName, allNamesInMatch)) {
            dotCount = count;
            break;
          }
        }
      }
      const bowlStat = stats.bowling && stats.bowling[playerName] ? { ...stats.bowling[playerName], dots: dotCount } : null;
      const bowl = bowlingBreakdown(bowlStat ? { [playerName]: bowlStat } : {}, playerName);
      const ec = economyBreakdown(stats.bowling || {}, playerName);
      const fl = fieldingBreakdown(stats.fielding || {}, playerName);
      const ptsPlaying = 4;
      const potmName = (engSlExtras && engSlExtras.potm) ? engSlExtras.potm.trim() : '';
      const ptsPOTM = potmName && espnNameMatch(potmName, playerName, allNamesInMatch) ? 50 : 0;
      const total = bat.battingPts + sr.ptsSR + bowl.bowlingPts + ec.ptsEconomy + fl.fieldingPts + ptsPlaying + ptsPOTM;
      row.fantasyPoints = Math.round(total * 10) / 10;
      row.ptsPOTM = ptsPOTM;
      row.ptsPlaying = ptsPlaying;
      row.ptsRuns = bat.ptsRuns;
      row.ptsFours = bat.ptsFours;
      row.ptsSixes = bat.ptsSixes;
      row.ptsMilestone = bat.ptsMilestone;
      row.ptsDuck = bat.ptsDuck;
      row.battingPts = bat.battingPts;
      row.ptsSR = sr.ptsSR;
      row.runs = bat.runs;
      row.fours = bat.fours;
      row.sixes = bat.sixes;
      row.ballsFaced = bat.balls;
      row.dismissed = bat.dismissed;
      row.ptsWickets = bowl.ptsWickets;
      row.ptsLBWBowled = bowl.ptsLBWBowled;
      row.wickets = bowl.wickets;
      row.dots = bowl.dots;
      row.ptsDots = bowl.ptsDots;
      row.ptsMaidens = bowl.ptsMaidens;
      row.ptsWktBonus = bowl.ptsWktBonus;
      row.bowlingPts = bowl.bowlingPts;
      row.runsConceded = bowl.runsConceded;
      row.ballsBowled = bowl.ballsBowled;
      row.ptsEconomy = ec.ptsEconomy;
      row.overs = ec.overs != null ? ec.overs : '';
      row.economy = ec.economy != null ? ec.economy : '';
      row.ptsCatches = fl.ptsCatches;
      row.ptsStumpings = fl.ptsStumpings;
      row.ptsDirectRO = fl.ptsDirectRO;
      row.ptsAssistRO = fl.ptsAssistRO;
      row.fieldingPts = fl.fieldingPts;
      row.catches = fl.catches;
      row.stumpings = fl.stumpings;
      row.directRunOut = fl.directRunOut;
      row.runOutAssist = fl.runOutAssist;
      recalcCount++;
    }
    if (recalcCount > 0) console.log('Recalculated Round 5 (England vs Sri Lanka) points for', recalcCount, 'players.');
  }

  const fullRecalc = process.env.FULL_RECALC === '1' || process.env.FULL_RECALC === 'true';
  if (fullRecalc) console.log('FULL_RECALC=1: recalculating all points from scorecards + ESPN (no existing data kept).');

  // Prefer existing Fantasy Points data: do not overwrite points for rows we already have (unless FULL_RECALC)
  if (!fullRecalc) {
    const toDateStr = (val) => {
      if (val == null) return '';
      if (val instanceof Date) return val.toISOString ? val.toISOString().slice(0, 10) : String(val).slice(0, 10);
      if (typeof val === 'number') return new Date((val - 25569) * 86400 * 1000).toISOString().slice(0, 10);
      return String(val).trim().slice(0, 10);
    };
    const rowKey = (r) =>
      `${(r.playerName || '').toString().trim()}|${(r.country || '').toString().trim()}|${toDateStr(r.matchDate)}`;
    const matchKeyFromRow = (r) => {
      const matchName = (r.matchName || '').toString().split(',')[0].trim();
      const parts = matchName.split(/\s+vs\s+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length !== 2) return null;
      return makeMatchKey(r.matchDate, parts);
    };
    const ALWAYS_USE_BUILT_MATCH_KEYS = new Set([
      '2026-03-04|New Zealand|South Africa',
      '2026-03-05|England|India',
      '2026-03-08|India|New Zealand',
    ]);
    if (fs.existsSync(OUT_PATH)) {
      const existingWb = new ExcelJS.Workbook();
      await existingWb.xlsx.readFile(OUT_PATH);
      const existingSheet = existingWb.getWorksheet('Fantasy Points');
      if (existingSheet) {
        const existingRows = [];
        existingSheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const obj = {};
          SHEET_COLUMNS.forEach((col, idx) => {
            const val = row.getCell(idx + 1).value;
            if (val !== undefined && val !== null) obj[col.key] = val;
          });
          if (obj.playerName != null || obj.matchDate != null) existingRows.push(obj);
        });
        const existingByKey = new Map();
        existingRows.forEach((r) => {
          const k = rowKey(r);
          existingByKey.set(k, r);
        });
        for (const row of rows) {
          if (row._pointsOverride) continue;
          const mk = matchKeyFromRow(row);
          if (mk && ALWAYS_USE_BUILT_MATCH_KEYS.has(mk)) continue;
          const ex = existingByKey.get(rowKey(row));
          if (ex) {
            for (const col of SHEET_COLUMNS) {
              if (ex[col.key] !== undefined && ex[col.key] !== null) row[col.key] = ex[col.key];
            }
          }
        }
        const seen = new Set(rows.map(rowKey));
        existingRows.forEach((r) => {
          if (!seen.has(rowKey(r))) {
            seen.add(rowKey(r));
            rows.push(r);
          }
        });
        rows.sort((a, b) => {
          const d = String(a.matchDate || '').localeCompare(String(b.matchDate || ''));
          if (d !== 0) return d;
          return String(a.matchName || '').localeCompare(String(b.matchName || ''));
        });
      }
    }
  }
  if (fullRecalc) {
    rows.sort((a, b) => {
      const d = String(a.matchDate || '').localeCompare(String(b.matchDate || ''));
      if (d !== 0) return d;
      return String(a.matchName || '').localeCompare(String(b.matchName || ''));
    });
  }

  if (scheduleRounds && scheduleRounds.roundForTeamInMatch && rows.length > 0) {
    const rf = scheduleRounds.roundForTeamInMatch;
    let recomputed = 0;
    for (const row of rows) {
      const country = (row.country || '').toString().trim();
      const matchDate = row.matchDate != null ? String(row.matchDate).trim() : '';
      const matchNameRaw = (row.matchName || '').toString().trim();
      const matchName = matchNameRaw.includes(',') ? matchNameRaw.split(',')[0].trim() : matchNameRaw;
      if (!country || !matchName) continue;
      const parts = matchName.split(/\s+vs\s+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length !== 2) continue;
      const key = makeMatchKey(matchDate, parts);
      const round = rf[country] && rf[country][key];
      if (round != null) {
        const prev = row.roundNumber;
        row.roundNumber = round;
        if (prev !== round) recomputed++;
      }
    }
    if (recomputed > 0) console.log('Recomputed round number from schedule for', recomputed, 'row(s).');
  }

  function isValidRound(r) {
    const n = r != null ? (typeof r === 'number' ? r : parseInt(r, 10)) : null;
    return typeof n === 'number' && !isNaN(n) && n >= 1 && n <= 9;
  }
  const byCountry = {};
  for (const row of rows) {
    const c = (row.country || '').toString().trim();
    if (!byCountry[c]) byCountry[c] = [];
    byCountry[c].push(row);
  }
  let fallbackAssigned = 0;
  for (const country of Object.keys(byCountry)) {
    const list = byCountry[country];
    list.sort((a, b) => {
      const da = String(a.matchDate || '').localeCompare(String(b.matchDate || ''));
      if (da !== 0) return da;
      return String(a.matchName || '').localeCompare(String(b.matchName || ''));
    });
    const usedRounds = new Set();
    for (const row of list) if (isValidRound(row.roundNumber)) usedRounds.add(Number(row.roundNumber));
    for (const row of list) {
      if (isValidRound(row.roundNumber)) continue;
      for (let r = 1; r <= 9; r++) {
        if (!usedRounds.has(r)) {
          row.roundNumber = r;
          usedRounds.add(r);
          fallbackAssigned++;
          break;
        }
      }
    }
  }
  if (fallbackAssigned > 0) console.log('Assigned round (fallback by date order) for', fallbackAssigned, 'row(s).');

  if (rows.length === 0) {
    console.error('No rows to write (no new scorecards and no existing sheet). Run again when more matches are completed or rate limit resets.');
    process.exit(1);
  }

  if (!fs.existsSync(path.dirname(OUT_PATH))) fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  const workbookToWrite = new ExcelJS.Workbook();
  if (matchList && matchList.length > 0) {
    addScheduleSheetFirst(workbookToWrite, matchList);
  }
  const sheet = workbookToWrite.addWorksheet('Fantasy Points', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = SHEET_COLUMNS;
  sheet.getRow(1).font = { bold: true };
  rows.forEach((r) => sheet.addRow(r));

  if (fs.existsSync(OUT_PATH)) {
    const existingWb = new ExcelJS.Workbook();
    await existingWb.xlsx.readFile(OUT_PATH);
    existingWb.eachSheet((ws) => {
      if (ws.name !== 'Fantasy Points' && ws.name !== 'Schedule') copySheet(ws, workbookToWrite);
    });
  }

  await workbookToWrite.xlsx.writeFile(OUT_PATH);
  console.log('Written:', OUT_PATH);
  console.log('Total rows:', rows.length);
  if (matchList && matchList.length > 0) console.log('Schedule sheet added as first sheet.');

  const outAbsolute = path.resolve(OUT_PATH);
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const envGroup = { ...process.env, FANTASY_WORKBOOK_PATH: outAbsolute, OUTPUT_WORKBOOK_PATH: outAbsolute };
  const envTotal = { ...process.env, FANTASY_WORKBOOK_PATH: outAbsolute };

  // Check if group sheets already exist (carried over from existing file in the copy step above)
  const checkWb = new ExcelJS.Workbook();
  await checkWb.xlsx.readFile(outAbsolute);
  const hasGroupSheets = checkWb.getWorksheet('Group 1') != null;

  if (hasGroupSheets) {
    console.log('Group sheets already exist – refreshing round points from Fantasy Points sheet...');
    const addGroups = spawnSync(process.execPath, [path.join(scriptsDir, 'add-group-sheets.js')], {
      cwd: path.join(__dirname, '..'),
      env: envGroup,
      stdio: 'inherit',
    });
    if (addGroups.status !== 0) {
      console.warn('add-group-sheets.js exited with', addGroups.status);
    }
    await fillNewGroupScores(outAbsolute);
  } else {
    console.log('No group sheets found – creating Group 1–8 sheets from auction workbook...');
    const addGroups = spawnSync(process.execPath, [path.join(scriptsDir, 'add-group-sheets.js')], {
      cwd: path.join(__dirname, '..'),
      env: envGroup,
      stdio: 'inherit',
    });
    if (addGroups.status !== 0) {
      console.warn('add-group-sheets.js exited with', addGroups.status, '- Group sheets may be missing.');
    }
  }
  console.log('Updating Total and Round Total rows in Group sheets...');
  const addTotal = spawnSync(process.execPath, [path.join(scriptsDir, 'add-total-row-to-group-sheets.js')], {
    cwd: path.join(__dirname, '..'),
    env: envTotal,
    stdio: 'inherit',
  });
  if (addTotal.status !== 0) console.warn('add-total-row-to-group-sheets.js exited with', addTotal.status);

  console.log('Adding Leaderboard sheet...');
  await addLeaderboardSheet(outAbsolute);

  await applyCenterAlignmentToWorkbook(outAbsolute);
  console.log('Done.');
}

/** Set every cell in the workbook to center alignment (horizontal and vertical). */
async function applyCenterAlignmentToWorkbook(wbPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(wbPath);
  const centerAlign = { horizontal: 'center', vertical: 'middle' };
  wb.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.alignment = centerAlign;
      });
    });
  });
  await wb.xlsx.writeFile(wbPath);
  console.log('Applied center alignment to all cells.');
}

/**
 * Fill empty score cells in existing group sheets from the Fantasy Points sheet.
 * Only writes into cells that are currently empty – never overwrites existing scores.
 */
async function fillNewGroupScores(wbPath) {
  const ROUND_LABELS = ['Round1', 'Round2', 'Round3', 'Round4', 'Round5', 'Round6', 'Round7', 'Semi-Final', 'Final'];
  const COUNTRY_TO_CODE = {
    Australia: 'AUS', England: 'ENG', India: 'IND', 'New Zealand': 'NZ',
    'West Indies': 'WI', 'South Africa': 'SA', Pakistan: 'PAK', 'Sri Lanka': 'SL',
    Afghanistan: 'AFG', Bangladesh: 'BAN', Zimbabwe: 'ZIM',
    'United Arab Emirates': 'UAE', Oman: 'OMN', Canada: 'CAN',
    Nepal: 'NEP', Netherlands: 'NED', Scotland: 'SCO', Ireland: 'IRE',
    'United States of America': 'USA', Namibia: 'NAM', Italy: 'ITA',
  };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(wbPath);
  const fp = wb.getWorksheet('Fantasy Points');
  if (!fp) return;

  // Build lookup: { "playerName|countryCode|roundNumber" -> fantasyPoints }
  const scoreLookup = {};
  for (let r = 2; r <= fp.rowCount; r++) {
    const name = (fp.getRow(r).getCell(1).value || '').toString().trim();
    const country = (fp.getRow(r).getCell(2).value || '').toString().trim();
    const round = Number(fp.getRow(r).getCell(5).value);
    const pts = fp.getRow(r).getCell(6).value;
    if (!name || !round || pts == null) continue;
    const code = COUNTRY_TO_CODE[country] || country;
    scoreLookup[`${name}|${code}|${round}`] = typeof pts === 'number' ? pts : parseFloat(pts) || 0;
  }

  // Players not in auction file – fallback country for score lookup (includes replacements)
  const NOT_IN_AUCTION = { 'Dushan Hemantha': 'SL', 'Cole McConchie': 'NZ' };

  // Read auction workbook for name -> countryCode mapping
  const auctionPath = path.join(__dirname, '..', 'ICC T20 WC 2026 Auction Game.xlsx');
  let auctionPlayers = {};
  if (fs.existsSync(auctionPath)) {
    const aw = new ExcelJS.Workbook();
    await aw.xlsx.readFile(auctionPath);
    const pl = aw.getWorksheet('Players List');
    if (pl) {
      for (let r = 2; r <= pl.rowCount; r++) {
        const n = (pl.getRow(r).getCell(1).value || '').toString().trim();
        const cc = (pl.getRow(r).getCell(2).value || '').toString().trim();
        if (n && cc) auctionPlayers[n] = cc;
      }
    }
  }

  let filled = 0;
  for (let g = 1; g <= 8; g++) {
    const sheet = wb.getWorksheet('Group ' + g);
    if (!sheet) continue;

    // Find round score columns by header label
    const hdr = sheet.getRow(1);
    const roundColMap = [];
    for (let c = 1; c <= (sheet.columnCount || 30); c++) {
      const label = (hdr.getCell(c).value || '').toString().trim();
      const idx = ROUND_LABELS.indexOf(label);
      if (idx !== -1) roundColMap.push({ col: c, round: idx + 1 });
    }

    for (let r = 2; r <= sheet.rowCount; r++) {
      const playerName = (sheet.getRow(r).getCell(1).value || '').toString().trim();
      if (!playerName || playerName === 'Total' || playerName === 'Round Total') continue;
      const cc = auctionPlayers[playerName] || NOT_IN_AUCTION[playerName] || '';

      for (const { col, round } of roundColMap) {
        const existing = sheet.getRow(r).getCell(col).value;
        if (existing != null && existing !== '') continue;

        const pts = scoreLookup[`${playerName}|${cc}|${round}`];
        if (pts !== undefined) {
          sheet.getRow(r).getCell(col).value = pts;
          console.log('  Filled Group ' + g + ': ' + playerName + ' R' + round + ' = ' + pts);
          filled++;
        }
      }
    }
  }

  if (filled > 0) {
    await wb.xlsx.writeFile(wbPath);
    console.log('Filled ' + filled + ' new score(s) in group sheets.');
  } else {
    console.log('No new scores to fill.');
  }
}

const GROUP_OWNERS = {
  1: 'Sayanth & Pawan',
  2: 'Vedant, Keshav, Ayaan & Anmol',
  3: 'Janagesh & Akshay',
  4: 'Kathan, Aryan & Aarav',
  5: 'Divyesh & Naman',
  6: 'Kavi, Balu, Denver & Gowtham',
  7: 'Osheen & Krishna',
  8: 'Ganapathy',
};

async function addLeaderboardSheet(wbPath) {
  const roundRefCols = ['C', 'F', 'I', 'L', 'O', 'R', 'U', 'X', 'AA'];
  const roundLabels = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'SF', 'Final'];
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(wbPath);

  const rtRows = {};
  for (let g = 1; g <= 8; g++) {
    const sheet = wb.getWorksheet('Group ' + g);
    if (!sheet) continue;
    for (let r = 2; r <= sheet.rowCount; r++) {
      if ((sheet.getRow(r).getCell(1).value || '').toString().trim() === 'Round Total') {
        rtRows[g] = r;
        break;
      }
    }
  }

  const existing = wb.getWorksheet('Leaderboard');
  if (existing) wb.removeWorksheet(existing.id);
  const lb = wb.addWorksheet('Leaderboard');

  // === DATA SECTION (rows 12-20): unsorted raw formulas referencing group sheets ===
  const dataHeaderRow = lb.getRow(12);
  ['', 'Group', 'Team', ...roundLabels, 'Grand Total', 'Rank'].forEach((h, i) => {
    const c = dataHeaderRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 8, color: { argb: 'FF999999' } };
  });

  for (let g = 1; g <= 8; g++) {
    const dataRow = 12 + g;
    const row = lb.getRow(dataRow);
    const rtRow = rtRows[g];
    const sheetRef = "'Group " + g + "'";

    row.getCell(1).value = g;
    row.getCell(2).value = 'Group ' + g;
    row.getCell(3).value = GROUP_OWNERS[g] || 'Group ' + g;
    for (let ri = 0; ri < 9; ri++) {
      row.getCell(ri + 4).value = rtRow ? { formula: sheetRef + '!' + roundRefCols[ri] + rtRow } : 0;
    }
    row.getCell(13).value = { formula: 'SUM(D' + dataRow + ':L' + dataRow + ')' };
    row.getCell(14).value = { formula: 'RANK(M' + dataRow + ',$M$13:$M$20)' };
    for (let c = 1; c <= 14; c++) row.getCell(c).font = { size: 8, color: { argb: 'FF999999' } };
  }
  lb.getRow(11).getCell(1).value = 'Source Data (auto-calculated):';
  lb.getRow(11).getCell(1).font = { italic: true, size: 8, color: { argb: 'FFAAAAAA' } };

  // === DISPLAY SECTION (row 1 header + rows 2-9): sorted by Grand Total via INDEX/MATCH ===
  const headers = ['Rank', 'Group', 'Team', ...roundLabels, 'Grand Total'];
  const hdr = lb.getRow(1);
  headers.forEach((h, i) => {
    const c = hdr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = border;
  });
  hdr.height = 24;

  for (let rank = 1; rank <= 8; rank++) {
    const dispRow = rank + 1;
    const row = lb.getRow(dispRow);
    const matchExpr = 'MATCH(' + rank + ',$N$13:$N$20,0)';

    row.getCell(1).value = rank;
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(1).font = { bold: true, size: 11 };
    row.getCell(1).border = border;

    row.getCell(2).value = { formula: 'INDEX($B$13:$B$20,' + matchExpr + ')' };
    row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(2).border = border;

    row.getCell(3).value = { formula: 'INDEX($C$13:$C$20,' + matchExpr + ')' };
    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(3).border = border;

    for (let ri = 0; ri < 9; ri++) {
      const colLetter = String.fromCharCode(68 + ri);
      const c = row.getCell(ri + 4);
      c.value = { formula: 'INDEX($' + colLetter + '$13:$' + colLetter + '$20,' + matchExpr + ')' };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = border;
    }

    row.getCell(13).value = { formula: 'INDEX($M$13:$M$20,' + matchExpr + ')' };
    row.getCell(13).font = { bold: true, size: 11 };
    row.getCell(13).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
    row.getCell(13).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(13).border = border;

    if (rank === 1) {
      for (let c = 1; c <= 13; c++) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
      row.getCell(13).font = { bold: true, size: 11, color: { argb: 'FFE65100' } };
    }
    if (rank === 2 || rank === 3) {
      for (let c = 1; c <= 12; c++) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8E9' } };
    }
    row.height = 22;
  }

  lb.getColumn(1).width = 6; lb.getColumn(2).width = 10; lb.getColumn(3).width = 35;
  for (let i = 4; i <= 12; i++) lb.getColumn(i).width = 9;
  lb.getColumn(13).width = 13; lb.getColumn(14).width = 6;

  const newWb = new ExcelJS.Workbook();
  const desiredOrder = ['Schedule', 'Fantasy Points', 'Leaderboard',
    'Group 1','Group 2','Group 3','Group 4','Group 5','Group 6','Group 7','Group 8'];
  for (const name of desiredOrder) {
    const src = wb.getWorksheet(name);
    if (!src) continue;
    const dst = newWb.addWorksheet(name);
    for (let c = 1; c <= (src.columnCount || 0); c++) { const w = src.getColumn(c).width; if (w) dst.getColumn(c).width = w; }
    src.eachRow({ includeEmpty: false }, (srcRow, rn) => {
      const dstRow = dst.getRow(rn);
      dstRow.height = srcRow.height;
      for (let c = 1; c <= (src.columnCount || 0); c++) {
        const sc = srcRow.getCell(c), dc = dstRow.getCell(c);
        dc.value = sc.value;
        if (sc.font) dc.font = sc.font; if (sc.fill) dc.fill = sc.fill;
        if (sc.border) dc.border = sc.border; if (sc.alignment) dc.alignment = sc.alignment;
        if (sc.numFmt) dc.numFmt = sc.numFmt;
      }
    });
  }
  await newWb.xlsx.writeFile(wbPath);
  console.log('Leaderboard sheet added (3rd sheet).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
