const express = require('express');
const config = require('../config');
const irrigationService = require('../services/irrigation.service');
const pumpService = require('../services/pump.service');
const { broadcastIrrigationUpdate } = require('../websocket/broadcaster');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const CENTRAL_PUMP_UNIT_ID = config.irrigation.centralPumpUnitId;

router.post('/units/:unitId/sensor', async (req, res, next) => {
  try {
    const { unitId } = req.params;
    const { soilMoisture, waterFlow, totalWaterConsumed, irrigationActive, currentMode } = req.body || {};

    if (typeof soilMoisture !== 'number' || !Number.isFinite(soilMoisture)) {
      const error = new Error('"soilMoisture" must be a finite number.');
      error.statusCode = 400;
      throw error;
    }

    const unit = irrigationService.getOrCreateUnit(unitId);
    unit.sensorData.soilMoisture = soilMoisture;
    unit.sensorData.waterFlow = typeof waterFlow === 'number' ? waterFlow : unit.sensorData.waterFlow;
    unit.sensorData.totalWaterConsumed = typeof totalWaterConsumed === 'number' ? totalWaterConsumed : unit.sensorData.totalWaterConsumed;
    unit.sensorData.irrigationActive = typeof irrigationActive === 'boolean' ? irrigationActive : unit.sensorData.irrigationActive;
    unit.sensorData.currentMode = currentMode !== undefined ? currentMode : unit.sensorData.currentMode;
    unit.sensorData.updatedAt = new Date().toISOString();
    unit.sensorData.connected = true;

    await irrigationService.handleImmediateIrrigationCompletion(unitId, { currentMode, irrigationActive });

    if (irrigationService.isSupabaseConnected()) {
      const { UnitStateDB, IrrigationDB } = require('../db');
      UnitStateDB.updateSensorData(unitId, {
        soilMoisture,
        waterFlow: typeof waterFlow === 'number' ? waterFlow : unit.sensorData.waterFlow,
        totalWaterConsumed: typeof totalWaterConsumed === 'number' ? totalWaterConsumed : unit.sensorData.totalWaterConsumed,
        irrigationActive: typeof irrigationActive === 'boolean' ? irrigationActive : unit.sensorData.irrigationActive,
        currentMode: currentMode !== undefined ? currentMode : unit.sensorData.currentMode,
      }).catch((err) => {
        console.error('[Supabase] Failed to save unit state:', err.message);
      });
      IrrigationDB.saveReading(unitId, {
        soilMoisture,
        waterFlow,
        totalWaterConsumed,
        irrigationActive,
        currentMode,
      }).catch((err) => {
        console.error('[Supabase] Failed to save irrigation reading:', err.message);
      });
    }

    irrigationService.invalidateUnitCache(unitId);

    res.json({
      ok: true,
      unit: { sensorData: unit.sensorData, settings: unit.settings },
    });

    if (typeof broadcastIrrigationUpdate === 'function') {
      broadcastIrrigationUpdate(unitId);
    }
  } catch (error) {
    next(error);
  }
});

router.get('/units/:unitId/control', async (req, res, next) => {
  try {
    const { unitId } = req.params;
    const unit = await irrigationService.getOrCreateUnitAsync(unitId);
    irrigationService.checkUnitConnection(unitId);
    const pumpStatus = await pumpService.getCentralPumpStatus();
    const controlResponse = {
      ...unit.control,
      centralPumpShouldRun: pumpStatus.active,
      isCentralPumpUnit: unitId === CENTRAL_PUMP_UNIT_ID,
    };
    res.json({ ok: true, control: controlResponse });
  } catch (error) {
    next(error);
  }
});

router.put('/units/:unitId/control', async (req, res, next) => {
  try {
    const { unitId } = req.params;
    const unit = await irrigationService.applyUnitControl(unitId, req.body || {}, 'rest_api');
    res.json({ ok: true, control: unit.control });
    if (typeof broadcastIrrigationUpdate === 'function') {
      broadcastIrrigationUpdate(unitId);
    }
  } catch (error) {
    next(error);
  }
});

