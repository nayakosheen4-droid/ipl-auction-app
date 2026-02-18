#!/usr/bin/env node
/**
 * Reads Fantasy_Points_T20WC_2025_26.xlsx and writes an UPDATED copy to
 * Fantasy_Points_T20WC_2025_26_with_groups.xlsx with the 8 group sheets refreshed.
 * The main workbook is NEVER overwritten (your manual edits are safe).
 * Each group sheet: Player Name (auction), Round1, Round2, ...
 */

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const FANTASY_PATH = process.env.FANTASY_WORKBOOK_PATH || path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26.xlsx');
const AUCTION_PATH = process.env.AUCTION_WORKBOOK_PATH || path.join(__dirname, '..', 'ICC T20 WC 2026 Auction Game.xlsx');
/** Output path: script writes HERE so the main workbook is never overwritten. Copy sheets back to main file if needed. */
const OUTPUT_PATH = process.env.OUTPUT_WORKBOOK_PATH || path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26_with_groups.xlsx');

const COUNTRY_TO_CODE = {
  Australia: 'AUS',
  England: 'ENG',
  India: 'IND',
  'New Zealand': 'NZ',
  'West Indies': 'WI',
  'South Africa': 'SA',
  Pakistan: 'PAK',
  'Sri Lanka': 'SL',
  Afghanistan: 'AFG',
  Bangladesh: 'BAN',
  Zimbabwe: 'ZIM',
  'United Arab Emirates': 'UAE',
  Scotland: 'SCO',
  Ireland: 'IRE',
  Netherlands: 'NED',
  Canada: 'CAN',
  'United States of America': 'USA',
  Namibia: 'NAM',
  Nepal: 'NEP',
  Oman: 'OMA',
  Italy: 'ITA',
};

const CODE_TO_COUNTRY = {};
for (const [country, code] of Object.entries(COUNTRY_TO_CODE)) {
  CODE_TO_COUNTRY[code] = country;
}

const SCHEDULE_JSON_PATH = process.env.SCHEDULE_JSON_PATH || path.join(__dirname, '..', 'cricketdata', 'schedule.json');

/** Manual fantasy name -> auction name overrides when auto-match fails. Key by country code. */
const FANTASY_TO_AUCTION_OVERRIDES = {
  SL: {
    'BKG Mendis': 'Kusal Mendis',
    'PVD Chameera': 'Dushmantha Chameera',
    'PHKD Mendis': 'Kamindu Mendis',
    'PWH de Silva': 'Wanindu Hasaranga',
  },
  PAK: {
    'Agha Salman': 'Salman Agha',
  },
  SA: {
    'Q de Kock': 'Quinton de Kock',
  },
  IND: {
    'CV Varun': 'Varun Chakaravarthy',
    'HH Pandya': 'Hardik Pandya',
  },
  NZ: {
    'JDS Neesham': 'James Neesham',
  },
};

/** Group substitutions: injured/replaced player (auction name) -> replacement (display name and points lookup). Only the group sheets use this; key = "Group N", value = { "Auction Name": "Replacement Name" }. */
const GROUP_SUBSTITUTIONS = {
  'Group 5': { 'Harshit Rana': 'Mohammed Siraj' },
};

/** Fixed round structure: 7 rounds + Semi-Final + Final. Round numbers 8 and 9 in Fantasy Points map to Semi-Final and Final. */
const ROUND_LABELS = ['Round1', 'Round2', 'Round3', 'Round4', 'Round5', 'Round6', 'Round7', 'Semi-Final', 'Final'];
const OPPONENT_HEADERS = ['R1 Opp', 'R2 Opp', 'R3 Opp', 'R4 Opp', 'R5 Opp', 'R6 Opp', 'R7 Opp', 'SF Opp', 'Fin Opp'];
const NUM_ROUNDS = ROUND_LABELS.length;

/**
 * Load schedule from cricketdata/schedule.json (written by build-fantasy-from-api).
 * Returns array of { date, dateTimeGMT, teams, venue, status }.
 */
