#!/usr/bin/env node
/**
 * One-time update: fetch series schedule (1 API call), write schedule.json, add Schedule
 * sheet as first tab to the from_api workbook, then run add-group-sheets and add-total-row
 * so the "Matches" column appears in each Group sheet. Run from project root:
 *   node cricketdata/update-schedule-and-group-columns.js
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');

const { loadConfig, fetchSeriesMatches } = require('./api');
const OUT_PATH = path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26_from_api.xlsx');
const SCHEDULE_JSON_PATH = path.join(__dirname, 'schedule.json');

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
    for (let c = 1; c <= (colCount || 30); c++) {
      const srcCell = srcRow.getCell(c);
      const destCell = destRow.getCell(c);
      if (srcCell.value !== undefined && srcCell.value !== null) destCell.value = srcCell.value;
      if (srcCell.font) destCell.font = srcCell.font;
      if (srcCell.alignment) destCell.alignment = srcCell.alignment;
    }
  }
  if (srcSheet.columns && srcSheet.columns.length) {
    dest.columns = srcSheet.columns.map((col) => ({ header: col.header, key: col.key, width: col.width != null ? col.width : 10 }));
  }
}

async function main() {
  if (!fs.existsSync(OUT_PATH)) {
    console.error('Workbook not found:', OUT_PATH);
    process.exit(1);
  }

  const { seriesId, apiKey, baseUrl } = loadConfig();
  if (!seriesId || !apiKey) {
    console.error('Set CRICKETDATA_API_KEY and CRICKETDATA_SERIES_ID in .env');
    process.exit(1);
  }

  let matchList;
  console.log('Fetching series schedule (1 API call)...');
  try {
    matchList = await fetchSeriesMatches(seriesId, apiKey, baseUrl);
  } catch (e) {
    console.warn('API error (e.g. rate limit):', e.message);
    if (fs.existsSync(SCHEDULE_JSON_PATH)) {
      matchList = JSON.parse(fs.readFileSync(SCHEDULE_JSON_PATH, 'utf8'));
      console.log('Using existing', SCHEDULE_JSON_PATH);
    } else {
      matchList = [];
      fs.writeFileSync(SCHEDULE_JSON_PATH, '[]', 'utf8');
      console.log('No schedule data yet. Wrote empty schedule.json. Matches column will be added but empty. Re-run when API limit resets to fetch schedule.');
    }
  }
  if (matchList && matchList.length > 0) {
    fs.writeFileSync(SCHEDULE_JSON_PATH, JSON.stringify(matchList, null, 2), 'utf8');
    console.log('Wrote', SCHEDULE_JSON_PATH);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(OUT_PATH);

  if (matchList && matchList.length > 0 && !wb.getWorksheet('Schedule')) {
    const scheduleRows = buildScheduleRows(matchList);
    const newWb = new ExcelJS.Workbook();
    const scheduleSheet = newWb.addWorksheet('Schedule', { views: [{ state: 'frozen', ySplit: 1 }] });
    scheduleSheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Time (GMT)', key: 'dateTimeGMT', width: 18 },
      { header: 'Match', key: 'matchName', width: 50 },
      { header: 'Venue', key: 'venue', width: 28 },
      { header: 'Status', key: 'status', width: 24 },
    ];
    scheduleSheet.getRow(1).font = { bold: true };
    scheduleRows.forEach((r) => scheduleSheet.addRow(r));

    wb.eachSheet((ws) => copySheet(ws, newWb));
    await newWb.xlsx.writeFile(OUT_PATH);
    console.log('Added Schedule as first sheet and saved.', OUT_PATH);
  } else {
    console.log('Schedule sheet already present.');
  }

  const outAbsolute = path.resolve(OUT_PATH);
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  console.log('Running add-group-sheets to add Matches column...');
  const addGroups = spawnSync(process.execPath, [path.join(scriptsDir, 'add-group-sheets.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, FANTASY_WORKBOOK_PATH: outAbsolute, OUTPUT_WORKBOOK_PATH: outAbsolute },
    stdio: 'inherit',
  });
  if (addGroups.status !== 0) {
    console.warn('add-group-sheets exited with', addGroups.status);
    process.exit(1);
  }
  console.log('Running add-total-row-to-group-sheets...');
  const addTotal = spawnSync(process.execPath, [path.join(scriptsDir, 'add-total-row-to-group-sheets.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, FANTASY_WORKBOOK_PATH: outAbsolute },
    stdio: 'inherit',
  });
  if (addTotal.status !== 0) console.warn('add-total-row exited with', addTotal.status);
  console.log('Done. Reopen the workbook to see Schedule (first tab) and Matches column in each Group sheet.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
