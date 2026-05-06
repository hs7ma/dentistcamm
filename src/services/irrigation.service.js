const config = require('../config');
const { UnitStateDB, IrrigationDB } = require('../db');
const { isAvailable } = require('../db/supabase');

const CENTRAL_PUMP_UNIT_ID = config.irrigation.centralPumpUnitId;
const UNIT_CONNECTION_TIMEOUT_MS = config.esp32.unitConnectionTimeoutMs;

const plantBedUnits = {};

const _unitLocks = new Map();

const _manualToggleTimers = new Map();
const _resetWaterTimers = new Map();

async function withUnitLock(unitId, fn) {
  const prev = _unitLocks.get(unitId) || Promise.resolve();
  let done;
  const next = new Promise(r => { done = r; });
  _unitLocks.set(unitId, next);
  try {
    await prev;
    return await fn();
  } finally {
    done();
    if (_unitLocks.get(unitId) === next) {
      _unitLocks.delete(unitId);
    }
  }
}

const cache = {
  units: {},
};

function getCached(cacheEntry) {
  if (cacheEntry.data && (Date.now() - cacheEntry.timestamp) < config.cache.ttlMs) {
    return cacheEntry.data;
  }
  return null;
}

function setCache(cacheEntry, data) {
  cacheEntry.data = data;
  cacheEntry.timestamp = Date.now();
}

function invalidateUnitCache(unitId) {
  if (cache.units[unitId]) {
    cache.units[unitId].timestamp = 0;
  }
}

function getOrCreateUnit(unitId) {
  if (!plantBedUnits[unitId]) {
    plantBedUnits[unitId] = {
      unitId,
      _irrigationOverrideUntil: null,
      sensorData: {
        soilMoisture: null,
        waterFlow: null,
        totalWaterConsumed: 0,
        irrigationActive: false,
        currentMode: 0,
        updatedAt: null,
        connected: false,
      },
      settings: { ...config.irrigation.defaultSettings },
      control: { ...config.irrigation.defaultControl },
    };
    delete plantBedUnits[unitId].control.manualIrrigationToggle;
    delete plantBedUnits[unitId].control.resetTotalWater;
  }
  return plantBedUnits[unitId];
}

function checkUnitConnection(unitId) {
  const unit = plantBedUnits[unitId];
  if (!unit || !unit.sensorData.updatedAt) {
    if (unit) unit.sensorData.connected = false;
    return;
  }
  const lastUpdateTime = new Date(unit.sensorData.updatedAt).getTime();
  const now = Date.now();
  const timeSinceLastUpdate = now - lastUpdateTime;
  unit.sensorData.connected = timeSinceLastUpdate < UNIT_CONNECTION_TIMEOUT_MS;
}

async function getOrCreateUnitAsync(unitId) {
  if (!cache.units[unitId]) {
    cache.units[unitId] = { data: null, timestamp: 0 };
  }
  const cached = getCached(cache.units[unitId]);
  if (cached) return cached;

  const localUnit = getOrCreateUnit(unitId);

  if (isAvailable()) {
    try {
      const dbUnit = await UnitStateDB.getOrCreate(unitId);
      if (dbUnit) {
        if (dbUnit.sensorData) {
          for (const [key, val] of Object.entries(dbUnit.sensorData)) {
            if (val !== null && val !== undefined) {
              localUnit.sensorData[key] = val;
            }
          }
        }
        if (dbUnit.control) {
          for (const [key, val] of Object.entries(dbUnit.control)) {
            if (val !== null && val !== undefined) {
              localUnit.control[key] = val;
            }
          }
        }
      }
    } catch (err) {
      console.error(`[UnitState] DB error for ${unitId}:`, err.message);
    }
  }

  setCache(cache.units[unitId], localUnit);
  return localUnit;
}

async function checkUnitConnectionAsync(unitId) {
  if (isAvailable()) {
    try {
      const connected = await UnitStateDB.checkConnection(unitId, UNIT_CONNECTION_TIMEOUT_MS);
      const unit = plantBedUnits[unitId];
      if (unit) {
        unit.sensorData.connected = connected;
      }
      return connected;
    } catch (err) {
      console.error(`[UnitState] Connection check error for ${unitId}:`, err.message);
    }
  }
  checkUnitConnection(unitId);
  return plantBedUnits[unitId]?.sensorData?.connected ?? false;
}

