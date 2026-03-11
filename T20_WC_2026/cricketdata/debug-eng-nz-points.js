#!/usr/bin/env node
/**
 * Debug script: compute fantasy points for England vs NZ match from scorecard + ESPN,
 * print breakdown per player to find why totals are wrong.
 */
const path = require('path');
const fs = require('fs');
const { normalizeMatch } = require('./normalizeMatch');
const {
  battingBreakdown,
  strikeRateBreakdown,
  bowlingBreakdown,
  economyBreakdown,
  fieldingBreakdown,
} = require('./fantasyScoring');

const SCORECARD_PATH = path.join(__dirname, 'scorecards/93a6b950-678e-4706-9642-aae4bb5f7718.json');
const ESPN_EXTRAS_PATH = path.join(__dirname, 'espn-extras.json');

const ESPN_NAME_MAP = {
  'JC Archer': 'Jofra Archer',
  'LA Dawson': 'Liam Dawson',
  'SM Curran': 'Sam Curran',
  'AU Rashid': 'Adil Rashid',
  'WG Jacks': 'Will Jacks',
  'JG Bethell': 'Jacob Bethell',
  'MJ Henry': 'Matt Henry',
  'LH Ferguson': 'Lockie Ferguson',
  'MJ Santner': 'Mitchell Santner',
  'CE McConchie': 'Cole McConchie',
  'GD Phillips': 'Glenn Phillips',
  'R Ravindra': 'Rachin Ravindra',
  'IS Sodhi': 'Ish Sodhi',
};

function espnNameMatch(espnName, cricApiName, allCricApiNames) {
  const mapped = ESPN_NAME_MAP[espnName.replace(/\(\d+\)$/, '').trim()];
  if (mapped && mapped === cricApiName) return true;
  const clean = espnName.replace(/\(\d+\)$/, '').trim();
  if (clean === cricApiName || clean.toLowerCase() === cricApiName.toLowerCase()) return true;
  const espnParts = clean.split(/\s+/);
  const apiParts = cricApiName.split(/\s+/);
  const espnLast = espnParts[espnParts.length - 1].toLowerCase();
  const apiLast = apiParts[apiParts.length - 1].toLowerCase();
  if (espnLast !== apiLast) return false;
  const espnFirst = espnParts[0].toLowerCase();
  const apiFirst = apiParts[0].toLowerCase();
  if (espnFirst === apiFirst) return true;
  if (espnFirst.length <= 3 && espnFirst[0] === apiFirst[0]) return true;
  return false;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(SCORECARD_PATH, 'utf8'));
  const espnExtras = JSON.parse(fs.readFileSync(ESPN_EXTRAS_PATH, 'utf8'));
  const key = '2026-02-27|England|New Zealand';
  const extras = espnExtras[key];
  if (!extras) {
    console.error('No ESPN extras for', key);
    process.exit(1);
  }

  const normalized = normalizeMatch(raw);
  if (!normalized || !normalized.stats) {
    console.error('Failed to normalize match');
    process.exit(1);
  }
  const stats = normalized.stats;
  const allNames = [...new Set([...Object.keys(stats.batting || {}), ...Object.keys(stats.bowling || {}), ...Object.keys(stats.fielding || {})])];

  console.log('=== England vs NZ Round 7 – point breakdown ===\n');
  console.log('ESPN POTM:', extras.potm);
  console.log('ESPN dots keys:', Object.keys(extras.dots || {}).join(', '));
  console.log('');

  const players = allNames.sort();
  for (const playerName of players) {
    const bat = battingBreakdown(stats.batting || {}, stats.bowling || {}, playerName);
    const sr = strikeRateBreakdown(stats.batting || {}, playerName);
    let dotCount = (stats.bowling && stats.bowling[playerName] && stats.bowling[playerName].dots) || 0;
    if (extras.dots) {
      for (const [espnRaw, count] of Object.entries(extras.dots)) {
        if (espnNameMatch(espnRaw, playerName, allNames)) {
          dotCount = count;
          break;
        }
      }
    }
    const bowlStat = stats.bowling && stats.bowling[playerName] ? { ...stats.bowling[playerName], dots: dotCount } : null;
    const bowl = bowlingBreakdown(bowlStat ? { [playerName]: bowlStat } : {}, playerName);
    const ec = economyBreakdown(stats.bowling || {}, playerName);
    const fl = fieldingBreakdown(stats.fielding || {}, playerName);
    const ptsPlaying = 4;
    const potmName = (extras.potm || '').trim();
    const ptsPOTM = potmName && espnNameMatch(potmName, playerName, allNames) ? 50 : 0;
    const total = bat.battingPts + sr.ptsSR + bowl.bowlingPts + ec.ptsEconomy + fl.fieldingPts + ptsPlaying + ptsPOTM;

    console.log(playerName);
    console.log('  Bat: runs', bat.runs, '4s', bat.fours, '6s', bat.sixes, '->', bat.battingPts, '| SR pts', sr.ptsSR);
    console.log('  Bowl: wkts', bowl.wickets, 'dots', bowl.dots, 'maidens', bowl.maidens, '->', bowl.bowlingPts, '| Eco pts', ec.ptsEconomy);
    console.log('  Field: catches', fl.catches, '->', fl.fieldingPts, '| Play', ptsPlaying, '| POTM', ptsPOTM);
    console.log('  TOTAL:', Math.round(total * 10) / 10);
    console.log('');
  }
}

main();
