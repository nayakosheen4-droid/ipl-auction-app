#!/usr/bin/env node
/**
 * Adds a "Playing XI" column before each Round column in every Group 1–8 sheet.
 * Playing XI values: 0 = not in playing 11, 1 = in playing 11, 2 = captain.
 * Does not remove or overwrite existing data; only inserts new columns (default 0).
 * Run on the workbook that contains the group sheets (e.g. Fantasy_Points_T20WC_2025_26.xlsx).
 */

const path = require('path');
const ExcelJS = require('exceljs');

const WORKBOOK_PATH = path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26.xlsx');

function getCellValue(cell) {
  if (!cell || !cell.value) return null;
  const v = cell.value;
  if (typeof v === 'object' && v !== null && 'result' in v) return v.result;
  return v;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK_PATH);

  for (let g = 1; g <= 8; g++) {
    const sheetName = `Group ${g}`;
    const sheet = wb.getWorksheet(sheetName);
    if (!sheet) continue;

    const headerRow = sheet.getRow(1);
    const roundColIndices = [];
    for (let c = 1; c <= 50; c++) {
      const val = getCellValue(headerRow.getCell(c)) ?? headerRow.getCell(c).value;
      const str = val != null ? String(val).trim() : '';
      if (str.match(/^Round\d+$/)) roundColIndices.push(c);
      if (str === '' && roundColIndices.length > 0) break;
    }
    if (roundColIndices.length === 0) continue;

    const rowCount = sheet.rowCount || 0;
    if (rowCount < 1) continue;

    const hasPlayingXiBeforeRound = (() => {
      const firstRoundCol = roundColIndices[0];
      if (firstRoundCol <= 1) return true;
      const prevHeader = getCellValue(headerRow.getCell(firstRoundCol - 1)) ?? headerRow.getCell(firstRoundCol - 1).value;
      return prevHeader != null && String(prevHeader).trim().toLowerCase().includes('playing');
    })();
    if (hasPlayingXiBeforeRound) continue;

    const columnValues = [];
    columnValues[0] = 'Playing XI';
    for (let r = 2; r <= rowCount; r++) columnValues[r - 1] = 0;

    for (let i = roundColIndices.length - 1; i >= 0; i--) {
      const insertAt = roundColIndices[i];
      sheet.spliceColumns(insertAt, 0, columnValues);
    }
  }

  await wb.xlsx.writeFile(WORKBOOK_PATH);
  console.log('Added Playing XI column before each Round in Group 1–8. File:', WORKBOOK_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
