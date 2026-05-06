const config = require('../config');
const { ClimateDB, ClimateSettingsDB } = require('../db');
const { isAvailable } = require('../db/supabase');

const sensorState = {
  temperature: null,
  humidity: null,
  updatedAt: null,
  deviceId: null,
  connected: false,
  switches: {},
  manualMode: false,
};

const thresholds = JSON.parse(JSON.stringify(config.climate.defaultThresholds));

const relayState = Object.keys(config.climate.relayLabels).reduce((acc, relayId) => {
  acc[relayId] = { mode: 'auto', state: false, lastChanged: null };
  return acc;
}, {});

let setpointMode = {
  enabled: false,
  targetTemperature: 25,
  targetHumidity: 60,
  temperatureTolerance: 2,
  humidityTolerance: 5,
};

let climateInitDone = false;

let _persistRelayTimer = null;
let _broadcastRelaysTimer = null;
let _broadcastRelaysLastSent = 0;

function persistRelayState() {
  if (!isAvailable()) return;
  if (_persistRelayTimer) clearTimeout(_persistRelayTimer);
  _persistRelayTimer = setTimeout(() => {
    _persistRelayTimer = null;
    ClimateSettingsDB.saveRelayState(relayState).catch((err) => {
      console.error('[Climate] Failed to persist relay state:', err.message);
    });
  }, config.relay.persistDebounceMs);
}

function scheduleBroadcastRelaysToESP32(broadcastFn) {
  if (typeof broadcastFn !== 'function') return;
  const now = Date.now();
  const elapsed = now - _broadcastRelaysLastSent;
  if (elapsed >= config.relay.broadcastThrottleMs) {
    _broadcastRelaysLastSent = now;
    if (_broadcastRelaysTimer) {
      clearTimeout(_broadcastRelaysTimer);
      _broadcastRelaysTimer = null;
    }
    broadcastFn();
    return;
  }
  if (_broadcastRelaysTimer) clearTimeout(_broadcastRelaysTimer);
  _broadcastRelaysTimer = setTimeout(() => {
    _broadcastRelaysTimer = null;
    _broadcastRelaysLastSent = Date.now();
    broadcastFn();
  }, config.relay.broadcastThrottleMs - elapsed);
}

function updateSensorState({ temperature, humidity, deviceId, switches }) {
  const wasConnected = sensorState.connected;
  sensorState.temperature = typeof temperature === 'number' ? temperature : sensorState.temperature;
  sensorState.humidity = typeof humidity === 'number' ? humidity : sensorState.humidity;
  sensorState.deviceId = deviceId || sensorState.deviceId;
  sensorState.updatedAt = new Date().toISOString();
  sensorState.connected = true;
  if (switches && typeof switches === 'object') {
    sensorState.switches = switches;
    sensorState.manualMode = Object.values(switches).some((v) => v === true);
  }
  if (!wasConnected) {
    console.log('[INFO] ESP32 reconnected');
  }
}

function isManualMode() {
  return sensorState.manualMode === true;
}

function checkESP32Connection() {
  const wasConnected = sensorState.connected;
  if (!sensorState.updatedAt) {
    sensorState.connected = false;
    return;
  }
  const lastUpdateTime = new Date(sensorState.updatedAt).getTime();
  const timeSinceLastUpdate = Date.now() - lastUpdateTime;
  sensorState.connected = timeSinceLastUpdate < config.esp32.connectionTimeoutMs;
  if (wasConnected && !sensorState.connected) {
    console.log('[WARN] ESP32 disconnected - no data received for', Math.floor(timeSinceLastUpdate / 1000), 'seconds');
    Object.keys(relayState).forEach((relayId) => {
      if (relayState[relayId].state) {
        relayState[relayId].state = false;
        relayState[relayId].lastChanged = new Date().toISOString();
      }
    });
    sensorState.switches = {};
    sensorState.manualMode = false;
    persistRelayState();
    try {
      const { broadcastStateUpdate } = require('../websocket/broadcaster');
      broadcastStateUpdate();
    } catch (_) {}
  }
}

function evaluateRelayAutoState(relayId, currentState) {
  const { temperature, humidity } = sensorState;
  const relayThreshold = thresholds[relayId];
  if (!relayThreshold) return currentState;
  const { type, comparison, on, off } = relayThreshold;

  if (type === 'temperature' && typeof temperature === 'number') {
    if (comparison === 'above') {
      return currentState ? temperature > off : temperature >= on;
    }
    if (comparison === 'below') {
      return currentState ? temperature < off : temperature <= on;
    }
  }
  if (type === 'humidity' && typeof humidity === 'number') {
    if (comparison === 'above') {
      return currentState ? humidity > off : humidity >= on;
    }
    if (comparison === 'below') {
      return currentState ? humidity < off : humidity <= on;
    }
  }
  return currentState;
}

