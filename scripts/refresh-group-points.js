#!/usr/bin/env node
/**
 * Updates only the Round point columns in Group 1–8 sheets from the Fantasy Points sheet.
 * Does not change player names, Playing XI columns, or Total/Round Total rows.
 * Run after build-fantasy-excel.js when you have new JSON and want to refresh points
 * without losing your manual Playing XI or sheet structure.
 */

const path = require('path');
const ExcelJS = require('exceljs');

const FANTASY_PATH = path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26.xlsx');
const AUCTION_PATH = path.join(__dirname, '..', 'ICC T20 WC 2026 Auction Game.xlsx');

const COUNTRY_TO_CODE = {
  Australia: 'AUS', England: 'ENG', India: 'IND', 'New Zealand': 'NZ', 'West Indies': 'WI',
  'South Africa': 'SA', Pakistan: 'PAK', 'Sri Lanka': 'SL', Afghanistan: 'AFG', Bangladesh: 'BAN',
  Zimbabwe: 'ZIM', 'United Arab Emirates': 'UAE', Scotland: 'SCO', Ireland: 'IRE', Netherlands: 'NED',
  Canada: 'CAN', 'United States of America': 'USA', Namibia: 'NAM', Nepal: 'NEP', Oman: 'OMA', Italy: 'ITA',
};

const FANTASY_TO_AUCTION_OVERRIDES = {
  SL: { 'BKG Mendis': 'Kusal Mendis', 'PVD Chameera': 'Dushmantha Chameera', 'PHKD Mendis': 'Kamindu Mendis', 'PWH de Silva': 'Wanindu Hasaranga' },
  PAK: { 'Agha Salman': 'Salman Agha' },
  SA: { 'Q de Kock': 'Quinton de Kock' },
  IND: { 'CV Varun': 'Varun Chakaravarthy' },
  NZ: { 'JDS Neesham': 'James Neesham' },
};

const GROUP_SUBSTITUTIONS = {
  'Group 5': { 'Harshit Rana': 'Mohammed Siraj' },
};

function getCellValue(cell) {
  if (!cell || !cell.value) return null;
  const v = cell.value;
  if (typeof v === 'object' && v !== null && 'result' in v) return v.result;
  if (typeof v === 'object' && v !== null && 'richText' in v) return v.richText.map((t) => t.text).join('');
  return v;
}

function normalize(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}
function surname(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1].toLowerCase() : '';
}
function firstPart(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length <= 1 ? '' : parts.slice(0, -1).join(' ').trim();
}
function firstName(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[0].toLowerCase() : '';
}

function loadFantasyRows(workbook) {
  const sheet = workbook.getWorksheet('Fantasy Points');
  if (!sheet) return [];
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const playerName = getCellValue(row.getCell(1));
    const country = getCellValue(row.getCell(2));
    const round = getCellValue(row.getCell(5));
    const points = getCellValue(row.getCell(6));
    if (playerName == null || round == null) return;
    const roundNum = typeof round === 'number' ? round : parseInt(round, 10);
    if (isNaN(roundNum)) return;
    rows.push({
      playerName: String(playerName).trim(),
      country: country != null ? String(country).trim() : '',
      roundNumber: roundNum,
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
        groups[`Group ${g}`].push({ name: String(name).trim(), countryCode: code ? String(code).trim() : '' });
      }
    }
  }
  return groups;
}

function findAllAuctionPlayersWithCountry(playersByGroup) {
  const list = [];
  for (const players of Object.values(playersByGroup)) {
    for (const p of players) list.push({ name: p.name, countryCode: p.countryCode });
  }
  const subs = new Set();
  for (const s of Object.values(GROUP_SUBSTITUTIONS)) for (const v of Object.values(s)) subs.add(v);
  for (const rep of subs) {
    if (!list.some((ap) => ap.name === rep)) list.push({ name: rep, countryCode: rep === 'Mohammed Siraj' ? 'IND' : '' });
  }
  return list;
}

