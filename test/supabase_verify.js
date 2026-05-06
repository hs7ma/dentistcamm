/**
 * Supabase end-to-end verification.
 *
 * يتحقق من قدرة التطبيق على الكتابة والقراءة من Supabase لكل من:
 *   - وحدة المناخ: climate_readings, climate_settings (setpoint + relay_state + thresholds via extra_json)
 *   - وحدة الري:   unit_state (8 أجهزة plant-bed-01..plant-bed-08), central_pump_state (atomic refcount)
 *
 * الاستخدام:
 *   $env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."
 *   node test/supabase_verify.js
 *
 * المتطلبات:
 *   - تنفيذ database/10_pump_atomic.sql (يضيف pump_seq + RPC)
 *   - تنفيذ database/11_climate_settings_extra_json.sql (يضيف extra_json)
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  ClimateDB,
  ClimateSettingsDB,
  UnitStateDB,
  CentralPumpDB,
  isAvailable,
} = require('../lib/db');

const log = (...a) => console.log('[VERIFY]', ...a);
let pass = 0, fail = 0, warn = 0;

function ok(label, cond, info) {
  if (cond) { log('  ✓', label, info ? `→ ${info}` : ''); pass++; }
  else      { log('  ✗ FAIL:', label, info ? `→ ${info}` : ''); fail++; }
}
function softWarn(label, info) {
  log('  ⚠️ WARN:', label, info ? `→ ${info}` : '');
  warn++;
}

async function tryAsync(label, fn) {
  try {
    return await fn();
  } catch (e) {
    fail++;
    log('  ✗ FAIL:', label, '→', e.message || e);
    return null;
  }
}

const TEST_CLIMATE_DEVICE = 'climate-controller-01';
// 8 أجهزة الري: plant-bed-01..plant-bed-08، plant-bed-04 هو وحدة المضخة المركزية
const IRRIGATION_UNITS = Array.from({ length: 8 }, (_, i) =>
  `plant-bed-${String(i + 1).padStart(2, '0')}`,
);
const CENTRAL_PUMP_UNIT = 'plant-bed-04';

async function verifyClimate() {
  log('\n=== CLIMATE ===');

  // 1) climate_readings: إدراج + قراءة
  const reading = await tryAsync('climate_readings.insert', () =>
    ClimateDB.saveReading(TEST_CLIMATE_DEVICE, 24.5, 55.2));
  ok('climate_readings: write', !!reading, reading && reading.id);

  const latest = await tryAsync('climate_readings.getLatest', () =>
    ClimateDB.getLatestReading(TEST_CLIMATE_DEVICE));
  ok('climate_readings: read', latest && Number(latest.temperature) === 24.5,
     latest && `temp=${latest.temperature}, hum=${latest.humidity}`);

  // 2) climate_settings: setpoint
  const sp1 = { enabled: true, targetTemperature: 26, targetHumidity: 62, temperatureTolerance: 1.5, humidityTolerance: 4 };
  await tryAsync('climate_settings.saveSettings', () => ClimateSettingsDB.saveSettings(sp1));
  const sp2 = await tryAsync('climate_settings.getSettings', () => ClimateSettingsDB.getSettings());
  ok('climate_settings: setpoint round-trip', sp2 && sp2.targetTemperature === 26 && sp2.targetHumidity === 62,
     sp2 && JSON.stringify(sp2));

  // 3) climate_settings.extra_json: relay_state (هذا ما كان يفشل قبل migration 11)
  const relayState = {
    fan:    { mode: 'manual', state: true,  lastChanged: new Date().toISOString() },
    heater: { mode: 'auto',   state: false, lastChanged: null },
    pump:   { mode: 'auto',   state: false, lastChanged: null },
    motor:  { mode: 'manual', state: true,  lastChanged: new Date().toISOString() },
    door:   { mode: 'auto',   state: false, lastChanged: null },
  };
  await tryAsync('climate_settings.saveRelayState', () => ClimateSettingsDB.saveRelayState(relayState));
  const rs2 = await tryAsync('climate_settings.getRelayState', () => ClimateSettingsDB.getRelayState());
  ok('climate_settings: relay_state round-trip (extra_json)',
     rs2 && rs2.fan && rs2.fan.state === true && rs2.heater && rs2.heater.mode === 'auto',
     rs2 && `keys=${Object.keys(rs2).join(',')}`);

  // 4) climate_settings.extra_json: thresholds
  const thresholds = {
    fan:    { type: 'temperature', comparison: 'above', on: 30, off: 28, unit: '°C' },
    heater: { type: 'temperature', comparison: 'below', on: 20, off: 22, unit: '°C' },
  };
  await tryAsync('climate_settings.saveThresholds', () => ClimateSettingsDB.saveThresholds(thresholds));
  const t2 = await tryAsync('climate_settings.getThresholds', () => ClimateSettingsDB.getThresholds());
  ok('climate_settings: thresholds round-trip (extra_json)',
     t2 && t2.fan && t2.fan.on === 30 && t2.heater && t2.heater.off === 22,
     t2 && `fan.on=${t2 && t2.fan && t2.fan.on}, heater.off=${t2 && t2.heater && t2.heater.off}`);
}

async function verifyIrrigation() {
  log('\n=== IRRIGATION (8 units, central=plant-bed-04) ===');

  // 1) إنشاء/قراءة 8 وحدات
  for (const unitId of IRRIGATION_UNITS) {
    const u = await tryAsync(`unit_state.getOrCreate(${unitId})`, () => UnitStateDB.getOrCreate(unitId));
    ok(`unit_state[${unitId}]: getOrCreate`, !!u, u && `mode=${u.control && u.control.irrigationMode}`);
  }

  // 2) كتابة بيانات حساسات لكل وحدة (محاكاة حقيقية)
  for (let i = 0; i < IRRIGATION_UNITS.length; i++) {
    const unitId = IRRIGATION_UNITS[i];
    const sensor = {
      soilMoisture: 30 + i * 5,
      waterFlow: 0.5,
      totalWaterConsumed: 12.3 + i,
      irrigationActive: i === 0,
      currentMode: 'off',
    };
    const r = await tryAsync(`unit_state.updateSensorData(${unitId})`, () =>
      UnitStateDB.updateSensorData(unitId, sensor));
    ok(`unit_state[${unitId}]: write sensor`,
       r && Math.round(r.sensorData.soilMoisture) === Math.round(sensor.soilMoisture),
       r && `moisture=${r.sensorData.soilMoisture}`);
  }

  // 3) كتابة وقراءة أوامر تحكم
  const ctrl = {
    irrigationMode: 'quantitative',
    quantitativeValue: 7.5,
    quantitativeSchedule: 'periodic',
    quantitativeInterval: 4,
    enableTimeWindow: true,
    allowedStartHour: 5,
    allowedEndHour: 21,
  };
  const u3 = await tryAsync('unit_state.updateControl(plant-bed-03)', () =>
    UnitStateDB.updateControl('plant-bed-03', ctrl));
  ok('unit_state.updateControl round-trip',
     u3 && u3.control.quantitativeValue === 7.5 && u3.control.allowedStartHour === 5,
     u3 && `mode=${u3.control.irrigationMode}, qv=${u3.control.quantitativeValue}`);

  // 4) قراءة جميع الوحدات (للتحقق أن العدد ≥ 8)
  const all = await tryAsync('unit_state.getAll', () => UnitStateDB.getAll());
  ok('unit_state.getAll returns >= 8 rows', all && all.length >= 8, all && `count=${all.length}`);

  // 5) المضخة المركزية: refcount atomic
  log('  --- central_pump_state (atomic refcount) ---');

  // تنظيف: تحرير كل الوحدات قبل الاختبار
  for (const u of IRRIGATION_UNITS) {
    await tryAsync(`pump_set_request(${u}, false)`, () => CentralPumpDB.setPumpRequest(u, false));
  }

  let s = await tryAsync('pump_get_state initial', () => CentralPumpDB.getStateAtomic());
  ok('pump initial: not active', s && s.active === false, s && `units=${JSON.stringify(s.requestingUnits)}`);
  const seq0 = (s && s.pumpSeq) || 0;

  // طلب من 3 وحدات
  await CentralPumpDB.setPumpRequest('plant-bed-01', true);
  await CentralPumpDB.setPumpRequest('plant-bed-02', true);
  const s2 = await CentralPumpDB.setPumpRequest('plant-bed-03', true);
  ok('pump after 3 requests: active=true', s2 && s2.active === true);
  ok('pump after 3 requests: 3 units', s2 && s2.requestingUnits.length === 3,
     `units=${JSON.stringify(s2 && s2.requestingUnits)}`);
  ok('pump_seq monotonic increase', s2 && s2.pumpSeq > seq0,
     `seq0=${seq0} → seq2=${s2 && s2.pumpSeq}`);

  // تحرير 2، يجب أن يبقى ON
  await CentralPumpDB.setPumpRequest('plant-bed-01', false);
  const s3 = await CentralPumpDB.setPumpRequest('plant-bed-02', false);
  ok('pump after 2 releases: still active (1 left)', s3 && s3.active === true,
     `units=${JSON.stringify(s3 && s3.requestingUnits)}`);

  // تحرير الأخير
  const s4 = await CentralPumpDB.setPumpRequest('plant-bed-03', false);
  ok('pump after final release: off', s4 && s4.active === false);

  // idempotency: تحرير وحدة غير موجودة لا يجب أن يفشل
  const s5 = await tryAsync('pump idempotent release', () =>
    CentralPumpDB.setPumpRequest('plant-bed-08', false));
  ok('pump idempotent release: no-op safe', s5 && s5.active === false);
}

async function main() {
  log('Supabase verification — climate + irrigation');

  if (!isAvailable()) {
    log('\n⚠️  Supabase env vars غير معرّفة (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    log('    لا يمكن إجراء التحقق. أضفها للـ .env أو متغيرات البيئة.');
    process.exit(2);
  }

  log('Supabase URL =', process.env.SUPABASE_URL);

  await verifyClimate();
  await verifyIrrigation();

  log('\n=========================================');
  log(`Result: ${pass} passed, ${fail} failed, ${warn} warnings`);
  log('=========================================\n');

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('VERIFY CRASHED:', e);
  process.exit(2);
});
