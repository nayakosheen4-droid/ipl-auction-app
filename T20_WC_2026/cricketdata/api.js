/**
 * Cricket Data API client.
 * Supports multiple API keys with automatic rotation on rate-limit errors.
 * Docs: https://cricketdata.org/how-to-use-cricket-data-api.aspx
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// When this folder lives under T20_WC_2026, also try repo root so one .env works for IPL app and T20 WC
if (!process.env.CRICKEY_API_KEY) {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
}
const https = require('https');
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

  const keysStr = process.env.CRICKETDATA_API_KEYS || process.env.CRICKETDATA_API_KEY || config.apiKey || '';
  const apiKeys = keysStr.split(',').map(k => k.trim()).filter(Boolean);

  return {
    seriesId: process.env.CRICKETDATA_SERIES_ID || config.seriesId,
    apiKey: apiKeys[0] || '',
    apiKeys,
    baseUrl: (process.env.CRICKETDATA_BASE_URL || config.baseUrl || 'https://api.cricapi.com/v1').replace(/\/$/, ''),
  };
}

function get(url) {
  return new Promise((resolve, reject) => {
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

function isRateLimitError(err) {
  const msg = (err.message || err.reason || '').toLowerCase();
  return msg.includes('hits today exceeded') || msg.includes('rate limit') || msg.includes('hits limit');
}

function isRateLimitResponse(res) {
  if (!res) return false;
  if (res.status === 'failure') {
    const reason = (res.reason || res.message || '').toLowerCase();
    return reason.includes('hits today exceeded') || reason.includes('rate limit') || reason.includes('hits limit');
  }
  return false;
}

/**
 * Make an API call, trying each key until one succeeds or all are rate-limited.
 * @param {string} endpoint - e.g. 'series_info' or 'match_scorecard'
 * @param {Object} params - query params (excluding apikey)
 * @param {string[]} apiKeys - list of API keys to try
 * @param {string} baseUrl
 * @returns {Promise<Object>} parsed JSON response
 */
async function callWithKeyRotation(endpoint, params, apiKeys, baseUrl) {
  const queryParts = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  for (let i = 0; i < apiKeys.length; i++) {
    const key = apiKeys[i];
    const url = `${baseUrl}/${endpoint}?apikey=${encodeURIComponent(key)}&${queryParts}`;
    try {
      const res = await get(url);
      if (isRateLimitResponse(res)) {
        const keyLabel = key.slice(0, 8) + '...';
        console.warn(`  Key ${keyLabel} rate-limited${i < apiKeys.length - 1 ? ', trying next key...' : ''}`);
        continue;
      }
      if (i > 0) {
        console.log(`  Using key #${i + 1} (${key.slice(0, 8)}...)`);
      }
      return res;
    } catch (err) {
      if (isRateLimitError(err)) {
        const keyLabel = key.slice(0, 8) + '...';
        console.warn(`  Key ${keyLabel} rate-limited${i < apiKeys.length - 1 ? ', trying next key...' : ''}`);
        continue;
      }
      throw err;
    }
  }
  throw new Error('All API keys have hit their rate limit for today.');
}

async function fetchSeriesMatches(seriesId, apiKey, baseUrl, apiKeys) {
  const keys = apiKeys || [apiKey];
  const res = await callWithKeyRotation('series_info', { offset: 0, id: seriesId }, keys, baseUrl);
  if (res.status && res.status !== 'success') {
    throw new Error(res.message || res.reason || 'Series request failed.');
  }
  const list = res.data && res.data.matchList;
  if (Array.isArray(list)) return list;
  throw new Error(res.message || 'No matchList in response. Check seriesId and API key.');
}

async function fetchMatchDetails(matchId, apiKey, baseUrl, apiKeys) {
  const keys = apiKeys || [apiKey];
  const res = await callWithKeyRotation('match_scorecard', { offset: 0, id: matchId }, keys, baseUrl);
  if (res.status && res.status !== 'success') {
    throw new Error(res.message || res.reason || `Match ${matchId} request failed`);
  }
  if (res.data) return res;
  throw new Error(`No data in match_scorecard response for ${matchId}`);
}

async function fetchMatchBBB(matchId, apiKey, baseUrl, apiKeys) {
  const keys = apiKeys || [apiKey];
  const res = await callWithKeyRotation('match_bbb', { offset: 0, id: matchId }, keys, baseUrl);
  if (res.status && res.status !== 'success') {
    throw new Error(res.message || res.reason || `Match BBB ${matchId} request failed`);
  }
  if (res.data) return res;
  throw new Error(`No data in match_bbb response for ${matchId}`);
}

module.exports = { loadConfig, get, fetchSeriesMatches, fetchMatchDetails, fetchMatchBBB };