async function updateUnitSensorDataAsync(unitId, sensorData) {
  const unit = getOrCreateUnit(unitId);
  Object.assign(unit.sensorData, sensorData);
  unit.sensorData.updatedAt = new Date().toISOString();
  unit.sensorData.connected = true;

  if (isAvailable()) {
    UnitStateDB.updateSensorData(unitId, sensorData).catch((err) => {
      console.error(`[UnitState] DB update error for ${unitId}:`, err.message);
    });
  }

  invalidateUnitCache(unitId);
  return unit;
}

async function updateUnitControlAsync(unitId, control) {
  const unit = getOrCreateUnit(unitId);
  Object.assign(unit.control, control);

  if (isAvailable()) {
    try {
      await UnitStateDB.updateControl(unitId, control);
    } catch (err) {
      console.error(`[UnitState] DB control update error for ${unitId}:`, err.message);
    }
  }

  invalidateUnitCache(unitId);
  return unit;
}

async function applyUnitControl(unitId, changes, source = 'rest') {
  return withUnitLock(unitId, async () => {
    const unit = getOrCreateUnit(unitId);

  const {
    irrigationMode,
    quantitativeValue,
    quantitativeSchedule,
    quantitativeInterval,
    quantitativeDailyHour,
    quantitativeDailyMinute,
    temporalValue,
    temporalSchedule,
    temporalInterval,
    temporalDailyHour,
    temporalDailyMinute,
    moistureThreshold,
    moistureCheckInterval,
    moistureIrrigationType,
    moistureIrrigationValue,
    manualIrrigationToggle,
    manualPump,
    manualValveOpen,
    manualValveClose,
    enableTimeWindow,
    allowedStartHour,
    allowedEndHour,
    enableDailyLimit,
    maxSessionsPerDay,
    enableMinInterval,
    minIntervalMinutes,
    enableDailyConsumption,
    maxLitersPerDay,
    enableMoistureSkip,
    skipIfMoistureAbove,
    enableLeakDetection,
    enableBlockageDetection,
    expectedFlowRate,
    resetTotalWater,
  } = changes;

  if (irrigationMode !== undefined) {
    if (!['quantitative', 'temporal', 'moisture', 'manual', 'off'].includes(irrigationMode)) {
      const error = new Error('"irrigationMode" must be one of: quantitative, temporal, moisture, manual, off');
      error.statusCode = 400;
      throw error;
    }
    const previousMode = unit.control.irrigationMode;
    unit.control.irrigationMode = irrigationMode;
    if (irrigationMode === 'off') {
      unit.sensorData.irrigationActive = false;
      unit._irrigationOverrideUntil = Date.now() + 15000;
      try {
        const pumpService = require('./pump.service');
        const pumpStatus = await pumpService.setUnitPumpRequest(unitId, false);
        pumpService.notifyCentralPump(pumpStatus, 'irrigation_off');
      } catch (err) {
        console.error(`[IRRIGATION] Failed to release pump for ${unitId}:`, err.message);
      }
    } else if (previousMode === 'off' || !previousMode) {
      try {
        const pumpService = require('./pump.service');
        const pumpStatus = await pumpService.setUnitPumpRequest(unitId, true);
        pumpService.notifyCentralPump(pumpStatus, 'irrigation_on');
      } catch (err) {
        console.error(`[IRRIGATION] Failed to request pump for ${unitId}:`, err.message);
      }
    }
  }

  if (quantitativeValue !== undefined && Number.isFinite(quantitativeValue)) {
    unit.control.quantitativeValue = quantitativeValue;
  }
  if (quantitativeSchedule !== undefined) {
    if (!['immediate', 'hourly', 'daily'].includes(quantitativeSchedule)) {
      const error = new Error('"quantitativeSchedule" must be "immediate", "hourly", or "daily"');
      error.statusCode = 400;
      throw error;
    }
    unit.control.quantitativeSchedule = quantitativeSchedule;
  }
  if (quantitativeInterval !== undefined && Number.isFinite(quantitativeInterval)) {
    unit.control.quantitativeInterval = quantitativeInterval;
  }
  if (quantitativeDailyHour !== undefined && Number.isInteger(quantitativeDailyHour)) {
    unit.control.quantitativeDailyHour = quantitativeDailyHour;
  }
  if (quantitativeDailyMinute !== undefined && Number.isInteger(quantitativeDailyMinute)) {
    unit.control.quantitativeDailyMinute = quantitativeDailyMinute;
  }

  if (temporalValue !== undefined && Number.isFinite(temporalValue)) {
    unit.control.temporalValue = temporalValue;
  }
  if (temporalSchedule !== undefined) {
    if (!['immediate', 'hourly', 'daily'].includes(temporalSchedule)) {
      const error = new Error('"temporalSchedule" must be "immediate", "hourly", or "daily"');
      error.statusCode = 400;
      throw error;
    }
    unit.control.temporalSchedule = temporalSchedule;
  }
  if (temporalInterval !== undefined && Number.isFinite(temporalInterval)) {
    unit.control.temporalInterval = temporalInterval;
  }
  if (temporalDailyHour !== undefined && Number.isInteger(temporalDailyHour)) {
    unit.control.temporalDailyHour = temporalDailyHour;
  }
  if (temporalDailyMinute !== undefined && Number.isInteger(temporalDailyMinute)) {
    unit.control.temporalDailyMinute = temporalDailyMinute;
  }

  if (moistureThreshold !== undefined && Number.isFinite(moistureThreshold)) {
    unit.control.moistureThreshold = moistureThreshold;
  }
  if (moistureCheckInterval !== undefined && Number.isFinite(moistureCheckInterval)) {
    unit.control.moistureCheckInterval = moistureCheckInterval;
  }
  if (moistureIrrigationType !== undefined) {
    if (!['quantitative', 'temporal'].includes(moistureIrrigationType)) {
      const error = new Error('"moistureIrrigationType" must be "quantitative" or "temporal"');
      error.statusCode = 400;
      throw error;
    }
    unit.control.moistureIrrigationType = moistureIrrigationType;
  }
  if (moistureIrrigationValue !== undefined && Number.isFinite(moistureIrrigationValue)) {
    unit.control.moistureIrrigationValue = moistureIrrigationValue;
  }

  if (manualIrrigationToggle !== undefined) {
    const shouldStart = manualIrrigationToggle === true;
    unit.control.manualIrrigationToggle = shouldStart;
    unit.sensorData.irrigationActive = shouldStart;
    unit._irrigationOverrideUntil = Date.now() + 15000;

    if (shouldStart) {
      unit.control.manualValveOpen = true;
      unit.control.manualValveClose = false;
      unit.control.manualPump = false;
      console.log(`[MANUAL] Unit ${unitId}: Valve opened`);
      try {
        const pumpService = require('./pump.service');
        const pumpStatus = await pumpService.setUnitPumpRequest(unitId, true);
        pumpService.notifyCentralPump(pumpStatus, 'manual_irrigation_on');
      } catch (err) {
        console.error(`[IRRIGATION] Failed to request pump for ${unitId}:`, err.message);
      }
    } else {
      unit.control.manualValveOpen = false;
      unit.control.manualValveClose = true;
      unit.control.manualPump = false;
      console.log(`[MANUAL] Unit ${unitId}: Valve closed`);
      try {
        const pumpService = require('./pump.service');
        const pumpStatus = await pumpService.setUnitPumpRequest(unitId, false);
        pumpService.notifyCentralPump(pumpStatus, 'manual_irrigation_off');
      } catch (err) {
        console.error(`[IRRIGATION] Failed to release pump for ${unitId}:`, err.message);
      }
    }

    if (_manualToggleTimers.has(unitId)) clearTimeout(_manualToggleTimers.get(unitId));
    _manualToggleTimers.set(unitId, setTimeout(() => {
      _manualToggleTimers.delete(unitId);
      delete unit.control.manualIrrigationToggle;
      console.log(`[CLEANUP] Deleted transient manualIrrigationToggle for ${unitId}`);
    }, 30000));
  }

  if (typeof manualPump === 'boolean') {
    unit.control.manualPump = manualPump;
  }
  if (typeof manualValveOpen === 'boolean') {
    unit.control.manualValveOpen = manualValveOpen;
  }
  if (typeof manualValveClose === 'boolean') {
    unit.control.manualValveClose = manualValveClose;
  }

  if (typeof enableTimeWindow === 'boolean') unit.control.enableTimeWindow = enableTimeWindow;
  if (typeof allowedStartHour === 'number' && allowedStartHour >= 0 && allowedStartHour <= 23) {
    unit.control.allowedStartHour = allowedStartHour;
  }
  if (typeof allowedEndHour === 'number' && allowedEndHour >= 0 && allowedEndHour <= 23) {
    unit.control.allowedEndHour = allowedEndHour;
  }
  if (typeof enableDailyLimit === 'boolean') unit.control.enableDailyLimit = enableDailyLimit;
  if (typeof maxSessionsPerDay === 'number' && maxSessionsPerDay > 0) {
    unit.control.maxSessionsPerDay = maxSessionsPerDay;
  }
  if (typeof enableMinInterval === 'boolean') unit.control.enableMinInterval = enableMinInterval;
  if (typeof minIntervalMinutes === 'number' && minIntervalMinutes > 0) {
    unit.control.minIntervalMinutes = minIntervalMinutes;
  }
  if (typeof enableDailyConsumption === 'boolean') unit.control.enableDailyConsumption = enableDailyConsumption;
  if (typeof maxLitersPerDay === 'number' && maxLitersPerDay > 0) {
    unit.control.maxLitersPerDay = maxLitersPerDay;
  }
  if (typeof enableMoistureSkip === 'boolean') unit.control.enableMoistureSkip = enableMoistureSkip;
  if (typeof skipIfMoistureAbove === 'number' && skipIfMoistureAbove >= 0 && skipIfMoistureAbove <= 100) {
    unit.control.skipIfMoistureAbove = skipIfMoistureAbove;
  }
  if (typeof enableLeakDetection === 'boolean') unit.control.enableLeakDetection = enableLeakDetection;
  if (typeof enableBlockageDetection === 'boolean') unit.control.enableBlockageDetection = enableBlockageDetection;
  if (typeof expectedFlowRate === 'number' && expectedFlowRate > 0) {
    unit.control.expectedFlowRate = expectedFlowRate;
  }

  if (resetTotalWater === true) {
    unit.control.resetTotalWater = true;
    unit.sensorData.totalWaterConsumed = 0;
    console.log(`[RESET] Unit ${unitId}: Total water counter reset`);

    if (isAvailable()) {
      IrrigationDB.updateWaterCounters(unitId, 0, unit.sensorData.calculateFlowRate).catch((err) => {
        console.error(`[DB_UPDATE_ERROR] Failed to save totalWater reset for ${unitId}:`, err.message);
      });
    }

    if (_resetWaterTimers.has(unitId)) clearTimeout(_resetWaterTimers.get(unitId));
    _resetWaterTimers.set(unitId, setTimeout(() => {
      _resetWaterTimers.delete(unitId);
      delete unit.control.resetTotalWater;
    }, 10000));
  }

  if (isAvailable()) {
    try {
      await UnitStateDB.updateControl(unitId, unit.control);
    } catch (err) {
      console.error(`[DB_UPDATE_ERROR] Failed to save control data for ${unitId}:`, err.message);
    }
  }

  invalidateUnitCache(unitId);
  return unit;
  });
}

