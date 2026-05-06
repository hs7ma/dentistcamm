const WebSocket = require('ws');
const config = require('../config');
const CentralPumpDB = require('../db/pump.db');
const { isAvailable } = require('../db/supabase');
const { plantBedUnits } = require('./irrigation.service');

const USE_PUMP_REFCOUNT = config.pump.useRefcount;
const CENTRAL_PUMP_UNIT_ID = config.irrigation.centralPumpUnitId;
const PUMP_UNIT_TIMEOUT_SECONDS = config.esp32.pumpUnitTimeoutSeconds;

let _wss = null;

function setWss(wss) {
  _wss = wss;
}

console.log(`[CENTRAL_PUMP] Mode: ${USE_PUMP_REFCOUNT ? 'ATOMIC_REFCOUNT (new)' : 'DERIVE_FROM_UNITS (legacy)'}`);

const pumpCache = {
  centralPumpStatus: { data: null, timestamp: 0 },
};

function invalidatePumpCache() {
  pumpCache.centralPumpStatus.timestamp = 0;
}

function getPumpCached() {
  if (pumpCache.centralPumpStatus.data && (Date.now() - pumpCache.centralPumpStatus.timestamp) < config.cache.ttlMs) {
    return pumpCache.centralPumpStatus.data;
  }
  return null;
}

function setPumpCache(data) {
  pumpCache.centralPumpStatus.data = data;
  pumpCache.centralPumpStatus.timestamp = Date.now();
}

async function getCentralPumpStatus() {
  const cached = getPumpCached();
  if (cached) return cached;

  if (USE_PUMP_REFCOUNT && isAvailable()) {
    try {
      const state = await CentralPumpDB.getStateAtomic();
      const result = {
        active: state.active,
        requestingUnits: state.requestingUnits,
        controlledBy: state.controlledBy ?? null,
        pumpSeq: state.pumpSeq ?? 0,
        lastStateChange: state.lastStateChange ?? new Date().toISOString(),
        pumpUnitId: CENTRAL_PUMP_UNIT_ID,
      };
      setPumpCache(result);
      return result;
    } catch (err) {
      console.error('[CENTRAL_PUMP] Atomic getState error:', err.message);
    }
  }

  if (isAvailable()) {
    try {
      const state = await CentralPumpDB.deriveStateFromUnits(PUMP_UNIT_TIMEOUT_SECONDS);
      const result = {
        active: state.active,
        requestingUnits: state.requestingUnits,
        controlledBy: state.controlledBy ?? null,
        pumpSeq: 0,
        lastStateChange: new Date().toISOString(),
        pumpUnitId: CENTRAL_PUMP_UNIT_ID,
      };
      setPumpCache(result);
      return result;
    } catch (err) {
      console.error('[CENTRAL_PUMP] DB derive error:', err.message);
    }
  }

  const requestingUnits = [];
  for (const [unitId, unit] of Object.entries(plantBedUnits)) {
    if (unit.sensorData && unit.sensorData.pumpRequested) {
      requestingUnits.push(unitId);
    }
  }

  const result = {
    active: requestingUnits.length > 0,
    requestingUnits,
    controlledBy: requestingUnits[0] ?? null,
    pumpSeq: 0,
    lastStateChange: new Date().toISOString(),
    pumpUnitId: CENTRAL_PUMP_UNIT_ID,
  };
  setPumpCache(result);
  return result;
}

async function setUnitPumpRequest(unitId, requested) {
  if (!unitId) return null;

  const unit = plantBedUnits[unitId];
  if (unit && unit.sensorData) {
    unit.sensorData.pumpRequested = !!requested;
  }

  let pumpStatus = null;
  if (isAvailable()) {
    try {
      if (USE_PUMP_REFCOUNT) {
        const state = await CentralPumpDB.setPumpRequest(unitId, !!requested);
        if (state) {
          pumpStatus = {
            active: !!state.active,
            requestingUnits: state.requestingUnits ?? [],
            controlledBy: state.controlledBy ?? null,
            pumpSeq: state.pumpSeq ?? 0,
            lastStateChange: state.lastStateChange ?? new Date().toISOString(),
            pumpUnitId: CENTRAL_PUMP_UNIT_ID,
          };
          setPumpCache(pumpStatus);
        }
      } else {
        await CentralPumpDB.updatePumpRequested(unitId, !!requested);
      }
    } catch (err) {
      console.error(`[CENTRAL_PUMP] setUnitPumpRequest(${unitId}, ${requested}) DB error:`, err.message);
    }
  }

  if (!pumpStatus) {
    invalidatePumpCache();
    pumpStatus = await getCentralPumpStatus();
  }
  return pumpStatus;
}

function notifyCentralPump(pumpStatus, reason = 'pump_command', wss) {
  wss = wss || _wss;
  if (!pumpStatus || !wss) return;

  const message = JSON.stringify({
    type: 'irrigation_state',
    data: {
      unitId: CENTRAL_PUMP_UNIT_ID,
      centralPumpShouldRun: !!pumpStatus.active,
      pumpSeq: pumpStatus.pumpSeq ?? 0,
      source: 'pump_command',
      reason,
    }
  });
  let notified = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.deviceId === CENTRAL_PUMP_UNIT_ID) {
      client.send(message);
      notified++;
    }
  });
  if (notified > 0) {
    console.log(`[CENTRAL_PUMP] notify(${reason}) shouldRun=${pumpStatus.active} seq=${pumpStatus.pumpSeq ?? 0} → ${notified} client(s)`);
  }
}

module.exports = {
  getCentralPumpStatus,
  setUnitPumpRequest,
  notifyCentralPump,
  invalidatePumpCache,
  USE_PUMP_REFCOUNT,
  CENTRAL_PUMP_UNIT_ID,
  setWss,
};