router.put('/units/:unitId/settings', (req, res, next) => {
  try {
    const { unitId } = req.params;
    const result = irrigationService.updateUnitSettings(unitId, req.body || {});
    res.json({ ok: true, settings: result });
  } catch (error) {
    next(error);
  }
});

router.get('/units/:unitId/status', async (req, res, next) => {
  try {
    const { unitId } = req.params;
    const unit = await irrigationService.getOrCreateUnitAsync(unitId);
    irrigationService.checkUnitConnection(unitId);
    const pumpStatus = await pumpService.getCentralPumpStatus();
    res.json({
      ok: true,
      unit: {
        unitId: unit.unitId,
        sensorData: unit.sensorData,
        settings: unit.settings,
        control: unit.control,
        hasCentralPump: unitId === CENTRAL_PUMP_UNIT_ID,
      },
      centralPump: pumpStatus,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/units', async (_req, res, next) => {
  try {
    const unitsList = Object.values(irrigationService.plantBedUnits).map((unit) => ({
      unitId: unit.unitId,
      connected: unit.sensorData.connected,
      soilMoisture: unit.sensorData.soilMoisture,
      irrigationActive: unit.sensorData.irrigationActive,
      hasCentralPump: unit.unitId === CENTRAL_PUMP_UNIT_ID,
    })).sort((a, b) => a.unitId.localeCompare(b.unitId, undefined, { numeric: true }));
    const pumpStatus = await pumpService.getCentralPumpStatus();
    res.json({ ok: true, units: unitsList, centralPump: pumpStatus });
  } catch (error) {
    next(error);
  }
});

router.get('/central-pump', async (_req, res, next) => {
  try {
    const pumpStatus = await pumpService.getCentralPumpStatus();
    res.json({ ok: true, centralPump: pumpStatus });
  } catch (error) {
    next(error);
  }
});

router.post('/central-pump/request', async (req, res, next) => {
  try {
    const { unitId } = req.body || {};
    if (!unitId) return res.status(400).json({ ok: false, error: 'unitId is required' });
    const pumpStatus = await pumpService.setUnitPumpRequest(unitId, true);
    res.json({ ok: true, centralPump: pumpStatus });
    pumpService.notifyCentralPump(pumpStatus, 'api_request');
    if (typeof broadcastIrrigationUpdate === 'function') broadcastIrrigationUpdate('central-pump');
  } catch (error) {
    next(error);
  }
});

router.post('/central-pump/release', async (req, res, next) => {
  try {
    const { unitId } = req.body || {};
    if (!unitId) return res.status(400).json({ ok: false, error: 'unitId is required' });
    const pumpStatus = await pumpService.setUnitPumpRequest(unitId, false);
    res.json({ ok: true, centralPump: pumpStatus });
    pumpService.notifyCentralPump(pumpStatus, 'api_release');
    if (typeof broadcastIrrigationUpdate === 'function') broadcastIrrigationUpdate('central-pump');
  } catch (error) {
    next(error);
  }
});

router.get('/central-pump/should-run', async (_req, res, next) => {
  try {
    const pumpStatus = await pumpService.getCentralPumpStatus();
    res.json({ ok: true, shouldRun: pumpStatus.active, requestingUnits: pumpStatus.requestingUnits });
  } catch (error) {
    next(error);
  }
});

router.get('/debug/unit/:unitId', authenticateToken, (req, res) => {
  const unit = irrigationService.plantBedUnits[req.params.unitId];
  if (!unit) return res.json({ error: 'unit not found', available: Object.keys(irrigationService.plantBedUnits) });
  res.json({
    unitId: unit.unitId,
    irrigationActive: unit.sensorData.irrigationActive,
    currentMode: unit.sensorData.currentMode,
    connected: unit.sensorData.connected,
    updatedAt: unit.sensorData.updatedAt,
    controlMode: unit.control.irrigationMode,
    manualIrrigationToggle: unit.control.manualIrrigationToggle,
    overrideUntil: unit._irrigationOverrideUntil ? new Date(unit._irrigationOverrideUntil).toISOString() : null,
    overrideSecondsLeft: unit._irrigationOverrideUntil ? Math.round((unit._irrigationOverrideUntil - Date.now()) / 1000) : 0,
  });
});

module.exports = router;