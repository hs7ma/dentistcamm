function init(io) {
  const climateService = require('../services/climate.service');
  const irrigationService = require('../services/irrigation.service');
  const pumpService = require('../services/pump.service');
  const { broadcastIrrigationUpdate, broadcastStateUpdate } = require('./broadcaster');
  const { isAvailable } = require('../db/supabase');
  const { UnitStateDB } = require('../db');

  const config = require('../config');
  const CENTRAL_PUMP_UNIT_ID = config.irrigation.centralPumpUnitId;

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] New UI client connected: ${socket.id}`);

    socket.emit('state_update', {
      sensorData: climateService.sensorState,
      relayState: climateService.getRelaySnapshot(),
      setpointConfig: climateService.setpointMode,
      thresholds: climateService.thresholds,
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] UI client disconnected: ${socket.id}`);
    });

    socket.on('irrigation_action', async (payload) => {
      try {
        const { unitId, action } = payload || {};
        if (!unitId || !action) return;

        const unit = await irrigationService.applyUnitControl(unitId, action, 'socket_io');

        if (typeof broadcastIrrigationUpdate === 'function') {
          broadcastIrrigationUpdate(unitId);
        }

        if (unit) {
          const wss = require('../app').getWss();
          if (wss) {
            const WebSocket = require('ws');
            const compactControl = irrigationService.buildCompactControl(null, unit);
            const message = JSON.stringify({
              type: 'irrigation_state',
              data: { unitId: unit.unitId, control: compactControl },
            });
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN && client.deviceId === unitId) {
                client.send(message);
              }
            });
          }
        }

        if (action.resetTotalWater === true) {
          const unit = irrigationService.plantBedUnits[unitId];
          if (unit) {
            delete unit.control.resetTotalWater;
          }
        }
        if (action.manualIrrigationToggle !== undefined) {
          const unit = irrigationService.plantBedUnits[unitId];
          if (unit && unit.control.manualIrrigationToggle !== undefined) {
            setTimeout(() => {
              delete unit.control.manualIrrigationToggle;
              console.log(`[CLEANUP] Deleted transient manualIrrigationToggle for ${unitId}`);
            }, 30000);
          }
        }
      } catch (err) {
        console.error('[Socket.IO] Error handling irrigation_action:', err.message);
      }
    });
  });
}

module.exports = { init };