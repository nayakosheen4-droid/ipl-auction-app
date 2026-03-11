#!/usr/bin/env node
/**
 * Build fantasy Excel for a single match (by match ID). Use when you want to test or get data for one game.
 * Usage: CRICKETDATA_API_KEY=your_key node cricketdata/build-one-match.js [matchId]
 * Default matchId: IPL 2022 SRH vs KKR (has scorecard).
 */

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const { loadConfig, fetchMatchDetails } = require('./api');
const { normalizeMatch } = require('./normalizeMatch');
const { buildRowsForMatch, getMatchDate, getMatchName } = require('./fantasyScoring');

const OUT_PATH = path.join(__dirname, '..', 'Fantasy_Points_T20WC_2025_26.xlsx');

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
  { header: 'Strike Rate', key: 'strikeRate', width: 10 },
  { header: 'Pts SR', key: 'ptsSR', width: 6 },
  { header: 'Wickets', key: 'wickets', width: 7 },
  { header: 'Pts Wickets', key: 'ptsWickets', width: 10 },
  { header: 'Pts LBW/Bowled', key: 'ptsLBWBowled', width: 12 },
  { header: 'Dots', key: 'dots', width: 4 },
  { header: 'Pts Dots', key: 'ptsDots', width: 8 },
  { header: 'Maidens', key: 'maidens', width: 7 },
  { header: 'Pts Maidens', key: 'ptsMaidens', width: 10 },
  { header: 'Pts Wkt Bonus', key: 'ptsWktBonus', width: 11 },
  { header: 'Bowling Pts', key: 'bowlingPts', width: 10 },
  { header: 'Overs', key: 'overs', width: 5 },
  { header: 'Economy', key: 'economy', width: 8 },
  { header: 'Pts Economy', key: 'ptsEconomy', width: 10 },
  { header: 'Catches', key: 'catches', width: 7 },
  { header: 'Pts Catches', key: 'ptsCatches', width: 10 },
  { header: 'Pts 3 Catch', key: 'pts3Catch', width: 9 },
  { header: 'Stumpings', key: 'stumpings', width: 9 },
  { header: 'Pts Stumpings', key: 'ptsStumpings', width: 12 },
  { header: 'Direct Run Out', key: 'directRunOut', width: 12 },
  { header: 'Pts Direct RO', key: 'ptsDirectRO', width: 11 },
  { header: 'Run Out Assist', key: 'runOutAssist', width: 12 },
  { header: 'Pts Assist RO', key: 'ptsAssistRO', width: 10 },
  { header: 'Fielding Pts', key: 'fieldingPts', width: 11 },
];

const DEFAULT_MATCH_ID = '0b12f428-98ab-4009-831d-493d325bc555'; // IPL 2022 SRH vs KKR

async function main() {
  const { apiKey, baseUrl } = loadConfig();
  const key = process.env.CRICKETDATA_API_KEY || apiKey;
  if (!key || key === 'YOUR_API_KEY') {
    console.error('Set CRICKETDATA_API_KEY or apiKey in cricketdata/config.json');
    process.exit(1);
  }
  const matchId = process.argv[2] || DEFAULT_MATCH_ID;

  console.log('Fetching match', matchId, '...');
  let raw;
  try {
    raw = await fetchMatchDetails(matchId, key, baseUrl);
  } catch (e) {
    console.error('Fetch failed:', e.message);
    process.exit(1);
  }

  const normalized = normalizeMatch(raw);
  if (!normalized || !normalized.stats) {
    console.error('Could not normalize match (no scorecard?)');
    process.exit(1);
  }

  const matchTeamRound = {};
  const rows = buildRowsForMatch(normalized, 0, matchTeamRound, []);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Fantasy Points', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = SHEET_COLUMNS;
  sheet.getRow(1).font = { bold: true };
  rows.forEach((r) => sheet.addRow(r));

  if (!fs.existsSync(path.dirname(OUT_PATH))) fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  await workbook.xlsx.writeFile(OUT_PATH);

  console.log('Written:', OUT_PATH);
  console.log('Match:', getMatchName(normalized.info), getMatchDate(normalized.info));
  console.log('Rows:', rows.length);
  if (rows.length > 0) {
    const top = rows.slice(0, 5).map((r) => `${r.playerName} (${r.country}): ${r.fantasyPoints} pts`).join('\n');
    console.log('Top 5:\n' + top);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
