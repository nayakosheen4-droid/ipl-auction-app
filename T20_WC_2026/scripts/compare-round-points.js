#!/usr/bin/env node
/**
 * Compare player points per round between:
 * - Fantasy_Points_T20WC_2025_26_from_api.xlsx (Fantasy Points sheet)
 * - ICC T20 WC 2026 Auction Game.xlsx (Player Points NEW sheet)
 * Outputs all differences (player, round, auction pts, fantasy pts, diff).
 */

const path = require('path');
const ExcelJS = require('exceljs');

const FANTASY_PATH = path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26_from_api.xlsx');
const AUCTION_PATH = path.join(__dirname, '..', 'ICC T20 WC 2026 Auction Game.xlsx');

const COUNTRY_TO_CODE = {
  Australia: 'AUS', England: 'ENG', India: 'IND', 'New Zealand': 'NZ',
  'West Indies': 'WI', 'South Africa': 'SA', Pakistan: 'PAK', 'Sri Lanka': 'SL',
  Afghanistan: 'AFG', Bangladesh: 'BAN', Zimbabwe: 'ZIM',
  'United Arab Emirates': 'UAE', Scotland: 'SCO', Ireland: 'IRE',
  Netherlands: 'NED', Canada: 'CAN', 'United States of America': 'USA',
  Namibia: 'NAM', Nepal: 'NEP', Oman: 'OMN', Italy: 'ITA',
};

// Auction name -> Fantasy name (when they differ)
const AUCTION_TO_FANTASY_NAME = {
  'Hardik Pandya': 'HH Pandya',
  'Kusal Mendis': 'BKG Mendis',
  'Dushmantha Chameera': 'PVD Chameera',
  'Kamindu Mendis': 'PHKD Mendis',
  'Wanindu Hasaranga': 'PWH de Silva',
  'Dilshan Madhushanka': 'Dilshan Madushanka',
  'Salman Agha': 'Agha Salman',
  'Quinton de Kock': 'Q de Kock',
  'Varun Chakaravarthy': 'CV Varun',
  'James Neesham': 'JDS Neesham',
};

function normalizeName(n) {
  return (n || '').toString().trim();
}

function getColIndex(sheet, headerName) {
  const row1 = sheet.getRow(1);
  for (let c = 1; c <= (sheet.columnCount || 50); c++) {
    const v = (row1.getCell(c).value || '').toString().trim().toLowerCase();
    if (v === headerName.toLowerCase()) return c;
  }
  return -1;
}

async function loadFantasyByPlayerRound() {
  const wb = await new ExcelJS.Workbook().xlsx.readFile(FANTASY_PATH);
  const sheet = wb.getWorksheet('Fantasy Points');
  if (!sheet) return new Map();
  const nameCol = getColIndex(sheet, 'Player Name') || 1;
  const countryCol = getColIndex(sheet, 'Country') || 2;
  const roundCol = getColIndex(sheet, 'Round') || 5;
  const ptsCol = getColIndex(sheet, 'Fantasy Points') || 6;
  const map = new Map();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = normalizeName(row.getCell(nameCol).value);
    const country = normalizeName(row.getCell(countryCol).value);
    const round = row.getCell(roundCol).value;
    const pts = row.getCell(ptsCol).value;
    if (!name || round == null) return;
    const code = COUNTRY_TO_CODE[country] || country;
    const roundNum = typeof round === 'number' ? round : parseInt(round, 10);
    if (isNaN(roundNum)) return;
    const key = `${name}|${code}|${roundNum}`;
    map.set(key, { name, code, round: roundNum, pts: pts != null ? Number(pts) : NaN });
  });
  return map;
}

async function loadAuctionByPlayerRound() {
  const wb = await new ExcelJS.Workbook().xlsx.readFile(AUCTION_PATH);
  const sheet = wb.getWorksheet('Player Points NEW');
  if (!sheet) return new Map();
  const roundCol = getColIndex(sheet, 'round');
  const nameCol = getColIndex(sheet, 'player_name');
  const codeCol = getColIndex(sheet, 'team_code');
  const ptsCol = getColIndex(sheet, 'fantasy_points_final');
  const countCol = getColIndex(sheet, 'counted_points');
  if ([roundCol, nameCol, codeCol].some(c => c <= 0)) {
    console.error('Missing columns in Player Points NEW');
    return new Map();
  }
  const usePts = ptsCol > 0 ? ptsCol : countCol;
  const map = new Map();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = normalizeName(row.getCell(nameCol).value);
    const code = normalizeName(row.getCell(codeCol).value);
    const round = row.getCell(roundCol).value;
    const pts = usePts > 0 ? row.getCell(usePts).value : null;
    if (!name || !code || round == null) return;
    const roundNum = typeof round === 'number' ? round : parseInt(round, 10);
    if (isNaN(roundNum)) return;
    const key = `${name}|${code}|${roundNum}`;
    if (!map.has(key)) map.set(key, { name, code, round: roundNum, pts: pts != null ? Number(pts) : NaN });
  });
  return map;
}

function lookupFantasyPoints(fantasyMap, auctionName, code, round) {
  const k1 = `${auctionName}|${code}|${round}`;
  let v = fantasyMap.get(k1);
  if (v != null) return v.pts;
  const fantasyName = AUCTION_TO_FANTASY_NAME[auctionName];
  if (fantasyName) {
    const k2 = `${fantasyName}|${code}|${round}`;
    v = fantasyMap.get(k2);
    if (v != null) return v.pts;
  }
  return undefined;
}

