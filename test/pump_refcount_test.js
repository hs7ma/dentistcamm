/**
 * Multi-unit pump refcount simulation test
 *
 * يحاكي 3 وحدات ري + 1 وحدة مضخة مركزية تتصل عبر WebSocket
 * ويتحقق من سيناريوهات متعددة لطلب/إلغاء المضخة.
 *
 * الاستخدام:
 *   1) في terminal 1:  PORT=3001 node server.js
 *   2) في terminal 2:  node test/pump_refcount_test.js
 */

'use strict';

const WebSocket = require('ws');
const http = require('http');

const HOST = process.env.TEST_HOST || 'localhost';
const PORT = parseInt(process.env.TEST_PORT || process.env.PORT || '3001', 10);
const SECRET = process.env.SOCKET_SECRET_TOKEN || 'ESP32_CLIMATE_SECURE_TOKEN_2025';

const log = (...a) => console.log('[TEST]', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let testsPassed = 0;
let testsFailed = 0;

function assert(cond, msg) {
  if (cond) {
    log('  ✓', msg);
    testsPassed++;
  } else {
    log('  ✗ FAIL:', msg);
    testsFailed++;
  }
}

// ---- WebSocket helpers ----

function connectUnit(deviceId) {
  return new Promise((resolve, reject) => {
    const url = `ws://${HOST}:${PORT}/ws`;
    const ws = new WebSocket(url);
    const inbox = [];
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: SECRET, device: deviceId }));
      // wait briefly for server greeting
      setTimeout(() => resolve({ ws, inbox, deviceId }), 200);
    });
    ws.on('message', (data) => {
      try { inbox.push(JSON.parse(data.toString())); } catch {}
    });
    ws.on('error', reject);
  });
}

function sendPumpRequest(client, action) {
  client.ws.send(JSON.stringify({
    type: 'pump_request',
    device: client.deviceId,
    action, // 'request' | 'release'
  }));
}

// ---- REST helpers ----

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function getPumpStatus() {
  const r = await fetchJson('/api/central-pump');
  return r.centralPump;
}

// نمسح inbox للوحدة المركزية بين الاختبارات
function pumpMsgs(centralClient) {
  return centralClient.inbox.filter(m =>
    m && m.type === 'irrigation_state' && m.data && typeof m.data.centralPumpShouldRun === 'boolean'
  );
}
function clearInbox(client) { client.inbox.length = 0; }

// ============================================================

