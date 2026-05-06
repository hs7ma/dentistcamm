function init(wss, io) {
  const config = require('../config');
  const climateService = require('../services/climate.service');
  const irrigationService = require('../services/irrigation.service');
  const pumpService = require('../services/pump.service');
  const { broadcastStateUpdate, broadcastIrrigationUpdate } = require('./broadcaster');
  const { UnitStateDB, IrrigationDB, ClimateDB } = require('../db');
  const { isAvailable } = require('../db/supabase');

  const CENTRAL_PUMP_UNIT_ID = config.irrigation.centralPumpUnitId;

  wss.on('connection', (ws, req) => {
    console.log('[Native WS] New ESP32 Hardware connection established');
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    let isAuthenticated = false;
    let deviceId = null;

    ws.on('message', async (message) => {
      try {
        const payload = JSON.parse(message.toString());

        if (!isAuthenticated) {
          if (payload.token === config.esp32.socketSecretToken) {
            isAuthenticated = true;
            deviceId = payload.device ?? payload.deviceId ?? null;
            ws.deviceId = deviceId;
            const isIrrigation = deviceId && deviceId.startsWith('plant-bed-');
            console.log(`[Native WS] ESP32 Authenticated: ${deviceId || 'climate'} (${isIrrigation ? 'irrigation' : 'climate'})`);

            if (isIrrigation) {
              const unit = irrigationService.getOrCreateUnit(deviceId);
              unit.sensorData.connected = true;
              const compactControl = irrigationService.buildCompactControl(null, unit);
              ws.send(JSON.stringify({ type: 'irrigation_state', data: { unitId: unit.unitId, control: compactControl } }));
            } else {
              ws.send(JSON.stringify({ type: 'full_state', relays: climateService.relayState }));
            }
            return;
          } else {
            console.log('[Native WS] Authentication failed. Disconnecting.');
            ws.close(1008, 'Unauthorized');
            return;
          }
        }

        if (payload.type === 'heartbeat' || payload.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (payload.type === 'get_state') {
          const stateDeviceId = payload.device || payload.deviceId;
          if (stateDeviceId && stateDeviceId.startsWith('plant-bed-')) {
            const unit = irrigationService.getOrCreateUnit(stateDeviceId);
            const compactControl = irrigationService.buildCompactControl(null, unit);
            ws.send(JSON.stringify({ type: 'irrigation_state', data: { unitId: unit.unitId, control: compactControl } }));
          }
          return;
        }

        if (payload.type === 'get_pump_state') {
          try {
            pumpService.invalidatePumpCache();
            const pumpStatus = await pumpService.getCentralPumpStatus();
            ws.send(JSON.stringify({
              type: 'irrigation_state',
              data: {
                unitId: CENTRAL_PUMP_UNIT_ID,
                centralPumpShouldRun: pumpStatus.active,
                pumpSeq: pumpStatus.pumpSeq || 0,
                source: 'poll',
              },
            }));
          } catch (err) {
            console.error('[WS] Error handling get_pump_state:', err.message);
          }
          return;
        }

        if (payload.type === 'sensor_data') {
          const sensorDeviceId = payload.device || payload.deviceId;
          const isIrrigationUnit = sensorDeviceId && sensorDeviceId.startsWith('plant-bed-');

          if (isIrrigationUnit) {
            const data = payload.data || payload;
            const unit = irrigationService.getOrCreateUnit(sensorDeviceId);
            if (typeof data.soilMoisture === 'number') unit.sensorData.soilMoisture = data.soilMoisture;
            if (typeof data.waterFlow === 'number') unit.sensorData.waterFlow = data.waterFlow;
            if (typeof data.totalWaterConsumed === 'number') unit.sensorData.totalWaterConsumed = data.totalWaterConsumed;

            if (typeof data.irrigationActive === 'boolean') {
              const overrideActive = unit._irrigationOverrideUntil && Date.now() < unit._irrigationOverrideUntil;
              if (overrideActive && data.irrigationActive !== unit.sensorData.irrigationActive) {
                // ignore stale value
              } else {
                unit.sensorData.irrigationActive = data.irrigationActive;
                if (overrideActive) {
                  delete unit._irrigationOverrideUntil;
                  delete unit.control.manualIrrigationToggle;
                }
              }
            }
            if (data.currentMode !== undefined) unit.sensorData.currentMode = data.currentMode;
            if (typeof data.pumpRequested === 'boolean') unit.sensorData.pumpRequested = data.pumpRequested;
            unit.sensorData.updatedAt = new Date().toISOString();
            unit.sensorData.connected = true;

            await irrigationService.handleImmediateIrrigationCompletion(sensorDeviceId, { currentMode: data.currentMode, irrigationActive: data.irrigationActive });

            if (isAvailable()) {
              UnitStateDB.updateSensorData(sensorDeviceId, {
                soilMoisture: data.soilMoisture,
                waterFlow: data.waterFlow,
                totalWaterConsumed: data.totalWaterConsumed,
                irrigationActive: data.irrigationActive,
                currentMode: data.currentMode,
              }).catch((err) => {
                console.error('[Supabase] Failed to save unit state:', err.message);
              });
              IrrigationDB.saveReading(sensorDeviceId, {
                soilMoisture: data.soilMoisture,
                waterFlow: data.waterFlow,
                totalWaterConsumed: data.totalWaterConsumed,
                irrigationActive: data.irrigationActive,
                currentMode: data.currentMode,
              }).catch((err) => {
                console.error('[Supabase] Failed to save irrigation reading:', err.message);
              });
            }

            broadcastIrrigationUpdate(sensorDeviceId);
          } else {
            const validSensor = typeof payload.temperature === 'number' && typeof payload.humidity === 'number' && payload.sensorOk !== false;
            if (validSensor) {
              climateService.updateSensorState({ temperature: payload.temperature, humidity: payload.humidity, deviceId: payload.deviceId, switches: payload.switches });
            }
            if (!climateService.isManualMode() && validSensor) {
              climateService.applyAutoRules();
            }
            if (isAvailable() && payload.deviceId && validSensor) {
              ClimateDB.saveReading(payload.deviceId, payload.temperature, payload.humidity).catch((err) => {
                console.error('[Supabase] Failed to save climate reading:', err.message);
              });
            }
            broadcastStateUpdate();
            if (validSensor && !climateService.isManualMode()) {
              climateService.scheduleBroadcastRelaysToESP32((() => {
                const broadcaster = require('./broadcaster');
                return () => broadcaster.broadcastRelaysToESP32(wss);
              })());
            }
          }
          return;
        }

        if (payload.type === 'pump_request') {
          const unitId = ws.deviceId || payload.device;
          const action = payload.action;
          if (!unitId) return;
          const requested = action === 'request';
          const pumpStatus = await pumpService.setUnitPumpRequest(unitId, requested);
          pumpService.notifyCentralPump(pumpStatus, 'ws_pump_request', wss);
          broadcastIrrigationUpdate('central-pump');
        }
      } catch (err) {
        console.error('[Native WS] Message parsing error:', err.message);
      }
    });

    ws.on('close', async () => {
      console.log(`[Native WS] ESP32 disconnected: ${deviceId || 'unknown'}`);
      try {
        if (deviceId && deviceId.startsWith('plant-bed-') && irrigationService.plantBedUnits[deviceId]) {
          const unit = irrigationService.plantBedUnits[deviceId];
          const wasPumpRequested = unit.sensorData.pumpRequested;
          unit.sensorData.connected = false;

          if (wasPumpRequested) {
            try {
              const pumpStatus = await pumpService.setUnitPumpRequest(deviceId, false);
              pumpService.notifyCentralPump(pumpStatus, 'unit_disconnect', wss);
            } catch (err) {
              console.error('[WS] Error clearing pump on disconnect:', err.message);
            }
          }
          broadcastIrrigationUpdate(deviceId);
        }
      } catch (err) {
        console.error('[WS] Error in close handler:', err.message);
      }
    });

    ws.on('error', (err) => {
      console.error('[Native WS] Socket error:', err.message);
    });
  });

  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 25000);

  wss.on('close', () => clearInterval(pingInterval));
}

module.exports = { init };