function applySetpointRules() {
  const { temperature, humidity } = sensorState;
  const { targetTemperature, targetHumidity, temperatureTolerance, humidityTolerance } = setpointMode;
  let updated = false;

  if (typeof temperature !== 'number' || typeof humidity !== 'number') return updated;

  const tempDiff = temperature - targetTemperature;
  const humDiff = humidity - targetHumidity;

  if (tempDiff > temperatureTolerance) {
    if (relayState.fan && relayState.fan.mode === 'auto' && !relayState.fan.state) {
      relayState.fan.state = true; relayState.fan.lastChanged = new Date().toISOString(); updated = true;
    }
    if (relayState.motor && relayState.motor.mode === 'auto' && !relayState.motor.state) {
      relayState.motor.state = true; relayState.motor.lastChanged = new Date().toISOString(); updated = true;
    }
    if (relayState.pump && relayState.pump.mode === 'auto' && !relayState.pump.state) {
      relayState.pump.state = true; relayState.pump.lastChanged = new Date().toISOString(); updated = true;
    }
    if (relayState.heater && relayState.heater.mode === 'auto' && relayState.heater.state) {
      relayState.heater.state = false; relayState.heater.lastChanged = new Date().toISOString(); updated = true;
    }
  } else if (tempDiff < -temperatureTolerance) {
    if (relayState.heater && relayState.heater.mode === 'auto' && !relayState.heater.state) {
      relayState.heater.state = true; relayState.heater.lastChanged = new Date().toISOString(); updated = true;
    }
    if (relayState.fan && relayState.fan.mode === 'auto' && relayState.fan.state) {
      relayState.fan.state = false; relayState.fan.lastChanged = new Date().toISOString(); updated = true;
    }
    if (relayState.motor && relayState.motor.mode === 'auto' && relayState.motor.state) {
      relayState.motor.state = false; relayState.motor.lastChanged = new Date().toISOString(); updated = true;
    }
    if (relayState.pump && relayState.pump.mode === 'auto' && relayState.pump.state) {
      relayState.pump.state = false; relayState.pump.lastChanged = new Date().toISOString(); updated = true;
    }
  } else {
    if (relayState.fan && relayState.fan.mode === 'auto' && relayState.fan.state) {
      relayState.fan.state = false; relayState.fan.lastChanged = new Date().toISOString(); updated = true;
    }
    if (relayState.heater && relayState.heater.mode === 'auto' && relayState.heater.state) {
      relayState.heater.state = false; relayState.heater.lastChanged = new Date().toISOString(); updated = true;
    }
    if (relayState.motor && relayState.motor.mode === 'auto' && relayState.motor.state) {
      relayState.motor.state = false; relayState.motor.lastChanged = new Date().toISOString(); updated = true;
    }
  }

  if (tempDiff > temperatureTolerance) {
    // Hot: pump stays ON for evaporative cooling (set in lines above)
    // Do not override pump state based on humidity when cooling is needed
  } else if (tempDiff < -temperatureTolerance) {
    if (relayState.pump && relayState.pump.mode === 'auto' && relayState.pump.state) {
      relayState.pump.state = false; relayState.pump.lastChanged = new Date().toISOString(); updated = true;
    }
  } else {
    if (humDiff < -humidityTolerance) {
      if (relayState.pump && relayState.pump.mode === 'auto' && !relayState.pump.state) {
        relayState.pump.state = true; relayState.pump.lastChanged = new Date().toISOString(); updated = true;
      }
    } else if (humDiff > humidityTolerance) {
      if (relayState.pump && relayState.pump.mode === 'auto' && relayState.pump.state) {
        relayState.pump.state = false; relayState.pump.lastChanged = new Date().toISOString(); updated = true;
      }
    }
  }

  return updated;
}

function forceAllRelaysAuto() {
  let updated = false;
  Object.values(relayState).forEach((relay) => {
    if (relay.mode !== 'auto') {
      relay.mode = 'auto';
      relay.lastChanged = new Date().toISOString();
      updated = true;
    }
  });
  if (updated) persistRelayState();
  return updated;
}

function applyAutoRules() {
  if (!sensorState.connected) {
    return false;
  }
  if (sensorState.manualMode) {
    return false;
  }
  if (setpointMode.enabled) {
    const updated = applySetpointRules();
    if (updated) persistRelayState();
    return updated;
  }
  let updated = false;
  Object.entries(relayState).forEach(([relayId, state]) => {
    if (state.mode !== 'auto') return;
    const next = evaluateRelayAutoState(relayId, state.state);
    if (next !== state.state) {
      state.state = next;
      state.lastChanged = new Date().toISOString();
      updated = true;
    }
  });
  if (updated) persistRelayState();
  return updated;
}

