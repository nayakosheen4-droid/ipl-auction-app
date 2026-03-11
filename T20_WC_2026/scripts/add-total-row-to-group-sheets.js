#!/usr/bin/env node
/**
 * Adds "Total" and "Round Total" rows to each Group 1–8 sheet.
 * Total: raw sum of points in each Round column.
 * Round Total: weighted sum (Playing XI 0→0, 1→points, 2→2×points) via SUMPRODUCT.
 * In the Total row, each Playing XI column shows count of 1s and 2s (number of players in XI).
 * Run this script on the workbook that already contains the group sheets.
 */

const path = require('path');
const ExcelJS = require('exceljs');

const WORKBOOK_PATH = process.env.FANTASY_WORKBOOK_PATH || path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26.xlsx');

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
    let colCount = 0;
    const roundColIndices = [];
    for (let c = 1; c <= 50; c++) {
      const val = getCellValue(headerRow.getCell(c)) ?? headerRow.getCell(c).value;
      if (val == null && colCount > 0) break;
      if (val != null) {
        colCount = c;
        const str = String(val).trim();
        if (str.match(/^Round\d+$/) || str === 'Semi-Final' || str === 'Final') roundColIndices.push(c);
      }
    }
    if (colCount < 2 || roundColIndices.length === 0) continue;

    const rowCount = sheet.rowCount || 0;
    if (rowCount < 2) continue;

    // Find last row that has a player name (so Total and Round Total sit right below the list)
    let lastDataRow = 1;
    for (let r = 2; r <= rowCount; r++) {
      const row = sheet.getRow(r);
      const a1 = getCellValue(row.getCell(1)) ?? row.getCell(1).value;
      const str = a1 != null ? String(a1).trim() : '';
      if (str === 'Total' || str === 'Round Total') break;
      if (str !== '') lastDataRow = r;
    }
    if (lastDataRow < 2) continue;

    const totalRowNum = lastDataRow + 1;
    const roundTotalRowNum = lastDataRow + 2;
    const firstDataRow = 2;

    const playingXiColIndices = roundColIndices.map((rc) => rc - 1);

    const totalRow = sheet.getRow(totalRowNum);
    totalRow.getCell(1).value = 'Total';
    totalRow.getCell(1).font = { bold: true };
    for (let c = 2; c <= colCount; c++) {
      const cell = totalRow.getCell(c);
      const colLetter = columnLetter(c);
      if (roundColIndices.includes(c)) {
        cell.value = { formula: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})` };
        cell.font = { bold: true };
      } else if (playingXiColIndices.includes(c)) {
        cell.value = {
          formula: `COUNTIF(${colLetter}${firstDataRow}:${colLetter}${lastDataRow},1)+COUNTIF(${colLetter}${firstDataRow}:${colLetter}${lastDataRow},2)`,
        };
        cell.font = { bold: true };
      } else {
        cell.value = '';
      }
    }

    const roundTotalRow = sheet.getRow(roundTotalRowNum);
    roundTotalRow.getCell(1).value = 'Round Total';
    roundTotalRow.getCell(1).font = { bold: true };
    for (let c = 2; c <= colCount; c++) {
      const cell = roundTotalRow.getCell(c);
      if (roundColIndices.includes(c)) {
        const xiCol = c - 1;
        const xiLetter = columnLetter(xiCol);
        const roundLetter = columnLetter(c);
        cell.value = {
          formula: `SUMPRODUCT(${xiLetter}${firstDataRow}:${xiLetter}${lastDataRow},${roundLetter}${firstDataRow}:${roundLetter}${lastDataRow})`,
        };
        cell.font = { bold: true };
      } else {
        cell.value = '';
      }
    }

    // Clear any old Total/Round Total rows that were left further down the sheet
    for (let r = roundTotalRowNum + 1; r <= rowCount; r++) {
      const row = sheet.getRow(r);
      const a1 = getCellValue(row.getCell(1)) ?? row.getCell(1).value;
      const str = a1 != null ? String(a1).trim() : '';
      if (str === 'Total' || str === 'Round Total') {
        row.eachCell((cell) => { cell.value = null; });
      }
    }
  }

  await wb.xlsx.writeFile(WORKBOOK_PATH);
  console.log('Added Total and Round Total rows to each Group 1–8 sheet in', WORKBOOK_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
