/**
 * Cricket Data API client.
 * Fetches series schedule and match details. Base URL and key from .env or config or env.
 * Docs: https://cricketdata.org/how-to-use-cricket-data-api.aspx
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const path = require('path');
const fs = require('fs');

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.warn('Could not load config.json:', e.message);
    }
  }
  return {
    seriesId: process.env.CRICKETDATA_SERIES_ID || config.seriesId,
    apiKey: process.env.CRICKETDATA_API_KEY || config.apiKey,
    baseUrl: (process.env.CRICKETDATA_BASE_URL || config.baseUrl || 'https://api.cricapi.com/v1').replace(/\/$/, ''),
  };
}

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET' };
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(json.message || json.error || `HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
              return;
            }
            resolve(json);
          } catch (e) {
            reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * Fetch list of matches for a series (full schedule: all scheduled matches with dates).
 * Uses CricAPI: GET series_info?apikey=...&offset=0&id=<seriesId>
 * Returns data.matchList: [ { id, name, teams, date, dateTimeGMT, venue, status, matchEnded, ... } ].
 * So you get every match (past and future) with id, name, teams, date, dateTimeGMT, venue, status.
 */
async function fetchSeriesMatches(seriesId, apiKey, baseUrl) {
  const url = `${baseUrl}/series_info?apikey=${encodeURIComponent(apiKey)}&offset=0&id=${encodeURIComponent(seriesId)}`;
  const res = await get(url);
  if (res.status && res.status !== 'success') {
    throw new Error(res.message || res.reason || 'Series request failed.');
  }
  const list = res.data && res.data.matchList;
  if (Array.isArray(list)) return list;
  throw new Error(res.message || 'No matchList in response. Check seriesId and API key.');
}

/**
 * Fetch match scorecard (player-level batting/bowling/fielding) for fantasy.
 * Uses CricAPI: GET match_scorecard?apikey=...&offset=0&id=<matchId>
 * Response: data has id, name, teams, score[], scorecard: [ { batting, bowling, catching, inning }, ... ].
 */
async function fetchMatchDetails(matchId, apiKey, baseUrl) {
  const url = `${baseUrl}/match_scorecard?apikey=${encodeURIComponent(apiKey)}&offset=0&id=${encodeURIComponent(matchId)}`;
  const res = await get(url);
  if (res.status && res.status !== 'success') {
    throw new Error(res.message || res.reason || `Match ${matchId} request failed`);
  }
  if (res.data) return res;
  throw new Error(`No data in match_scorecard response for ${matchId}`);
}

/**
 * Fetch ball-by-ball data for a match (for dots and full stats).
 * Uses CricAPI: GET match_bbb?apikey=...&offset=0&id=<matchId>
 * Response shape may vary; normalizeBBBToInnings() converts to Cricsheet-like innings.
 */
async function fetchMatchBBB(matchId, apiKey, baseUrl) {
  const url = `${baseUrl}/match_bbb?apikey=${encodeURIComponent(apiKey)}&offset=0&id=${encodeURIComponent(matchId)}`;
  const res = await get(url);
  if (res.status && res.status !== 'success') {
    throw new Error(res.message || res.reason || `Match BBB ${matchId} request failed`);
  }
  if (res.data) return res;
  throw new Error(`No data in match_bbb response for ${matchId}`);
}

module.exports = { loadConfig, get, fetchSeriesMatches, fetchMatchDetails, fetchMatchBBB };