function loadSchedule() {
  if (!fs.existsSync(SCHEDULE_JSON_PATH)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(SCHEDULE_JSON_PATH, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function makeMatchKey(dateStr, teamsArr) {
  let datePart = '';
  if (dateStr != null) {
    if (dateStr instanceof Date || (typeof dateStr === 'object' && typeof dateStr.getFullYear === 'function')) {
      datePart = dateStr.toISOString ? dateStr.toISOString().slice(0, 10) : String(dateStr).slice(0, 10);
    } else {
      datePart = String(dateStr).trim().slice(0, 10);
    }
  }
  const teams = (teamsArr || []).filter(Boolean).map((t) => String(t).trim()).sort();
  return `${datePart}|${teams.join('|')}`;
}

/** roundForTeamInMatch[team][matchKey] = 1-based round. Used to infer round when Fantasy row has no round. */
function buildRoundForTeamInMatch(schedule) {
  const sorted = [...schedule].sort((a, b) => String(a.date || a.dateTimeGMT || '').localeCompare(String(b.date || b.dateTimeGMT || '')));
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
  return roundForTeamInMatch;
}

/**
 * For each country (full name), get list of opponents by round: [ { roundLabel, opponent }, ... ].
 * Schedule items have .teams (array of 2 names) and .date, sorted by date.
 */
function buildTeamMatchesByRound(schedule) {
  const sorted = [...schedule].sort((a, b) => String(a.date || a.dateTimeGMT || '').localeCompare(String(b.date || b.dateTimeGMT || '')));
  const teamRoundOpponent = {};
  for (const m of sorted) {
    const teams = m.teams || (m.teamInfo && m.teamInfo.map((t) => t.name)) || [];
    if (teams.length < 2) continue;
    const [a, b] = teams;
    for (const t of [a, b]) {
      const opp = t === a ? b : a;
      if (!teamRoundOpponent[t]) teamRoundOpponent[t] = [];
      teamRoundOpponent[t].push(opp);
    }
  }
  const roundLabels = ROUND_LABELS;
  const result = {};
  for (const [team, opponents] of Object.entries(teamRoundOpponent)) {
    result[team] = opponents.slice(0, roundLabels.length).map((opp, i) => ({
      roundLabel: roundLabels[i] || `Round${i + 1}`,
      opponent: opp,
    }));
  }
  return result;
}

function formatMatchesForPlayer(countryCode, teamMatchesByRound) {
  const countryName = CODE_TO_COUNTRY[countryCode] || countryCode;
  const rounds = teamMatchesByRound[countryName];
  if (!rounds || rounds.length === 0) return '';
  return rounds.map((r) => `vs ${r.opponent} (${r.roundLabel})`).join(', ');
}

function columnLetter(n) {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function getCellValue(cell) {
  if (!cell || !cell.value) return null;
  const v = cell.value;
  if (typeof v === 'object' && v !== null && 'result' in v) return v.result;
  if (typeof v === 'object' && v !== null && 'richText' in v) return v.richText.map((t) => t.text).join('');
  return v;
}

function normalize(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function surname(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1].toLowerCase() : '';
}

function firstPart(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join(' ').trim();
}

function firstName(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[0].toLowerCase() : '';
}

/** Match fantasy name (e.g. "BA King", "Babar Azam") to an auction name (e.g. "Brandon King", "Babar Azam"). */
function matchPlayerName(fantasyName, auctionName, countryMatch) {
  if (!countryMatch) return false;
  const f = normalize(fantasyName);
  const a = normalize(auctionName);
  if (f === a) return true;
  const fSurname = surname(fantasyName);
  const aSurname = surname(auctionName);
  if (fSurname !== aSurname) return false;
  const fFirst = firstPart(fantasyName);
  const aFirst = firstName(auctionName);
  if (!fFirst) return true;
  if (fFirst.length <= 2) {
    return aFirst.length > 0 && fFirst.includes(aFirst[0]);
  }
  return aFirst.startsWith(fFirst) || fFirst.startsWith(aFirst);
}

function loadFantasyRows(workbook) {
  const sheet = workbook.getWorksheet('Fantasy Points');
  if (!sheet) return [];
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const playerName = getCellValue(row.getCell(1));
    const country = getCellValue(row.getCell(2));
    const matchName = getCellValue(row.getCell(3));
    const matchDate = getCellValue(row.getCell(4));
    const round = getCellValue(row.getCell(5));
    const points = getCellValue(row.getCell(6));
    if (playerName == null) return;
    const roundNum = round != null && round !== '' ? (typeof round === 'number' ? round : parseInt(round, 10)) : null;
    const validRound = typeof roundNum === 'number' && !isNaN(roundNum) && roundNum >= 1 && roundNum <= 9;
    rows.push({
      playerName: String(playerName).trim(),
      country: country != null ? String(country).trim() : '',
      matchName: matchName != null ? String(matchName).trim() : '',
      matchDate: matchDate != null ? matchDate : null,
      roundNumber: validRound ? roundNum : null,
      fantasyPoints: typeof points === 'number' ? points : parseFloat(points) || 0,
    });
  });
  return rows;
}

function loadAuctionPlayersByGroup(workbook) {
  const sheet = workbook.getWorksheet('Main Auction');
  if (!sheet) return {};
  const groupCols = [1, 5, 9, 13, 17, 21, 25, 29];
  const countryCols = [2, 6, 10, 14, 18, 22, 26, 30];
  const groups = {};
  for (let g = 1; g <= 8; g++) {
    groups[`Group ${g}`] = [];
    const nameCol = groupCols[g - 1];
    const countryCol = countryCols[g - 1];
    for (let row = 9; row <= 28; row++) {
      const name = getCellValue(sheet.getRow(row).getCell(nameCol));
      const code = getCellValue(sheet.getRow(row).getCell(countryCol));
      if (name && String(name).trim()) {
        groups[`Group ${g}`].push({
          name: String(name).trim(),
          countryCode: code ? String(code).trim() : '',
        });
      }
    }
  }
  return groups;
}

function findAllAuctionPlayersWithCountry(playersByGroup) {
  const list = [];
  for (const players of Object.values(playersByGroup)) {
    for (const p of players) {
      list.push({ name: p.name, countryCode: p.countryCode });
    }
  }
  return list;
}

async function main() {
  const schedule = loadSchedule();
  const teamMatchesByRound = buildTeamMatchesByRound(schedule);
  const roundForTeamInMatch = schedule.length > 0 ? buildRoundForTeamInMatch(schedule) : {};

  const auctionWb = new ExcelJS.Workbook();
  await auctionWb.xlsx.readFile(AUCTION_PATH);
  const playersByGroup = loadAuctionPlayersByGroup(auctionWb);

  const fantasyReadWb = new ExcelJS.Workbook();
  await fantasyReadWb.xlsx.readFile(FANTASY_PATH);
  const fantasyRows = loadFantasyRows(fantasyReadWb);

  function inferRoundFromSchedule(row) {
    if (row.roundNumber != null && row.roundNumber >= 1 && row.roundNumber <= 9) return row.roundNumber;
    const country = (row.country || '').toString().trim();
    const matchNameRaw = (row.matchName || '').toString().trim();
    const matchName = matchNameRaw.includes(',') ? matchNameRaw.split(',')[0].trim() : matchNameRaw;
    if (!country || !matchName) return null;
    const parts = matchName.split(/\s+vs\s+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 2) return null;
    const key = makeMatchKey(row.matchDate, parts);
    const round = roundForTeamInMatch[country] && roundForTeamInMatch[country][key];
    return round != null && round >= 1 && round <= 9 ? round : null;
  }

  function findAuctionMatch(row, list) {
    const fantasyCountryCode = COUNTRY_TO_CODE[row.country] || '';
    const overridesForCountry = FANTASY_TO_AUCTION_OVERRIDES[fantasyCountryCode];
    if (overridesForCountry && overridesForCountry[row.playerName]) {
      const ap = list.find((a) => a.name === overridesForCountry[row.playerName] && (!fantasyCountryCode || a.countryCode === fantasyCountryCode));
      if (ap) return ap.name;
    }
    for (const ap of list) {
      if (ap.countryCode && fantasyCountryCode && ap.countryCode !== fantasyCountryCode) continue;
      const aNorm = normalize(ap.name);
      const fNorm = normalize(row.playerName);
      if (aNorm === fNorm) return ap.name;
      const fSur = surname(row.playerName);
      const aSur = surname(ap.name);
      if (fSur !== aSur) continue;
      const fFirst = firstPart(row.playerName);
      const aFirst = firstName(ap.name);
      if (!fFirst) continue;
      if (fFirst.length <= 2 && aFirst && fFirst.toLowerCase().includes(aFirst[0])) return ap.name;
      const fFirstLow = fFirst.toLowerCase();
      if (fFirst.length > 2 && (aFirst.startsWith(fFirstLow) || fFirstLow.startsWith(aFirst))) return ap.name;
    }
    return null;
  }

  let auctionList = findAllAuctionPlayersWithCountry(playersByGroup);
  const substitutionReplacements = new Set();
  for (const subs of Object.values(GROUP_SUBSTITUTIONS)) {
    for (const replacementName of Object.values(subs)) substitutionReplacements.add(replacementName);
  }
  for (const rep of substitutionReplacements) {
    if (!auctionList.some((ap) => ap.name === rep)) {
      const code = rep === 'Mohammed Siraj' ? 'IND' : '';
      auctionList = auctionList.concat([{ name: rep, countryCode: code }]);
    }
  }

  const rowsWithBest = [];
  for (const row of fantasyRows) {
    const best = findAuctionMatch(row, auctionList);
    if (!best) continue;
    const roundToUse = inferRoundFromSchedule(row);
    rowsWithBest.push({ row, best, roundToUse });
  }

  const byAuctionName = {};
  for (const { row, best, roundToUse } of rowsWithBest) {
    if (!byAuctionName[best]) byAuctionName[best] = [];
    byAuctionName[best].push({ row, roundToUse });
  }

  const pointsByAuctionPlayerRound = {};
  const matchedFantasyKeys = new Set();
  const matchedAuctionNames = new Set();

  for (const [auctionName, entries] of Object.entries(byAuctionName)) {
    entries.sort((a, b) => {
      const da = String(a.row.matchDate || '').localeCompare(String(b.row.matchDate || ''));
      if (da !== 0) return da;
      return String(a.row.matchName || '').localeCompare(String(b.row.matchName || ''));
    });
    const usedRounds = new Set();
    for (const { row, roundToUse } of entries) {
      let r = roundToUse;
      if (r == null || r < 1 || r > 9 || usedRounds.has(r)) {
        r = null;
        for (let i = 1; i <= 9; i++) {
          if (!usedRounds.has(i)) {
            r = i;
            break;
          }
        }
      }
      if (r != null && r >= 1 && r <= 9) {
        usedRounds.add(r);
        if (!pointsByAuctionPlayerRound[auctionName]) pointsByAuctionPlayerRound[auctionName] = {};
        pointsByAuctionPlayerRound[auctionName][r] = row.fantasyPoints;
        matchedFantasyKeys.add(`${row.country}|${row.playerName}`);
        matchedAuctionNames.add(auctionName);
      }
    }
  }

  const unmatchedFantasy = fantasyRows.filter((r) => !matchedFantasyKeys.has(`${r.country}|${r.playerName}`));
  const unmatchedAuction = auctionList.filter((ap) => !matchedAuctionNames.has(ap.name));

  let targetWb;
  if (fs.existsSync(OUTPUT_PATH)) {
    targetWb = new ExcelJS.Workbook();
    await targetWb.xlsx.readFile(OUTPUT_PATH);
  } else {
    targetWb = new ExcelJS.Workbook();
    await targetWb.xlsx.readFile(FANTASY_PATH);
  }

  for (let g = 1; g <= 8; g++) {
    const sheetName = `Group ${g}`;
    let sheet = targetWb.getWorksheet(sheetName);

    if (!sheet) {
      sheet = targetWb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
      const colDefs = [{ header: 'Player Name', key: 'playerName', width: 22 }];
      for (let r = 0; r < NUM_ROUNDS; r++) {
        colDefs.push({ header: 'Playing XI', key: `xi${r + 1}`, width: 10 });
        colDefs.push({ header: ROUND_LABELS[r], key: `round${r + 1}`, width: 10 });
        colDefs.push({ header: OPPONENT_HEADERS[r], key: `round${r + 1}Opp`, width: 14 });
      }
      sheet.columns = colDefs;
      sheet.getRow(1).font = { bold: true };
      const groupPlayers = playersByGroup[sheetName] || [];
      const subs = GROUP_SUBSTITUTIONS[sheetName] || {};
      const countryName = (code) => CODE_TO_COUNTRY[code] || code;
      for (const player of groupPlayers) {
        const auctionName = typeof player === 'string' ? player : player.name;
        const displayName = subs[auctionName] || auctionName;
        const lookupName = subs[auctionName] || auctionName;
        const countryCode = typeof player === 'string' ? '' : (player.countryCode || '');
        const rounds = teamMatchesByRound[countryName(countryCode)] || [];
        const rowData = { playerName: displayName };
        for (let r = 1; r <= NUM_ROUNDS; r++) {
          rowData[`xi${r}`] = 0;
          const pts = pointsByAuctionPlayerRound[lookupName]
            ? pointsByAuctionPlayerRound[lookupName][r]
            : undefined;
          rowData[`round${r}`] = pts !== undefined ? pts : '';
          rowData[`round${r}Opp`] = rounds[r - 1] ? rounds[r - 1].opponent : '';
        }
        sheet.addRow(rowData);
      }
      continue;
    }

    const headerRow = sheet.getRow(1);
    const sheetRowCount = sheet.rowCount || 0;
    let lastPlayerRow = 1;
    for (let r = 2; r <= sheetRowCount; r++) {
      const a1 = getCellValue(sheet.getRow(r).getCell(1)) ?? sheet.getRow(r).getCell(1).value;
      const str = a1 != null ? String(a1).trim() : '';
      if (str === 'Total' || str === 'Round Total') break;
      if (str !== '') lastPlayerRow = r;
    }
    const roundColIndicesForRefresh = [];
    for (let c = 1; c <= 100; c++) {
      const val = getCellValue(headerRow.getCell(c)) ?? headerRow.getCell(c).value;
      const str = val != null ? String(val).trim() : '';
      const idx = ROUND_LABELS.indexOf(str);
      if (idx !== -1) roundColIndicesForRefresh.push({ col: c, roundIndex: idx });
      if (str === '' && roundColIndicesForRefresh.length > 0) break;
    }
    const groupPlayersListForRefresh = playersByGroup[sheetName] || [];
    const nameToCodeMapForRefresh = {};
    for (const p of groupPlayersListForRefresh) {
      const name = (typeof p === 'string' ? p : p.name) || '';
      nameToCodeMapForRefresh[name.trim()] = typeof p === 'string' ? '' : (p.countryCode || '');
      const sub = (GROUP_SUBSTITUTIONS[sheetName] || {})[name];
      if (sub) nameToCodeMapForRefresh[sub] = typeof p === 'string' ? '' : (p.countryCode || '');
    }
    for (let r = 2; r <= lastPlayerRow; r++) {
      const a1 = getCellValue(sheet.getRow(r).getCell(1)) ?? sheet.getRow(r).getCell(1).value;
      const displayName = a1 != null ? String(a1).trim() : '';
      if (!displayName) continue;
      const lookupName = (GROUP_SUBSTITUTIONS[sheetName] || {})[displayName] || displayName;
      const countryCode = nameToCodeMapForRefresh[displayName] ?? nameToCodeMapForRefresh[lookupName] ?? '';
      for (const { col, roundIndex } of roundColIndicesForRefresh) {
        const storedRound = roundIndex + 1;
        const pts = pointsByAuctionPlayerRound[lookupName]
          ? pointsByAuctionPlayerRound[lookupName][storedRound]
          : undefined;
        sheet.getRow(r).getCell(col).value = pts !== undefined ? pts : '';
      }
    }

    if (schedule.length > 0) {
      const roundColIndices = [];
      for (let c = 1; c <= 100; c++) {
        const val = getCellValue(headerRow.getCell(c)) ?? headerRow.getCell(c).value;
        const str = val != null ? String(val).trim() : '';
        const idx = ROUND_LABELS.indexOf(str);
        if (idx !== -1) roundColIndices.push({ col: c, roundIndex: idx });
        if (str === '' && roundColIndices.length > 0) break;
      }
      const hasOpponentCol = (c) => {
        const val = getCellValue(headerRow.getCell(c)) ?? headerRow.getCell(c).value;
        const s = val != null ? String(val).trim() : '';
        return OPPONENT_HEADERS.some((h) => h === s);
      };
      const groupPlayersList = playersByGroup[sheetName] || [];
      const nameToCodeMap = {};
      for (const p of groupPlayersList) {
        const name = (typeof p === 'string' ? p : p.name) || '';
        nameToCodeMap[name.trim()] = typeof p === 'string' ? '' : (p.countryCode || '');
        if ((GROUP_SUBSTITUTIONS[sheetName] || {})[name]) nameToCodeMap[(GROUP_SUBSTITUTIONS[sheetName] || {})[name]] = typeof p === 'string' ? '' : (p.countryCode || '');
      }
      const insertAfter = roundColIndices.filter(({ col }) => !hasOpponentCol(col + 1));
      for (let i = insertAfter.length - 1; i >= 0; i--) {
        const { col, roundIndex } = insertAfter[i];
        const oppHeader = OPPONENT_HEADERS[roundIndex];
        const oppCol = [oppHeader];
        for (let r = 2; r <= sheetRowCount; r++) {
          const a1 = getCellValue(sheet.getRow(r).getCell(1)) ?? sheet.getRow(r).getCell(1).value;
          const name = a1 != null ? String(a1).trim() : '';
          const code = nameToCodeMap[name] || '';
          const countryName = CODE_TO_COUNTRY[code] || code;
          const rounds = teamMatchesByRound[countryName] || [];
          const opp = rounds[roundIndex] ? rounds[roundIndex].opponent : '';
          oppCol.push(r <= lastPlayerRow && name ? opp : (r > lastPlayerRow ? null : ''));
        }
        while (oppCol.length <= sheetRowCount) oppCol.push(null);
        sheet.spliceColumns(col + 1, 0, oppCol);
      }
    }

    const existingRoundLabels = new Set();
    let lastRoundCol = 0;
    for (let c = 1; c <= 100; c++) {
      const val = getCellValue(headerRow.getCell(c)) ?? headerRow.getCell(c).value;
      const str = val != null ? String(val).trim() : '';
      if (str === '' && existingRoundLabels.size > 0) break;
      if (ROUND_LABELS.includes(str)) {
        existingRoundLabels.add(str);
        lastRoundCol = c;
      }
    }
    if (existingRoundLabels.size >= NUM_ROUNDS) continue;

    const missingLabels = ROUND_LABELS.filter((l) => !existingRoundLabels.has(l));
    if (missingLabels.length === 0) continue;

    if (lastRoundCol === 0) lastRoundCol = 1;

    let lastDataRow = 1;
    let totalRowNum = 0;
    let roundTotalRowNum = 0;
    const rowCount = sheet.rowCount || 0;
    for (let r = 2; r <= rowCount; r++) {
      const a1 = getCellValue(sheet.getRow(r).getCell(1)) ?? sheet.getRow(r).getCell(1).value;
      const str = a1 != null ? String(a1).trim() : '';
      if (str === 'Total') totalRowNum = r;
      if (str === 'Round Total') roundTotalRowNum = r;
      if (str !== '' && str !== 'Total' && str !== 'Round Total') lastDataRow = r;
    }

    let insertAt = lastRoundCol + 1;
    for (const label of missingLabels) {
      const playingXiCol = [];
      const roundCol = [];
      for (let row = 1; row <= rowCount; row++) {
        if (row === 1) {
          playingXiCol.push('Playing XI');
          roundCol.push(label);
        } else if (row >= 2 && row <= lastDataRow) {
          playingXiCol.push(0);
          roundCol.push('');
        } else {
          playingXiCol.push(null);
          roundCol.push(null);
        }
      }
      while (playingXiCol.length < rowCount) playingXiCol.push(null);
      while (roundCol.length < rowCount) roundCol.push(null);
      sheet.spliceColumns(insertAt, 0, playingXiCol, roundCol);
      if (totalRowNum > 0) {
        const xiLetter = columnLetter(insertAt);
        const roundLetter = columnLetter(insertAt + 1);
        sheet.getRow(totalRowNum).getCell(insertAt).value = {
          formula: `COUNTIF(${xiLetter}2:${xiLetter}${lastDataRow},1)+COUNTIF(${xiLetter}2:${xiLetter}${lastDataRow},2)`,
        };
        sheet.getRow(totalRowNum).getCell(insertAt).font = { bold: true };
        sheet.getRow(totalRowNum).getCell(insertAt + 1).value = { formula: `SUM(${roundLetter}2:${roundLetter}${lastDataRow})` };
        sheet.getRow(totalRowNum).getCell(insertAt + 1).font = { bold: true };
      }
      if (roundTotalRowNum > 0) {
        const xiLetter = columnLetter(insertAt);
        const roundLetter = columnLetter(insertAt + 1);
        sheet.getRow(roundTotalRowNum).getCell(insertAt).value = '';
        sheet.getRow(roundTotalRowNum).getCell(insertAt + 1).value = {
          formula: `SUMPRODUCT(${xiLetter}2:${xiLetter}${lastDataRow},${roundLetter}2:${roundLetter}${lastDataRow})`,
        };
        sheet.getRow(roundTotalRowNum).getCell(insertAt + 1).font = { bold: true };
      }
      insertAt += 2;
    }
  }

  await targetWb.xlsx.writeFile(OUTPUT_PATH);
  console.log('Written to', OUTPUT_PATH, '(main file', FANTASY_PATH, 'was NOT modified)');

  if (unmatchedFantasy.length > 0 || unmatchedAuction.length > 0) {
    console.log('\n--- Name matching report ---');
    const fantasyByCountry = {};
    for (const r of unmatchedFantasy) {
      const k = r.country || '(no country)';
      if (!fantasyByCountry[k]) fantasyByCountry[k] = [];
      if (!fantasyByCountry[k].includes(r.playerName)) fantasyByCountry[k].push(r.playerName);
    }
    if (Object.keys(fantasyByCountry).length > 0) {
      console.log('\nFantasy names with points but no auction match (country | name):');
      for (const [country, names] of Object.entries(fantasyByCountry)) {
        for (const n of names.sort()) console.log('  ', country, '|', n);
      }
    }
    const auctionByCountry = {};
    for (const ap of unmatchedAuction) {
      const k = ap.countryCode || '(no code)';
      if (!auctionByCountry[k]) auctionByCountry[k] = [];
      auctionByCountry[k].push(ap.name);
    }
    if (Object.keys(auctionByCountry).length > 0) {
      console.log('\nAuction names with no points matched (countryCode | name):');
      for (const [code, names] of Object.entries(auctionByCountry)) {
        for (const n of names.sort()) console.log('  ', code, '|', n);
      }
    }
    console.log('\nAdd any fantasy->auction mappings to FANTASY_TO_AUCTION_OVERRIDES in add-group-sheets.js to fix.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
