let io = null;

function init(socketIo) {
  io = socketIo;
}

async function broadcastStateUpdate() {
  if (!io) return;
  try {
    const climateService = require('../services/climate.service');
    io.emit('state_update', {
      sensorData: climateService.sensorState,
      relayState: climateService.getRelaySnapshot(),
      setpointConfig: climateService.setpointMode,
      thresholds: climateService.thresholds,
      manualMode: climateService.isManualMode(),
      switches: climateService.sensorState.switches,
    });
  } catch (err) {
    console.error('[Socket.IO] Error broadcasting state update:', err);
  }
}

async function broadcastIrrigationUpdate(sourceUnitId = null) {
  if (!io) return;
  try {
    const config = require('../config');
    const irrigationService = require('../services/irrigation.service');
    const pumpService = require('../services/pump.service');

    const unitsList = Object.values(irrigationService.plantBedUnits).map((unit) => ({
      unitId: unit.unitId,
      connected: unit.sensorData.connected,
      soilMoisture: unit.sensorData.soilMoisture,
      irrigationActive: unit.sensorData.irrigationActive,
      hasCentralPump: unit.unitId === config.irrigation.centralPumpUnitId,
    })).sort((a, b) => a.unitId.localeCompare(b.unitId, undefined, { numeric: true }));

    const pumpStatus = await pumpService.getCentralPumpStatus();

    io.emit('irrigation_summary', {
      units: unitsList,
      centralPump: pumpStatus,
      source: sourceUnitId,
    });

    if (sourceUnitId && sourceUnitId !== 'central-pump') {
      const unit = irrigationService.plantBedUnits[sourceUnitId];
      if (unit) {
        io.emit(`irrigation_unit_${sourceUnitId}`, {
          unit: {
            unitId: unit.unitId,
            sensorData: unit.sensorData,
            settings: unit.settings,
            control: unit.control,
            hasCentralPump: sourceUnitId === config.irrigation.centralPumpUnitId,
          },
          centralPump: pumpStatus,
        });
      }
    }
  } catch (err) {
    console.error('[Socket.IO] Error broadcasting irrigation update:', err);
  }
}

function broadcastRelaysToESP32(wss) {
  if (!wss) return;
  const climateService = require('../services/climate.service');
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      if (client.deviceId && client.deviceId.startsWith('plant-bed-')) return;
      client.send(JSON.stringify({ type: 'full_state', relays: climateService.relayState }));
    }
  });
}

module.exports = { init, broadcastStateUpdate, broadcastIrrigationUpdate, broadcastRelaysToESP32 };