async function main() {
  const auctionWb = new ExcelJS.Workbook();
  await auctionWb.xlsx.readFile(AUCTION_PATH);
  const playersByGroup = loadAuctionPlayersByGroup(auctionWb);

  const fantasyWb = new ExcelJS.Workbook();
  await fantasyWb.xlsx.readFile(FANTASY_PATH);
  const fantasyRows = loadFantasyRows(fantasyWb);

  const auctionList = findAllAuctionPlayersWithCountry(playersByGroup);
  const pointsByAuctionPlayerRound = {};

  for (const row of fantasyRows) {
    const fantasyCountryCode = COUNTRY_TO_CODE[row.country] || '';
    let best = null;
    const overrides = FANTASY_TO_AUCTION_OVERRIDES[fantasyCountryCode];
    if (overrides && overrides[row.playerName]) {
      const o = overrides[row.playerName];
      if (auctionList.some((a) => a.name === o && (!fantasyCountryCode || a.countryCode === fantasyCountryCode))) best = o;
    }
    if (!best) {
      for (const ap of auctionList) {
        if (ap.countryCode && fantasyCountryCode && ap.countryCode !== fantasyCountryCode) continue;
        const aNorm = normalize(ap.name);
        const fNorm = normalize(row.playerName);
        if (aNorm === fNorm) { best = ap.name; break; }
        if (surname(row.playerName) !== surname(ap.name)) continue;
        const fFirst = firstPart(row.playerName);
        const aFirst = firstName(ap.name);
        if (!fFirst) { best = best || ap.name; continue; }
        if (fFirst.length <= 2 && aFirst && fFirst.includes(aFirst[0])) { best = ap.name; break; }
        const fFirstLow = fFirst.toLowerCase();
        if (fFirst.length > 2 && (aFirst.startsWith(fFirstLow) || fFirstLow.startsWith(aFirst))) { best = ap.name; break; }
      }
    }
    if (best) {
      if (!pointsByAuctionPlayerRound[best]) pointsByAuctionPlayerRound[best] = {};
      pointsByAuctionPlayerRound[best][row.roundNumber] = row.fantasyPoints;
    }
  }

  const displayToLookup = {};
  for (const [sheetName, players] of Object.entries(playersByGroup)) {
    const subs = GROUP_SUBSTITUTIONS[sheetName] || {};
    for (const p of players) {
      const displayName = subs[p.name] || p.name;
      displayToLookup[sheetName] = displayToLookup[sheetName] || {};
      displayToLookup[sheetName][displayName] = { lookupName: displayName, countryCode: p.countryCode };
    }
  }

  for (let g = 1; g <= 8; g++) {
    const sheetName = `Group ${g}`;
    const sheet = fantasyWb.getWorksheet(sheetName);
    if (!sheet) continue;

    const headerRow = sheet.getRow(1);
    const roundCols = [];
    for (let c = 1; c <= 50; c++) {
      const val = getCellValue(headerRow.getCell(c)) ?? headerRow.getCell(c).value;
      const str = val != null ? String(val).trim() : '';
      if (str.match(/^Round\d+$/)) roundCols.push({ col: c, roundNum: parseInt(str.replace('Round', ''), 10) });
      else if (str === 'Semi-Final') roundCols.push({ col: c, roundNum: 8 });
      else if (str === 'Final') roundCols.push({ col: c, roundNum: 9 });
      if (str === '' && roundCols.length > 0) break;
    }
    if (roundCols.length === 0) continue;

    let lastDataRow = 1;
    for (let r = 2; r <= (sheet.rowCount || 0); r++) {
      const a1 = getCellValue(sheet.getRow(r).getCell(1)) ?? sheet.getRow(r).getCell(1).value;
      const str = a1 != null ? String(a1).trim() : '';
      if (str === 'Total' || str === 'Round Total') break;
      if (str !== '') lastDataRow = r;
    }
    if (lastDataRow < 2) continue;

    const groupMap = displayToLookup[sheetName] || {};
    for (let r = 2; r <= lastDataRow; r++) {
      const row = sheet.getRow(r);
      const displayName = String(getCellValue(row.getCell(1)) ?? row.getCell(1).value ?? '').trim();
      const info = groupMap[displayName];
      if (!info) continue;
      const { lookupName, countryCode } = info;
      const isNZ = countryCode === 'NZ';

      for (const { col, roundNum } of roundCols) {
        const storedRound = isNZ ? (roundNum === 1 ? null : roundNum - 1) : roundNum;
        const pts = storedRound != null && pointsByAuctionPlayerRound[lookupName] && pointsByAuctionPlayerRound[lookupName][storedRound] !== undefined
          ? pointsByAuctionPlayerRound[lookupName][storedRound]
          : '';
        row.getCell(col).value = pts;
      }
    }
  }

  await fantasyWb.xlsx.writeFile(FANTASY_PATH);
  console.log('Refreshed Round points in Group 1–8 from Fantasy Points. Saved:', FANTASY_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
