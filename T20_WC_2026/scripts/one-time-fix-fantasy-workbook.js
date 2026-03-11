#!/usr/bin/env node
/**
 * One-time fix for Fantasy_Points_T20WC_2025_26_from_api.xlsx:
 * 1. Fill empty Country cells in Fantasy Points sheet (from same player in other rows).
 * 2. Remove the "Matches" column from each Group 1-8 sheet (round-wise opponents already present).
 * Run once: node scripts/one-time-fix-fantasy-workbook.js
 */

const path = require('path');
const ExcelJS = require('exceljs');

const WORKBOOK_PATH = process.env.FANTASY_WORKBOOK_PATH || path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26_from_api.xlsx');

function getCellValue(cell) {
  if (!cell || cell.value === undefined) return null;
  const v = cell.value;
  if (typeof v === 'object' && v !== null && 'result' in v) return v.result;
  if (typeof v === 'object' && v !== null && 'richText' in v) return v.richText.map((t) => t.text).join('');
  return v;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK_PATH);

  const fantasySheet = wb.getWorksheet('Fantasy Points');
  if (fantasySheet) {
    const rowCount = fantasySheet.rowCount || 0;
    const playerToCountry = {};
    for (let r = 2; r <= rowCount; r++) {
      const row = fantasySheet.getRow(r);
      const player = getCellValue(row.getCell(1));
      const country = getCellValue(row.getCell(2));
      if (player != null && country != null && String(country).trim() !== '') {
        const key = String(player).trim();
        if (!playerToCountry[key]) playerToCountry[key] = String(country).trim();
      }
    }
    let filledFromPlayer = 0;
    for (let r = 2; r <= rowCount; r++) {
      const row = fantasySheet.getRow(r);
      const countryCell = row.getCell(2);
      const country = getCellValue(countryCell);
      if (country == null || String(country).trim() === '') {
        const player = getCellValue(row.getCell(1));
        if (player != null && playerToCountry[String(player).trim()]) {
          countryCell.value = playerToCountry[String(player).trim()];
          filledFromPlayer++;
        }
      }
    }

    function parseTeamsFromMatchName(matchName) {
      if (matchName == null) return [];
      const s = String(matchName).trim();
      const vs = s.indexOf(' vs ');
      if (vs === -1) return [];
      const team1 = s.slice(0, vs).trim();
      const rest = s.slice(vs + 4).trim();
      const comma = rest.indexOf(',');
      const team2 = comma === -1 ? rest : rest.slice(0, comma).trim();
      if (team1 && team2) return [team1, team2];
      return [];
    }

    const matchNameToRows = {};
    for (let r = 2; r <= rowCount; r++) {
      const row = fantasySheet.getRow(r);
      const matchName = getCellValue(row.getCell(3));
      if (matchName == null) continue;
      const key = String(matchName).trim();
      if (!matchNameToRows[key]) matchNameToRows[key] = [];
      matchNameToRows[key].push(r);
    }

    let filledFromMatch = 0;
    for (const [matchName, rows] of Object.entries(matchNameToRows)) {
      const teams = parseTeamsFromMatchName(matchName);
      if (teams.length !== 2) continue;
      const countriesPresent = new Set();
      for (const r of rows) {
        const country = getCellValue(fantasySheet.getRow(r).getCell(2));
        if (country != null && String(country).trim() !== '') countriesPresent.add(String(country).trim());
      }
      const missing = teams.find((t) => !countriesPresent.has(t));
      if (!missing) continue;
      for (const r of rows) {
        const row = fantasySheet.getRow(r);
        const country = getCellValue(row.getCell(2));
        if (country == null || String(country).trim() === '') {
          row.getCell(2).value = missing;
          filledFromMatch++;
        }
      }
    }
    console.log('Fantasy Points: filled', filledFromPlayer, 'from same player,', filledFromMatch, 'from match name (other team).');
  }

  for (let g = 1; g <= 8; g++) {
    const sheet = wb.getWorksheet(`Group ${g}`);
    if (!sheet) continue;
    const headerRow = sheet.getRow(1);
    let matchesCol = 0;
    for (let c = 1; c <= 50; c++) {
      const val = getCellValue(headerRow.getCell(c)) ?? headerRow.getCell(c).value;
      const str = val != null ? String(val).trim() : '';
      if (str.toLowerCase() === 'matches') {
        matchesCol = c;
        break;
      }
      if (str === '' && c > 1) break;
    }
    if (matchesCol > 0) {
      sheet.spliceColumns(matchesCol, 1);
      console.log('Group', g, ': removed Matches column.');
    }
  }

  await wb.xlsx.writeFile(WORKBOOK_PATH);
  console.log('Saved:', WORKBOOK_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
