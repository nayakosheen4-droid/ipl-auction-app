#!/usr/bin/env node
/**
 * Reads Fantasy_Points_T20WC_2025_26.xlsx and writes an UPDATED copy to
 * Fantasy_Points_T20WC_2025_26_with_groups.xlsx with the 8 group sheets refreshed.
 * The main workbook is NEVER overwritten (your manual edits are safe).
 * Each group sheet: Player Name (auction), Round1, Round2, ...
 */

const path = require('path');
const ExcelJS = require('exceljs');

const FANTASY_PATH = path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26.xlsx');
const AUCTION_PATH = path.join(__dirname, '..', 'ICC T20 WC 2026 Auction Game.xlsx');
/** Output path: script writes HERE so the main workbook is never overwritten. Copy sheets back to main file if needed. */
const OUTPUT_PATH = path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26_with_groups.xlsx');

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
  },
  NZ: {
    'JDS Neesham': 'James Neesham',
  },
};

/** Group substitutions: injured/replaced player (auction name) -> replacement (display name and points lookup). Only the group sheets use this; key = "Group N", value = { "Auction Name": "Replacement Name" }. */
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
  const auctionWb = new ExcelJS.Workbook();
  await auctionWb.xlsx.readFile(AUCTION_PATH);
  const playersByGroup = loadAuctionPlayersByGroup(auctionWb);

  const fantasyWb = new ExcelJS.Workbook();
  await fantasyWb.xlsx.readFile(FANTASY_PATH);
  const fantasyRows = loadFantasyRows(fantasyWb);

  const maxRound = fantasyRows.length ? Math.max(...fantasyRows.map((r) => r.roundNumber)) : 0;
  const rounds = Array.from({ length: maxRound }, (_, i) => i + 1);

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
  const pointsByAuctionPlayerRound = {};
  const matchedFantasyKeys = new Set();
  const matchedAuctionNames = new Set();

  for (const row of fantasyRows) {
    const fantasyCountryCode = COUNTRY_TO_CODE[row.country] || '';
    let best = null;

    const overridesForCountry = FANTASY_TO_AUCTION_OVERRIDES[fantasyCountryCode];
    if (overridesForCountry && overridesForCountry[row.playerName]) {
      const overrideAuction = overridesForCountry[row.playerName];
      const ap = auctionList.find((a) => a.name === overrideAuction && (!fantasyCountryCode || a.countryCode === fantasyCountryCode));
      if (ap) best = ap.name;
    }

    if (!best) {
      for (const ap of auctionList) {
        if (ap.countryCode && fantasyCountryCode && ap.countryCode !== fantasyCountryCode) continue;
        const aNorm = normalize(ap.name);
        const fNorm = normalize(row.playerName);
        if (aNorm === fNorm) {
          best = ap.name;
          break;
        }
        const fSur = surname(row.playerName);
        const aSur = surname(ap.name);
        if (fSur !== aSur) continue;
        const fFirst = firstPart(row.playerName);
        const aFirst = firstName(ap.name);
        if (!fFirst) {
          best = best || ap.name;
          continue;
        }
        if (fFirst.length <= 2 && aFirst && fFirst.toLowerCase().includes(aFirst[0])) {
          best = ap.name;
          break;
        }
        const fFirstLow = fFirst.toLowerCase();
        if (fFirst.length > 2 && (aFirst.startsWith(fFirstLow) || fFirstLow.startsWith(aFirst))) {
          best = ap.name;
          break;
        }
      }
    }

    if (best) {
      matchedFantasyKeys.add(`${row.country}|${row.playerName}`);
      matchedAuctionNames.add(best);
      if (!pointsByAuctionPlayerRound[best]) pointsByAuctionPlayerRound[best] = {};
      pointsByAuctionPlayerRound[best][row.roundNumber] = row.fantasyPoints;
    }
  }

  const unmatchedFantasy = fantasyRows.filter((r) => !matchedFantasyKeys.has(`${r.country}|${r.playerName}`));
  const unmatchedAuction = auctionList.filter((ap) => !matchedAuctionNames.has(ap.name));

  for (let g = 1; g <= 8; g++) {
    const sheetName = `Group ${g}`;
    let sheet = fantasyWb.getWorksheet(sheetName);
    if (sheet) fantasyWb.removeWorksheet(sheetName);
    sheet = fantasyWb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });

    const headers = ['Player Name', ...rounds.flatMap((r) => ['Playing XI', `Round${r}`])];
    const colDefs = [{ header: 'Player Name', key: 'playerName', width: 22 }];
    for (let r = 1; r <= maxRound; r++) {
      colDefs.push({ header: 'Playing XI', key: `xi${r}`, width: 10 });
      colDefs.push({ header: `Round${r}`, key: `round${r}`, width: 10 });
    }
    sheet.columns = colDefs;
    sheet.getRow(1).font = { bold: true };

    const groupPlayers = playersByGroup[sheetName] || [];
    const subs = GROUP_SUBSTITUTIONS[sheetName] || {};
    for (const player of groupPlayers) {
      const auctionName = typeof player === 'string' ? player : player.name;
      const displayName = subs[auctionName] || auctionName;
      const lookupName = subs[auctionName] || auctionName;
      const countryCode = typeof player === 'string' ? '' : (player.countryCode || '');
      const isNZ = countryCode === 'NZ';
      const rowData = { playerName: displayName };
      for (let r = 1; r <= maxRound; r++) {
        rowData[`xi${r}`] = 0;
        const storedRound = isNZ ? (r === 1 ? null : r - 1) : r;
        const pts = storedRound != null && pointsByAuctionPlayerRound[lookupName]
          ? pointsByAuctionPlayerRound[lookupName][storedRound]
          : undefined;
        rowData[`round${r}`] = pts !== undefined ? pts : '';
      }
      sheet.addRow(rowData);
    }
  }

  await fantasyWb.xlsx.writeFile(OUTPUT_PATH);
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
