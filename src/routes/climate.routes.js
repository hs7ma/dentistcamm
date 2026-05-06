const express = require('express');
const config = require('../config');
const climateService = require('../services/climate.service');
const { isAvailable } = require('../db/supabase');
const { ClimateDB, ClimateSettingsDB } = require('../db');

const router = express.Router();

function getBroadcastFns() {
  const broadcaster = require('../websocket/broadcaster');
  return {
    broadcastStateUpdate: broadcaster.broadcastStateUpdate,
    broadcastRelaysToESP32: () => {
      const app = require('../app');
      const wss = app.getWss();
      if (wss) broadcaster.broadcastRelaysToESP32(wss);
    },
  };
}

router.get('/status', (_req, res) => {
  res.json(climateService.getStatus());
});

router.post('/sensor', async (req, res, next) => {
  try {
    const { temperature, humidity, deviceId, switches, sensorOk } = req.body || {};
    const validSensor = typeof temperature === 'number' && typeof humidity === 'number'
      && Number.isFinite(temperature) && Number.isFinite(humidity)
      && sensorOk !== false;

    if (validSensor) {
      climateService.updateSensorState({ temperature, humidity, deviceId, switches });
    }

    if (!climateService.isManualMode() && validSensor) {
      climateService.applyAutoRules();
    }

    if (isAvailable() && deviceId && validSensor) {
      ClimateDB.saveReading(deviceId, temperature, humidity).catch((err) => {
        console.error('[Supabase] Failed to save climate reading:', err.message);
      });
    }

    res.json({
      ok: true,
      sensor: climateService.sensorState,
      relays: climateService.getRelaySnapshot(),
      manualMode: climateService.isManualMode(),
      switches: climateService.sensorState.switches,
    });

    const { broadcastStateUpdate, broadcastRelaysToESP32 } = getBroadcastFns();
    if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate();
    if (validSensor && !climateService.isManualMode()) {
      climateService.scheduleBroadcastRelaysToESP32(broadcastRelaysToESP32);
    }
  } catch (error) {
    next(error);
  }
});

router.get('/relays', (_req, res) => {
  res.json({ relays: climateService.getRelaySnapshot() });
});

router.post('/relays/:relayId', (req, res, next) => {
  try {
    const { relayId } = req.params;
    const targetRelay = climateService.requireRelay(relayId);
    const mode = req.body?.mode || (req.body?.state !== undefined ? 'manual' : undefined);

    if (!mode) {
      const error = new Error('Request must include "mode" or "state".');
      error.statusCode = 400;
      throw error;
    }
    if (!['auto', 'manual'].includes(mode)) {
      const error = new Error('"mode" must be either "auto" or "manual".');
      error.statusCode = 400;
      throw error;
    }
    if (climateService.isManualMode()) {
      const error = new Error('Unit is in physical manual mode. Turn off all physical switches to restore remote control.');
      error.statusCode = 409;
      throw error;
    }
    if (climateService.setpointMode.enabled && mode === 'manual') {
      const error = new Error('\u0648\u0636\u0639 \u0627\u0644\u0642\u064a\u0645 \u0627\u0644\u0645\u0633\u062a\u0647\u062f\u0641\u0629 \u0645\u0641\u0639\u0651\u0644\u061b \u0644\u0627 \u064a\u0645\u0643\u0646 \u0627\u0644\u062a\u062d\u0643\u0645 \u0627\u0644\u064a\u062f\u0648\u064a \u062d\u0627\u0644\u064a\u0627\u064b.');
      error.statusCode = 400;
      throw error;
    }

    if (mode === 'manual') {
      if (req.body?.state === undefined) {
        const error = new Error('Manual mode requires a boolean "state".');
        error.statusCode = 400;
        throw error;
      }
      const desired = climateService.toBoolean(req.body.state);
      if (desired !== targetRelay.state || targetRelay.mode !== 'manual') {
        targetRelay.state = desired;
        targetRelay.mode = 'manual';
        targetRelay.lastChanged = new Date().toISOString();
      }
      climateService.persistRelayState();
    } else {
      if (targetRelay.mode !== 'auto') {
        targetRelay.mode = 'auto';
        targetRelay.lastChanged = new Date().toISOString();
      }
      climateService.applyAutoRules();
      climateService.persistRelayState();
    }

    res.json({
      ok: true,
      relays: climateService.getRelaySnapshot(),
      sensor: climateService.sensorState,
    });

    const { broadcastStateUpdate, broadcastRelaysToESP32 } = getBroadcastFns();
    if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate();
    climateService.scheduleBroadcastRelaysToESP32(broadcastRelaysToESP32);
  } catch (error) {
    next(error);
  }
});

