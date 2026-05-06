const path = require('path');
const bcrypt = require('bcryptjs');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  port: (() => { const p = parseInt(process.env.PORT, 10); return Number.isFinite(p) ? p : 3000; })(),
  nodeEnv: process.env.NODE_ENV || 'development',

  jwt: {
    secret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production'
      ? (() => { throw new Error('JWT_SECRET must be set in production'); })()
      : 'dev-only-secret-change-in-production'),
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  cors: {
    origins: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
      : undefined,
  },

  esp32: {
    socketSecretToken: process.env.SOCKET_SECRET_TOKEN || (process.env.NODE_ENV === 'production'
      ? (() => { throw new Error('SOCKET_SECRET_TOKEN must be set in production'); })()
      : 'dev-esp32-token-change-in-production'),
    connectionTimeoutMs: 30000,
    unitConnectionTimeoutMs: 30000,
    pumpUnitTimeoutSeconds: 30,
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    passwordHash: (() => {
      const pw = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production'
        ? (() => { throw new Error('ADMIN_PASSWORD must be set in production'); })()
        : 'Admin@2025');
      try {
        return bcrypt.hashSync(pw, 10);
      } catch {
        throw new Error('Failed to hash admin password');
      }
    })(),
  },

  climate: {
    defaultThresholds: {
      fan: {
        type: 'temperature',
        comparison: 'above',
        on: Number.isFinite(parseFloat(process.env.FAN_ON_TEMP)) ? parseFloat(process.env.FAN_ON_TEMP) : 30,
        off: Number.isFinite(parseFloat(process.env.FAN_OFF_TEMP)) ? parseFloat(process.env.FAN_OFF_TEMP) : 28,
        description: 'Fan turns on when temperature exceeds the ON threshold and turns off when it drops below the OFF threshold.',
        unit: '°C',
      },
      heater: {
        type: 'temperature',
        comparison: 'below',
        on: Number.isFinite(parseFloat(process.env.HEATER_ON_TEMP)) ? parseFloat(process.env.HEATER_ON_TEMP) : 20,
        off: Number.isFinite(parseFloat(process.env.HEATER_OFF_TEMP)) ? parseFloat(process.env.HEATER_OFF_TEMP) : 22,
        description: 'Heater turns on when temperature falls below the ON threshold and turns off when it rises above the OFF threshold.',
        unit: '°C',
      },
      pump: {
        type: 'humidity',
        comparison: 'below',
        on: Number.isFinite(parseFloat(process.env.PUMP_ON_HUMIDITY)) ? parseFloat(process.env.PUMP_ON_HUMIDITY) : 40,
        off: Number.isFinite(parseFloat(process.env.PUMP_OFF_HUMIDITY)) ? parseFloat(process.env.PUMP_OFF_HUMIDITY) : 55,
        description: 'Pump turns on when humidity falls below the ON threshold and turns off when it rises above the OFF threshold.',
        unit: '%',
      },
      motor: {
        type: 'temperature',
        comparison: 'above',
        on: Number.isFinite(parseFloat(process.env.MOTOR_OPEN_TEMP)) ? parseFloat(process.env.MOTOR_OPEN_TEMP) : 32,
        off: Number.isFinite(parseFloat(process.env.MOTOR_CLOSE_TEMP)) ? parseFloat(process.env.MOTOR_CLOSE_TEMP) : 30,
        description: 'Door motor opens when temperature exceeds the ON threshold and closes when it drops below the OFF threshold.',
        unit: '°C',
      },
    },
    relayLabels: {
      fan: 'Fan',
      motor: 'Light',
      pump: 'Water Pump',
      heater: 'Heater',
      door: 'Cooling Door',
    },
  },

  irrigation: {
    centralPumpUnitId: 'plant-bed-04',
    defaultSettings: {
      quantitativeDefault: 5.0,
      temporalDefault: 10,
      moistureThreshold: 40.0,
      moistureIrrigationType: 'quantitative',
      moistureIrrigationValue: 5.0,
    },
    defaultControl: {
      irrigationMode: 'off',
      quantitativeValue: 5.0,
      quantitativeSchedule: 'immediate',
      quantitativeInterval: 6,
      quantitativeDailyHour: 6,
      quantitativeDailyMinute: 0,
      temporalValue: 10,
      temporalSchedule: 'immediate',
      temporalInterval: 6,
      temporalDailyHour: 6,
      temporalDailyMinute: 0,
      moistureThreshold: 40.0,
      moistureCheckInterval: 30,
      moistureIrrigationType: 'quantitative',
      moistureIrrigationValue: 5.0,
      manualPump: false,
      manualValveOpen: false,
      manualValveClose: false,
      manualIrrigationToggle: undefined,
      enableTimeWindow: false,
      allowedStartHour: 6,
      allowedEndHour: 20,
      enableDailyLimit: false,
      maxSessionsPerDay: 5,
      enableMinInterval: false,
      minIntervalMinutes: 120,
      enableDailyConsumption: false,
      maxLitersPerDay: 50.0,
      enableMoistureSkip: false,
      skipIfMoistureAbove: 80,
      enableLeakDetection: true,
      enableBlockageDetection: true,
      expectedFlowRate: 10.0,
      resetTotalWater: undefined,
    },
  },

  pump: {
    useRefcount: (process.env.USE_PUMP_REFCOUNT ?? 'true').toLowerCase() !== 'false',
  },

  cache: {
    ttlMs: 5000,
  },

  relay: {
    persistDebounceMs: 500,
    broadcastThrottleMs: 200,
  },
};

module.exports = config;