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
const { buildRowsForMatch, getMatchDate, getMatchName } = require('./fantasyScoring');

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
  const { seriesId, apiKey, baseUrl } = loadConfig();
  if (!seriesId || !apiKey) {
    console.error('Set seriesId and apiKey in cricketdata/config.json or env CRICKETDATA_SERIES_ID, CRICKETDATA_API_KEY');
    process.exit(1);
  }

  const fetchedIds = loadFetchedIds();
  if (fetchedIds.size) console.log('Already have scorecards for', fetchedIds.size, 'match(es); will use cache for those.');

  let matchList = loadScheduleFromFile();
  if (matchList && matchList.length > 0) {
    console.log('Using saved schedule from', SCHEDULE_JSON_PATH, '(' + matchList.length, 'matches). No API call.');
  } else {
    console.log('No saved schedule; fetching series (1 API call)...');
    try {
      matchList = await fetchSeriesMatches(seriesId, apiKey, baseUrl);
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
    const progress = `[${i + 1}/${totalCompleted}]`;
    let raw = loadScorecardFromCache(id);
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
      console.log(progress, 'Fetching from API:', matchLabel, '...');
      try {
        raw = await fetchMatchDetails(id, apiKey, baseUrl);
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

  if (fs.existsSync(OUT_PATH)) {
    const existingWb = new ExcelJS.Workbook();
    await existingWb.xlsx.readFile(OUT_PATH);
    const existingSheet = existingWb.getWorksheet('Fantasy Points');
    if (existingSheet) {
      const key = (r) => `${(r.playerName || '').toString().trim()}|${(r.country || '').toString().trim()}|${(r.matchDate || '').toString().trim()}`;
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
      const seen = new Set(rows.map(key));
      existingRows.forEach((r) => {
        if (!seen.has(key(r))) {
          seen.add(key(r));
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

  console.log('Adding Group 1–8 sheets (from auction workbook)...');
  const addGroups = spawnSync(process.execPath, [path.join(scriptsDir, 'add-group-sheets.js')], {
    cwd: path.join(__dirname, '..'),
    env: envGroup,
    stdio: 'inherit',
  });
  if (addGroups.status !== 0) {
    console.warn('add-group-sheets.js exited with', addGroups.status, '- Group sheets may be missing. Ensure ICC T20 WC 2026 Auction Game.xlsx exists.');
  } else {
    console.log('Adding Total and Round Total rows to Group sheets...');
    const addTotal = spawnSync(process.execPath, [path.join(scriptsDir, 'add-total-row-to-group-sheets.js')], {
      cwd: path.join(__dirname, '..'),
      env: envTotal,
      stdio: 'inherit',
    });
    if (addTotal.status !== 0) console.warn('add-total-row-to-group-sheets.js exited with', addTotal.status);
    else console.log('Group sheets updated with Total and Round Total rows.');
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