function buildCompactControl(action, unit) {
  const compact = {};
  compact.irrigationMode = unit.control.irrigationMode;

  if (unit.control.manualIrrigationToggle !== undefined) {
    compact.manualIrrigationToggle = unit.control.manualIrrigationToggle;
  }
  if (unit.control.resetTotalWater) {
    compact.resetTotalWater = true;
  }

  const mode = unit.control.irrigationMode;
  if (mode === 'quantitative') {
    compact.quantitativeValue = unit.control.quantitativeValue;
    compact.quantitativeSchedule = unit.control.quantitativeSchedule;
    if (unit.control.quantitativeSchedule === 'hourly') compact.quantitativeInterval = unit.control.quantitativeInterval;
    if (unit.control.quantitativeSchedule === 'daily') {
      compact.quantitativeDailyHour = unit.control.quantitativeDailyHour;
      compact.quantitativeDailyMinute = unit.control.quantitativeDailyMinute;
    }
  } else if (mode === 'temporal') {
    compact.temporalValue = unit.control.temporalValue;
    compact.temporalSchedule = unit.control.temporalSchedule;
    if (unit.control.temporalSchedule === 'hourly') compact.temporalInterval = unit.control.temporalInterval;
    if (unit.control.temporalSchedule === 'daily') {
      compact.temporalDailyHour = unit.control.temporalDailyHour;
      compact.temporalDailyMinute = unit.control.temporalDailyMinute;
    }
  } else if (mode === 'moisture') {
    compact.moistureThreshold = unit.control.moistureThreshold;
    compact.moistureCheckInterval = unit.control.moistureCheckInterval;
    compact.moistureIrrigationType = unit.control.moistureIrrigationType;
    compact.moistureIrrigationValue = unit.control.moistureIrrigationValue;
  }

  return compact;
}