router.put('/thresholds', (req, res, next) => {
  try {
    if (climateService.isManualMode()) {
      const error = new Error('Unit is in physical manual mode. Turn off all physical switches to restore remote control.');
      error.statusCode = 409;
      throw error;
    }
    const cleaned = climateService.sanitizeThresholdInput(req.body);
    if (Object.keys(cleaned).length === 0) {
      const error = new Error('No valid thresholds supplied.');
      error.statusCode = 400;
      throw error;
    }
    const thresholds = climateService.thresholds;
    Object.entries(cleaned).forEach(([relayId, values]) => {
      thresholds[relayId] = { ...thresholds[relayId], ...values };
    });
    if (isAvailable()) {
      ClimateSettingsDB.saveThresholds(thresholds).catch((err) => {
        console.error('[Climate] Failed to persist thresholds:', err.message);
      });
    }
    climateService.applyAutoRules();
    res.json({ ok: true, thresholds, relays: climateService.getRelaySnapshot() });
    const { broadcastStateUpdate, broadcastRelaysToESP32 } = getBroadcastFns();
    if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate();
    climateService.scheduleBroadcastRelaysToESP32(broadcastRelaysToESP32);
  } catch (error) {
    next(error);
  }
});

router.get('/climate/setpoint', (_req, res) => {
  res.json({ ok: true, setpoint: climateService.setpointMode });
});

router.put('/climate/setpoint', async (req, res, next) => {
  try {
    if (climateService.isManualMode()) {
      const error = new Error('Unit is in physical manual mode. Turn off all physical switches to restore remote control.');
      error.statusCode = 409;
      throw error;
    }
    const sm = climateService.setpointMode;
    const { enabled, targetTemperature, targetHumidity, temperatureTolerance, humidityTolerance } = req.body || {};

    if (typeof enabled === 'boolean') {
      const wasEnabled = sm.enabled;
      sm.enabled = enabled;
      if (!wasEnabled && enabled) climateService.forceAllRelaysAuto();
    }
    if (typeof targetTemperature === 'number' && Number.isFinite(targetTemperature)) {
      if (targetTemperature < 0 || targetTemperature > 50) {
        const error = new Error('\u062f\u0631\u062c\u0629 \u0627\u0644\u062d\u0631\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u062a\u0647\u062f\u0641\u0629 \u064a\u062c\u0628 \u0623\u0646 \u062a\u0643\u0648\u0646 \u0628\u064a\u0646 0 \u0648 50');
        error.statusCode = 400;
        throw error;
      }
      sm.targetTemperature = targetTemperature;
    }
    if (typeof targetHumidity === 'number' && Number.isFinite(targetHumidity)) {
      if (targetHumidity < 0 || targetHumidity > 100) {
        const error = new Error('\u0646\u0633\u0628\u0629 \u0627\u0644\u0631\u0637\u0648\u0628\u0629 \u0627\u0644\u0645\u0633\u062a\u0647\u062f\u0641\u0629 \u064a\u062c\u0628 \u0623\u0646 \u062a\u0643\u0648\u0646 \u0628\u064a\u0646 0 \u0648 100%');
        error.statusCode = 400;
        throw error;
      }
      sm.targetHumidity = targetHumidity;
    }
    if (typeof temperatureTolerance === 'number' && Number.isFinite(temperatureTolerance)) {
      if (temperatureTolerance < 0.5 || temperatureTolerance > 10) {
        const error = new Error('\u0647\u0627\u0645\u0634 \u0627\u0644\u062a\u0633\u0627\u0645\u062d \u0644\u0644\u062d\u0631\u0627\u0631\u0629 \u064a\u062c\u0628 \u0623\u0646 \u064a\u0643\u0648\u0646 \u0628\u064a\u0646 0.5 \u0648 10 \u062f\u0631\u062c\u0627\u062a');
        error.statusCode = 400;
        throw error;
      }
      sm.temperatureTolerance = temperatureTolerance;
    }
    if (typeof humidityTolerance === 'number' && Number.isFinite(humidityTolerance)) {
      if (humidityTolerance < 1 || humidityTolerance > 20) {
        const error = new Error('\u0647\u0627\u0645\u0634 \u0627\u0644\u062a\u0633\u0627\u0645\u062d \u0644\u0644\u0631\u0637\u0648\u0628\u0629 \u064a\u062c\u0628 \u0623\u0646 \u064a\u0643\u0648\u0646 \u0628\u064a\u0646 1 \u0648 20%');
        error.statusCode = 400;
        throw error;
      }
      sm.humidityTolerance = humidityTolerance;
    }

    await climateService.saveSetpointConfig(sm);
    climateService.applyAutoRules();

    res.json({ ok: true, setpoint: sm, relays: climateService.getRelaySnapshot() });
    const { broadcastStateUpdate, broadcastRelaysToESP32 } = getBroadcastFns();
    if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate();
    climateService.scheduleBroadcastRelaysToESP32(broadcastRelaysToESP32);
  } catch (error) {
    next(error);
  }
});

module.exports = router;