async function main() {
  const fantasyMap = await loadFantasyByPlayerRound();
  const auctionMap = await loadAuctionByPlayerRound();
  const differences = [];
  const onlyInAuction = [];
  const onlyInFantasy = new Set();
  for (const [key, a] of auctionMap) {
    const ptsFantasy = lookupFantasyPoints(fantasyMap, a.name, a.code, a.round);
    if (ptsFantasy === undefined) {
      onlyInAuction.push({ ...a, auctionPts: a.pts });
      continue;
    }
    const auctionPts = Number(a.pts);
    const fantasyPts = Number(ptsFantasy);
    if (isNaN(auctionPts) && isNaN(fantasyPts)) continue;
    if (Math.abs((auctionPts || 0) - (fantasyPts || 0)) > 0.01) {
      differences.push({
        player: a.name,
        code: a.code,
        round: a.round,
        auctionPts: isNaN(auctionPts) ? '' : auctionPts,
        fantasyPts: isNaN(fantasyPts) ? '' : fantasyPts,
        diff: (fantasyPts || 0) - (auctionPts || 0),
      });
    }
  }
  const auctionKeys = new Set();
  auctionMap.forEach((a, key) => {
    auctionKeys.add(key);
    const fantasyAlias = AUCTION_TO_FANTASY_NAME[a.name];
    if (fantasyAlias) auctionKeys.add(`${fantasyAlias}|${a.code}|${a.round}`);
  });
  fantasyMap.forEach((v, key) => {
    if (!auctionKeys.has(key)) onlyInFantasy.add(`${key}|${v.pts}`);
  });

  console.log('=== POINTS COMPARISON: Auction (Player Points NEW) vs Fantasy (from_api) ===\n');
  console.log('--- DIFFERENCES (same player & round, different points) ---\n');
  if (differences.length === 0) {
    console.log('None.\n');
  } else {
    differences.sort((a, b) => a.round - b.round || a.code.localeCompare(b.code) || a.player.localeCompare(b.player));
    differences.forEach((d) => {
      console.log(`  ${d.player} (${d.code}) Round ${d.round}:  Auction=${d.auctionPts}  Fantasy=${d.fantasyPts}  (diff ${d.diff >= 0 ? '+' : ''}${d.diff})`);
    });
    console.log('\nTotal differences:', differences.length);
  }

  console.log('\n--- ONLY IN AUCTION (player+round in Auction sheet but no match in Fantasy) ---\n');
  if (onlyInAuction.length === 0) {
    console.log('None.\n');
  } else {
    onlyInAuction.slice(0, 30).forEach((a) => console.log(`  ${a.name} (${a.code}) Round ${a.round}  pts=${a.auctionPts}`));
    if (onlyInAuction.length > 30) console.log('  ... and', onlyInAuction.length - 30, 'more');
    console.log('\nTotal only in Auction:', onlyInAuction.length);
  }

  console.log('\n--- ONLY IN FANTASY (player+round in Fantasy sheet but no match in Auction) ---\n');
  const onlyFantasyArr = [...onlyInFantasy].sort().slice(0, 40);
  if (onlyFantasyArr.length === 0) {
    console.log('None.\n');
  } else {
    onlyFantasyArr.forEach((s) => {
      const parts = s.split('|');
      const pts = parts.pop();
      const round = parts.pop();
      const code = parts.pop();
      const name = parts.join('|');
      console.log(`  ${name} (${code}) Round ${round}  pts=${pts}`);
    });
    if (onlyInFantasy.size > 40) console.log('  ... and', onlyInFantasy.size - 40, 'more');
    console.log('\nTotal only in Fantasy:', onlyInFantasy.size);
  }

  const fs = require('fs');
  const reportPath = path.join(__dirname, '..', 'round-points-comparison-report.txt');
  const diffLines = differences.map((d) =>
    `  ${d.player} (${d.code}) Round ${d.round}:  Auction=${d.auctionPts}  Fantasy=${d.fantasyPts}  (diff ${d.diff >= 0 ? '+' : ''}${d.diff})`
  );
  const onlyFLines = [...onlyInFantasy].sort().map((s) => {
    const parts = s.split('|');
    const pts = parts.pop();
    const round = parts.pop();
    const code = parts.pop();
    const name = parts.join('|');
    return `  ${name} (${code}) Round ${round}  pts=${pts}`;
  });
  const report = [
    '=== POINTS COMPARISON: Auction (Player Points NEW) vs Fantasy (from_api) ===',
    '',
    '--- DIFFERENCES (same player & round, different points) ---',
    '',
    ...(diffLines.length ? diffLines : ['None.']),
    '',
    `Total differences: ${differences.length}`,
    '',
    '--- ONLY IN AUCTION ---',
    '',
    ...onlyInAuction.map((a) => `  ${a.name} (${a.code}) Round ${a.round}  pts=${a.auctionPts}`),
    '',
    `Total only in Auction: ${onlyInAuction.length}`,
    '',
    '--- ONLY IN FANTASY ---',
    '',
    ...onlyFLines.slice(0, 500),
    onlyInFantasy.size > 500 ? `  ... and ${onlyInFantasy.size - 500} more` : '',
    '',
    `Total only in Fantasy: ${onlyInFantasy.size}`,
  ].join('\n');
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log('\nFull report written to:', reportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