async function handleImmediateIrrigationCompletion(unitId, sensorData) {
  const unit = plantBedUnits[unitId];
  if (!unit) return false;

  const currentMode = sensorData.currentMode;
  const irrigationActive = sensorData.irrigationActive;

  if (currentMode === 0 && irrigationActive === false) {
    const storedMode = unit.control.irrigationMode;
    const isImmediateQuantitative = storedMode === 'quantitative' && unit.control.quantitativeSchedule === 'immediate';
    const isImmediateTemporal = storedMode === 'temporal' && unit.control.temporalSchedule === 'immediate';

    if (isImmediateQuantitative || isImmediateTemporal) {
      unit.control.irrigationMode = 'off';
      unit.sensorData.currentMode = 0;
      console.log(`[SYNC] Unit ${unitId}: Immediate irrigation completed, mode set to 'off'`);

      if (isAvailable()) {
        UnitStateDB.updateControl(unitId, { irrigationMode: 'off' }).catch((err) => {
          console.error('[Supabase] Failed to update unit control:', err.message);
        });
      }
      invalidateUnitCache(unitId);

      try {
        const pumpService = require('./pump.service');
        const pumpStatus = await pumpService.setUnitPumpRequest(unitId, false);
        pumpService.notifyCentralPump(pumpStatus, 'immediate_complete');
      } catch (err) {
        console.error(`[IRRIGATION] Failed to release pump after immediate completion for ${unitId}:`, err.message);
      }

      try {
        const { broadcastIrrigationUpdate } = require('../websocket/broadcaster');
        broadcastIrrigationUpdate(unitId);
      } catch (_) {}

      return true;
    }
  }
  return false;
}

