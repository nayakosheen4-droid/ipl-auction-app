#!/usr/bin/env node
/**
 * Fetches POTM and dot ball data from ESPN Cricinfo scorecards.
 * ESPN game IDs for T20 WC 2026: 1512718 + match_number (1-based).
 * Outputs espn-extras.json with { [matchKey]: { potm, dots: { bowlerName: dotCount } } }
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SCHEDULE_PATH = path.join(__dirname, 'schedule.json');
const OUTPUT_PATH = path.join(__dirname, 'espn-extras.json');
const ESPN_BASE_ID = 1512718;

function loadSchedule() {
  if (!fs.existsSync(SCHEDULE_PATH)) return [];
  return JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8'));
}

function isMatchEnded(m) {
  if (m.matchEnded === true) return true;
  const status = String(m.status || '').toLowerCase();
  return /won|complete|finished|result|drawn|tied|abandoned/.test(status);
}

function makeMatchKey(dateStr, teamsArr) {
  let datePart = '';
  if (dateStr) {
    const s = String(dateStr).trim();
    datePart = s.slice(0, 10);
  }
  const teams = (teamsArr || []).filter(Boolean).map(t => String(t).trim()).sort();
  return `${datePart}|${teams.join('|')}`;
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseESPNScorecard(html) {
  const result = { potm: null, dots: {} };

  const potmMatch = html.match(/Player of the Match[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)
    || html.match(/Player of the Match[^a-z]*([A-Z][a-zA-Z\s.''-]+)/);
  if (potmMatch) {
    result.potm = potmMatch[1].trim();
  }

  const bowlingTableRegex = /Bowling[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = bowlingTableRegex.exec(html)) !== null) {
    const table = tableMatch[1];
    const rows = table.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    if (!rows) continue;

    let dotsColIdx = -1;
    for (const row of rows) {
      const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
      if (!cells) continue;
      const cellTexts = cells.map(c => c.replace(/<[^>]+>/g, '').trim());

      if (cellTexts.some(t => /^0s$/i.test(t) || /^Dots$/i.test(t))) {
        dotsColIdx = cellTexts.findIndex(t => /^0s$/i.test(t) || /^Dots$/i.test(t));
        continue;
      }

      if (dotsColIdx === -1) continue;

      const nameLink = cells[0] && cells[0].match(/>([^<]+)<\/a>/);
      const bowlerName = nameLink ? nameLink[1].trim() : cellTexts[0];
      if (!bowlerName || /^bowling$/i.test(bowlerName) || /^total$/i.test(bowlerName)) continue;

      const dotsVal = dotsColIdx < cellTexts.length ? parseInt(cellTexts[dotsColIdx], 10) : NaN;
      if (!isNaN(dotsVal) && bowlerName.length > 1) {
        result.dots[bowlerName] = (result.dots[bowlerName] || 0) + dotsVal;
      }
    }
  }

  return result;
}

function slugify(teams) {
  return teams.map(t => t.toLowerCase().replace(/\s+/g, '-')).join('-vs-');
}

async function main() {
  const schedule = loadSchedule();
  const completed = schedule
    .filter(m => isMatchEnded(m))
    .sort((a, b) => String(a.date || a.dateTimeGMT || '').localeCompare(String(b.date || b.dateTimeGMT || '')));

  let existing = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')); } catch {}
  }

  const matchNumberMap = {};
  for (const m of schedule) {
    const id = m.id || m.matchId;
    if (!id) continue;
    const nameStr = m.name || '';
    const numMatch = nameStr.match(/(\d+)\w*\s+Match/);
    if (numMatch) matchNumberMap[id] = parseInt(numMatch[1], 10);
  }

  let fetched = 0;
  let skipped = 0;

  for (const m of completed) {
    const teams = m.teams || [];
    if (teams.length < 2) continue;
    const key = makeMatchKey(m.date || m.dateTimeGMT, teams);
    if (existing[key] && existing[key].potm) { skipped++; continue; }

    const id = m.id || m.matchId;
    const matchNum = matchNumberMap[id];
    if (!matchNum) { console.log('No match number for', teams.join(' vs ')); continue; }

    const espnGameId = ESPN_BASE_ID + matchNum;
    const slug = slugify(teams);
    const url = `https://www.espn.com/cricket/series/8604/scorecard/${espnGameId}/${slug}`;

    console.log(`[${fetched + skipped + 1}/${completed.length}] Fetching ${teams.join(' vs ')} (game ${espnGameId})...`);

    try {
      const resp = await fetch(url);
      if (resp.status !== 200) {
        console.log('  HTTP', resp.status, '- trying alternate slug...');
        const altUrl = `https://www.espn.com/cricket/series/8604/scorecard/${espnGameId}/`;
        const resp2 = await fetch(altUrl);
        if (resp2.status !== 200) {
          console.log('  Still', resp2.status, '- skipping');
          continue;
        }
        resp.body = resp2.body;
      }
      const parsed = parseESPNScorecard(resp.body);
      console.log('  POTM:', parsed.potm || '(none)');
      console.log('  Dots:', Object.keys(parsed.dots).length, 'bowlers');
      existing[key] = parsed;
      fetched++;

      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(existing, null, 2), 'utf8');
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log('  Error:', e.message);
    }
  }

  console.log(`\nDone: ${fetched} fetched, ${skipped} cached. Total: ${Object.keys(existing).length} matches.`);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(existing, null, 2), 'utf8');
}

main().catch(e => { console.error(e); process.exit(1); });