function getRelaySnapshot() {
  return Object.entries(relayState).reduce((acc, [relayId, state]) => {
    acc[relayId] = {
      label: config.climate.relayLabels[relayId],
      mode: state.mode,
      state: state.state,
      lastChanged: state.lastChanged,
    };
    return acc;
  }, {});
}

function requireRelay(relayId) {
  if (!relayState[relayId]) {
    const error = new Error(`Unknown relay "${relayId}"`);
    error.statusCode = 404;
    throw error;
  }
  return relayState[relayId];
}

function sanitizeThresholdInput(input) {
  const cleaned = {};
  Object.entries(input || {}).forEach(([relayId, relayThreshold]) => {
    if (!thresholds[relayId]) return;
    const next = {};
    if (relayThreshold && typeof relayThreshold === 'object') {
      if (Object.prototype.hasOwnProperty.call(relayThreshold, 'comparison')) {
        const value = relayThreshold.comparison;
        if (value === 'above' || value === 'below') next.comparison = value;
      }
      if (Object.prototype.hasOwnProperty.call(relayThreshold, 'on')) {
        const value = Number(relayThreshold.on);
        if (Number.isFinite(value)) next.on = value;
      }
      if (Object.prototype.hasOwnProperty.call(relayThreshold, 'off')) {
        const value = Number(relayThreshold.off);
        if (Number.isFinite(value)) next.off = value;
      }
    }
    if (Object.keys(next).length > 0) cleaned[relayId] = next;
  });
  return cleaned;
}

async function initializeClimate(supabaseConnected) {
  if (climateInitDone) return;
  try {
    await initializeSetpointMode();
    const savedRelays = await ClimateSettingsDB.getRelayState();
    if (savedRelays) {
      Object.entries(savedRelays).forEach(([relayId, saved]) => {
        if (relayState[relayId]) {
          relayState[relayId].mode = saved.mode ?? 'auto';
          relayState[relayId].state = saved.state ?? false;
          relayState[relayId].lastChanged = saved.lastChanged ?? null;
        }
      });
      console.log('[Climate] \u2713 Relay state loaded from DB');
    }
    const savedThresholds = await ClimateSettingsDB.getThresholds();
    if (savedThresholds) {
      Object.entries(savedThresholds).forEach(([relayId, saved]) => {
        if (thresholds[relayId]) {
          Object.assign(thresholds[relayId], saved);
        }
      });
      console.log('[Climate] \u2713 Thresholds loaded from DB');
    }
    climateInitDone = true;
  } catch (err) {
    console.error('[Climate] Init error (will retry):', err.message);
  }
}

async function loadSetpointConfig() {
  if (isAvailable()) {
    try {
      const settings = await ClimateSettingsDB.getSettings();
      if (settings) {
        console.log('[Setpoint] Loaded configuration from Supabase');
        return settings;
      }
    } catch (error) {
      console.error('[Setpoint] Error loading from Supabase:', error.message);
    }
  }
  return {
    enabled: false,
    targetTemperature: 25,
    targetHumidity: 60,
    temperatureTolerance: 2,
    humidityTolerance: 5,
  };
}

async function saveSetpointConfig(cfg) {
  if (isAvailable()) {
    try {
      await ClimateSettingsDB.saveSettings(cfg);
      console.log('[Setpoint] Configuration saved to Supabase');
    } catch (error) {
      console.error('[Setpoint] Error saving to Supabase:', error.message);
    }
  }
}

async function initializeSetpointMode() {
  setpointMode = await loadSetpointConfig();
  if (setpointMode.enabled) {
    console.log('[Setpoint] Auto mode is ENABLED with targets:',
      `${setpointMode.targetTemperature}\u00B0C, ${setpointMode.targetHumidity}%`);
  }
}

function getStatus() {
  checkESP32Connection();
  return {
    sensor: sensorState,
    relays: getRelaySnapshot(),
    thresholds,
    setpoint: setpointMode,
    manualMode: sensorState.manualMode,
    switches: sensorState.switches,
    database: {
      connected: isAvailable(),
      type: isAvailable() ? 'supabase' : 'memory',
    },
  };
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['true', '1', 'on', 'yes'].includes(value.toLowerCase().trim());
  return false;
}

module.exports = {
  sensorState,
  relayState,
  thresholds,
  setpointMode,
  get climateInitDone() { return climateInitDone; },
  updateSensorState,
  isManualMode,
  checkESP32Connection,
  evaluateRelayAutoState,
  applySetpointRules,
  forceAllRelaysAuto,
  applyAutoRules,
  getRelaySnapshot,
  requireRelay,
  sanitizeThresholdInput,
  persistRelayState,
  scheduleBroadcastRelaysToESP32,
  initializeClimate,
  saveSetpointConfig,
  getStatus,
  toBoolean,
};