function isSupabaseConnected() {
  return isAvailable();
}

function updateUnitSettings(unitId, settingsData) {
  const unit = getOrCreateUnit(unitId);
  const {
    quantitativeDefault,
    temporalDefault,
    moistureThreshold,
    moistureIrrigationType,
    moistureIrrigationValue,
  } = settingsData;

  if (quantitativeDefault !== undefined) {
    if (!Number.isFinite(quantitativeDefault) || quantitativeDefault <= 0) {
      const error = new Error('"quantitativeDefault" must be a positive number.');
      error.statusCode = 400;
      throw error;
    }
    unit.settings.quantitativeDefault = quantitativeDefault;
  }

  if (temporalDefault !== undefined) {
    if (!Number.isFinite(temporalDefault) || temporalDefault <= 0) {
      const error = new Error('"temporalDefault" must be a positive number.');
      error.statusCode = 400;
      throw error;
    }
    unit.settings.temporalDefault = temporalDefault;
  }

  if (moistureThreshold !== undefined) {
    if (!Number.isFinite(moistureThreshold) || moistureThreshold < 0 || moistureThreshold > 100) {
      const error = new Error('"moistureThreshold" must be a number between 0 and 100.');
      error.statusCode = 400;
      throw error;
    }
    unit.settings.moistureThreshold = moistureThreshold;
  }

  if (moistureIrrigationType !== undefined) {
    if (!['quantitative', 'temporal'].includes(moistureIrrigationType)) {
      const error = new Error('"moistureIrrigationType" must be "quantitative" or "temporal"');
      error.statusCode = 400;
      throw error;
    }
    unit.settings.moistureIrrigationType = moistureIrrigationType;
  }

  if (moistureIrrigationValue !== undefined) {
    if (!Number.isFinite(moistureIrrigationValue) || moistureIrrigationValue <= 0) {
      const error = new Error('"moistureIrrigationValue" must be a positive number.');
      error.statusCode = 400;
      throw error;
    }
    unit.settings.moistureIrrigationValue = moistureIrrigationValue;
  }

  unit.control.quantitativeValue = unit.settings.quantitativeDefault;
  unit.control.temporalValue = unit.settings.temporalDefault;
  unit.control.moistureThreshold = unit.settings.moistureThreshold;
  unit.control.moistureIrrigationType = unit.settings.moistureIrrigationType;
  unit.control.moistureIrrigationValue = unit.settings.moistureIrrigationValue;

  return unit.settings;
}

module.exports = {
  CENTRAL_PUMP_UNIT_ID,
  plantBedUnits,
  getOrCreateUnit,
  checkUnitConnection,
  getOrCreateUnitAsync,
  checkUnitConnectionAsync,
  updateUnitSensorDataAsync,
  updateUnitControlAsync,
  applyUnitControl,
  updateUnitSettings,
  buildCompactControl,
  handleImmediateIrrigationCompletion,
  isSupabaseConnected,
  getCached,
  setCache,
  invalidateUnitCache,
};