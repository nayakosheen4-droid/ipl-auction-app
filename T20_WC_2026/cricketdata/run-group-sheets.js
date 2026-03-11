#!/usr/bin/env node
/**
 * After building Fantasy Points from API (build-fantasy-from-api.js), run this to add
 * Group 1–8 sheets, Playing XI columns, and Total/Round Total rows (same as main folder).
 * Uses parent scripts with FANTASY_WORKBOOK_PATH pointing to cricketdata output.
 */

const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.join(__dirname, '..');
const workbookPath = path.join(rootDir, 'Fantasy_Points_T20WC_2025_26.xlsx');
const auctionPath = path.join(rootDir, 'ICC T20 WC 2026 Auction Game.xlsx');

const env = {
  ...process.env,
  FANTASY_WORKBOOK_PATH: workbookPath,
  OUTPUT_WORKBOOK_PATH: workbookPath,
  AUCTION_WORKBOOK_PATH: auctionPath,
};

function run(script, description) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(rootDir, 'scripts', script)], {
      stdio: 'inherit',
      cwd: rootDir,
      env,
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}

async function main() {
  await run('add-group-sheets.js', 'Add group sheets');
  await run('add-playing-xi-columns.js', 'Add Playing XI columns');
  await run('add-total-row-to-group-sheets.js', 'Add Total and Round Total rows');
  console.log('Done. Workbook:', workbookPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
