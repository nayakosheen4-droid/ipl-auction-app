#!/usr/bin/env node
/**
 * Test the schedule API locally before deploying.
 * Run: node scripts/test-schedule-api.js
 * Or with server already running: node scripts/test-schedule-api.js --http
 */

const path = require('path');
const http = require('http');

const USE_HTTP = process.argv.includes('--http');
const PORT = process.env.PORT || 3000;

async function testDirect() {
  console.log('\n1. Testing getSchedule() directly (no server)...');
  const api = require(path.join(__dirname, '../server/cricketApi'));
  const result = await api.getSchedule('2025');
  const count = result?.data?.length ?? 0;
  console.log('   Result: %d match(es)', count);
  if (count > 0) {
    console.log('   First: %s (%s)', result.data[0].name, result.data[0].id);
  }
  return count > 0;
}

function testHttp() {
  return new Promise((resolve) => {
    console.log('\n2. Testing GET /api/autostats/matches?season=2025&schedule=true ...');
    const url = `http://127.0.0.1:${PORT}/api/autostats/matches?season=2025&schedule=true`;
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (ch) => { body += ch; });
      res.on('end', () => {
        let ok = false;
        try {
          const data = JSON.parse(body);
          ok = data.success === true && Array.isArray(data.matches) && data.matches.length > 0;
          console.log('   Status: %d', res.statusCode);
          console.log('   success: %s, count: %d', data.success, data.matches?.length ?? 0);
          if (data.matches?.length) {
            console.log('   First: %s (%s)', data.matches[0].name, data.matches[0].id);
          }
        } catch (e) {
          console.log('   Parse error:', e.message);
        }
        resolve(ok);
      });
    });
    req.on('error', (e) => {
      console.log('   Request error:', e.message);
      console.log('   (Start server with: npm start)');
      resolve(false);
    });
    req.setTimeout(5000, () => {
      req.destroy();
      console.log('   Timeout');
      resolve(false);
    });
  });
}

async function main() {
  console.log('Schedule API test');
  const directOk = await testDirect();
  if (USE_HTTP) {
    const httpOk = await testHttp();
    console.log('\nDirect:', directOk ? 'PASS' : 'FAIL');
    console.log('HTTP:  ', httpOk ? 'PASS' : 'FAIL');
    process.exit(directOk && httpOk ? 0 : 1);
  }
  console.log('\nResult:', directOk ? 'PASS' : 'FAIL');
  console.log('To test HTTP endpoint, start server (npm start) then run: node scripts/test-schedule-api.js --http');
  process.exit(directOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