async function main() {
  log('Connecting to', `ws://${HOST}:${PORT}/ws`);

  const u1 = await connectUnit('plant-bed-01');
  const u2 = await connectUnit('plant-bed-02');
  const u3 = await connectUnit('plant-bed-03');
  const central = await connectUnit('plant-bed-04'); // central pump unit
  log('All 4 clients connected\n');

  await sleep(300);

  // إعادة تصفير حالة بداية: نفترض أن الكاش/DB قد تكون فيها حالة من تشغيل سابق
  log('--- Reset: release all units ---');
  sendPumpRequest(u1, 'release');
  sendPumpRequest(u2, 'release');
  sendPumpRequest(u3, 'release');
  await sleep(500);
  clearInbox(central);

  let s = await getPumpStatus();
  log('Initial state:', s);
  assert(s.active === false, 'pump initially OFF after reset');

  // ----------------------------------------------------------
  log('\n--- Scenario 1: Single unit ON → pump ON ---');
  clearInbox(central);
  sendPumpRequest(u1, 'request');
  await sleep(300);
  s = await getPumpStatus();
  assert(s.active === true, 'pump active after u1 request');
  assert(s.requestingUnits.includes('plant-bed-01'), 'u1 in requestingUnits');
  const msgs1 = pumpMsgs(central);
  assert(msgs1.length >= 1, `central got ≥1 notify (got ${msgs1.length})`);
  assert(msgs1[msgs1.length - 1].data.centralPumpShouldRun === true, 'last notify shouldRun=true');

  // ----------------------------------------------------------
  log('\n--- Scenario 2: Idempotent — same unit ON twice ---');
  clearInbox(central);
  sendPumpRequest(u1, 'request');
  await sleep(300);
  s = await getPumpStatus();
  assert(s.requestingUnits.filter(x => x === 'plant-bed-01').length === 1,
         'u1 not duplicated in requestingUnits');

  // ----------------------------------------------------------
  log('\n--- Scenario 3: Two units ON → both in list ---');
  clearInbox(central);
  sendPumpRequest(u2, 'request');
  await sleep(300);
  s = await getPumpStatus();
  assert(s.active === true, 'pump still active');
  assert(s.requestingUnits.includes('plant-bed-01'), 'u1 still in list');
  assert(s.requestingUnits.includes('plant-bed-02'), 'u2 added to list');

  // ----------------------------------------------------------
  log('\n--- Scenario 4: One of two OFF → pump stays ON (THE BUG WE FIXED) ---');
  clearInbox(central);
  sendPumpRequest(u1, 'release');
  await sleep(300);
  s = await getPumpStatus();
  assert(s.active === true, '★ pump stays ON because u2 still requesting');
  assert(!s.requestingUnits.includes('plant-bed-01'), 'u1 removed');
  assert(s.requestingUnits.includes('plant-bed-02'), 'u2 still in list');
  const msgs4 = pumpMsgs(central);
  if (msgs4.length > 0) {
    assert(msgs4[msgs4.length - 1].data.centralPumpShouldRun === true,
           'central received shouldRun=true (pump must stay on)');
  }

  // ----------------------------------------------------------
  log('\n--- Scenario 5: Last one OFF → pump OFF ---');
  clearInbox(central);
  sendPumpRequest(u2, 'release');
  await sleep(300);
  s = await getPumpStatus();
  assert(s.active === false, 'pump OFF when no units requesting');
  assert(s.requestingUnits.length === 0, 'requestingUnits empty');

  // ----------------------------------------------------------
  log('\n--- Scenario 6: Concurrent requests from 3 units ---');
  clearInbox(central);
  sendPumpRequest(u1, 'request');
  sendPumpRequest(u2, 'request');
  sendPumpRequest(u3, 'request');
  await sleep(500);
  s = await getPumpStatus();
  assert(s.active === true, 'pump active after concurrent requests');
  assert(s.requestingUnits.length === 3, `all 3 units in list (got ${s.requestingUnits.length})`);

  // ----------------------------------------------------------
  log('\n--- Scenario 7: Release in random order, pump stays on until last ---');
  clearInbox(central);
  sendPumpRequest(u3, 'release');
  await sleep(150);
  s = await getPumpStatus();
  assert(s.active === true, 'pump ON after u3 release (u1,u2 still active)');
  assert(s.requestingUnits.length === 2, '2 units remain');

  sendPumpRequest(u1, 'release');
  await sleep(150);
  s = await getPumpStatus();
  assert(s.active === true, 'pump ON after u1 release (u2 still active)');
  assert(s.requestingUnits.length === 1, '1 unit remains');

  sendPumpRequest(u2, 'release');
  await sleep(150);
  s = await getPumpStatus();
  assert(s.active === false, 'pump OFF after last release');

  // ----------------------------------------------------------
  log('\n--- Scenario 8: Disconnect-while-running clears that unit only ---');
  clearInbox(central);
  sendPumpRequest(u1, 'request');
  sendPumpRequest(u2, 'request');
  await sleep(300);
  s = await getPumpStatus();
  assert(s.requestingUnits.length === 2, 'pre-disconnect: 2 units');

  log('  closing u1 socket abruptly...');
  u1.ws.terminate();
  await sleep(800);
  s = await getPumpStatus();
  assert(s.active === true, '★ pump stays ON after u1 disconnect (u2 still active)');
  assert(!s.requestingUnits.includes('plant-bed-01'), 'u1 removed by disconnect handler');
  assert(s.requestingUnits.includes('plant-bed-02'), 'u2 still in list');

  // cleanup
  sendPumpRequest(u2, 'release');
  await sleep(200);

  // ----------------------------------------------------------
  log('\n--- Scenario 9: pumpSeq monotonically increasing (DB mode only) ---');
  clearInbox(central);
  sendPumpRequest(u2, 'request');
  await sleep(150);
  sendPumpRequest(u3, 'request');
  await sleep(150);
  sendPumpRequest(u2, 'release');
  await sleep(300);
  const seqs = pumpMsgs(central).map(m => m.data.pumpSeq || 0);
  log('  observed pumpSeq sequence:', seqs);
  if (seqs.some(s => s > 0)) {
    let monotonic = true;
    for (let i = 1; i < seqs.length; i++) {
      if (seqs[i] !== 0 && seqs[i] < seqs[i-1]) { monotonic = false; break; }
    }
    assert(monotonic, 'pumpSeq is non-decreasing in WS messages');
  } else {
    log('  (DB not connected — skipping seq check)');
  }

  // cleanup final
  sendPumpRequest(u3, 'release');
  await sleep(200);

  // ----------------------------------------------------------
  log('\n=========================================');
  log(`Result: ${testsPassed} passed, ${testsFailed} failed`);
  log('=========================================\n');

  u2.ws.close();
  u3.ws.close();
  central.ws.close();

  process.exit(testsFailed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('TEST CRASHED:', e);
  process.exit(2);
});
