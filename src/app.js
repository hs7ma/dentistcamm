const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Server: SocketIOServer } = require('socket.io');
const WebSocket = require('ws');

const config = require('./config');
const { testConnection, isAvailable, isConfigured } = require('./db/supabase');
const UsersService = require('./services/users.service');
const climateService = require('./services/climate.service');
const irrigationService = require('./services/irrigation.service');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

let wssInstance = null;

async function start() {
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled Promise Rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
    setTimeout(() => process.exit(1), 1000);
  });

  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  const CORS_ORIGINS = config.cors.origins;
  app.use(cors({
    origin: CORS_ORIGINS || (config.nodeEnv === 'production' ? false : true),
  }));
  app.use(express.json({ limit: '32kb' }));

  let supabaseConnected = false;

  let supabaseInitDone = false;
  async function initSupabase() {
    if (supabaseInitDone) return;
    supabaseInitDone = true;
    if (isConfigured()) {
      try {
        const { connected } = await testConnection();
        if (connected) {
          supabaseConnected = true;
          console.log('[Supabase] \u2713 Connected successfully (init middleware)');
        } else {
          console.log('[Supabase] \u2717 Connection failed');
        }
      } catch (err) {
        console.error('[Supabase] Init error:', err.message);
      }
    }
  }

  app.use(async (req, res, next) => {
    if (!supabaseInitDone) {
      await initSupabase();
    }
    if (!climateService.climateInitDone && supabaseConnected) {
      await climateService.initializeClimate(supabaseConnected);
    }
    next();
  });

  UsersService.init();

  const publicDir = path.join(__dirname, '../public');
  app.use(express.static(publicDir));

  app.use(routes);

  app.use(errorHandler);

  setInterval(() => {
    climateService.checkESP32Connection();
  }, 5000);

  setInterval(() => {
    Object.keys(irrigationService.plantBedUnits).forEach((unitId) => {
      irrigationService.checkUnitConnection(unitId);
    });
  }, 5000);

  const server = http.createServer(app);

  const io = new SocketIOServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  wssInstance = new WebSocket.Server({ noServer: true, maxPayload: 2048 });

  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname === '/ws') {
      wssInstance.handleUpgrade(request, socket, head, (ws) => {
        wssInstance.emit('connection', ws, request);
      });
    } else if (pathname.startsWith('/socket.io')) {
      // Socket.IO handles its own upgrades
    } else {
      socket.destroy();
    }
  });

  const broadcaster = require('./websocket/broadcaster');
  broadcaster.init(io);

  const esp32Handler = require('./websocket/esp32.handler');
  esp32Handler.init(wssInstance, io);

  const pumpService = require('./services/pump.service');
  pumpService.setWss(wssInstance);

  const uiHandler = require('./websocket/ui.handler');
  uiHandler.init(io);

  // Make wss accessible for routes that need it
  app.set('wss', wssInstance);
  app.set('io', io);

  server.listen(config.port, async () => {
    console.log('\n' + '='.repeat(60));
    console.log('\uD83D\uDE80 Greenhouse Controller Server v1');
    console.log('='.repeat(60));
    console.log(`\n\u2705 Server is running on port ${config.port}`);
    console.log(`\uD83D\uDD11 Native WS Endpoint: ws://localhost:${config.port}/ws`);
    console.log(`\uD83D\uDD11 Socket.IO Endpoint: ws://localhost:${config.port}`);

    if (isConfigured()) {
      console.log('\n\uD83D\uDD11 Supabase Database:');
      const { connected, error } = await testConnection();
      if (connected) {
        supabaseConnected = true;
        console.log('   \u2192 \u2705 Connected successfully');
        await climateService.initializeClimate(true);
      } else {
        console.log('   \u2192 \u26A0\uFE0F Connection failed:', error);
        console.log('   \u2192 Data will be stored in memory only');
      }
    } else {
      console.log('\n\uD83D\uDD11 Supabase: Not configured - using memory only');
    }

    setInterval(async () => {
      if (isConfigured() && !isAvailable()) {
        const { connected } = await testConnection();
        if (connected) {
          console.log('[Supabase] \u2713 Connection restored');
        }
      }
    }, 60000);

    console.log('\n' + '='.repeat(60));
  });
}

function getWss() {
  return wssInstance;
}

module.exports = { start, getWss };