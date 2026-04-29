require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

// ══════════════════════════════════════════════
//  Config
// ══════════════════════════════════════════════
const PORT = parseInt(process.env.PORT || '8000', 10);
const CAMERA_TOKEN = process.env.CAMERA_TOKEN || 'dev-token';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend', 'dist');

// ══════════════════════════════════════════════
//  State
// ══════════════════════════════════════════════
let cameraWs = null;
const browserClients = new Set();
const FRAME_STREAM = 0x01;
const FRAME_CAPTURE = 0x02;

// ══════════════════════════════════════════════
//  Static frontend
// ══════════════════════════════════════════════
app.use(express.static(FRONTEND_DIR));
app.use(express.json({ limit: '10mb' }));

// ══════════════════════════════════════════════
//  OpenAI proxy
// ══════════════════════════════════════════════
app.post('/api/analyze', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      error: { message: 'OPENAI_API_KEY not configured on server' },
    });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({
      error: { message: `OpenAI unreachable: ${err.message}` },
    });
  }
});

// ══════════════════════════════════════════════
//  Health check
// ══════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    camera: !!cameraWs,
    browsers: browserClients.size,
    uptime: Math.floor(process.uptime()),
  });
});

// ══════════════════════════════════════════════
//  WebSocket relay
// ══════════════════════════════════════════════
const wss = new WebSocketServer({ noServer: true });

// Handle upgrade requests manually for better compatibility with proxies
server.on('upgrade', (request, socket, head) => {
  const parsedUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  console.log(`[WS] Upgrade request: ${pathname} from ${request.headers.host}`);

  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

function broadcastToBrowsers(data, isBinary = false) {
  for (const client of browserClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  }
}

function notifyCameraStatus() {
  broadcastToBrowsers(JSON.stringify({ type: 'camera_status', online: !!cameraWs }));
}

function sendToCamera(msg) {
  if (cameraWs && cameraWs.readyState === WebSocket.OPEN) {
    cameraWs.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
}

wss.on('connection', (ws, req) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const role = parsedUrl.searchParams.get('role');

  console.log(`[WS] Connected: role=${role} from ${req.socket.remoteAddress}`);

  if (role === 'camera') {
    if (cameraWs && cameraWs.readyState === WebSocket.OPEN) {
      cameraWs.close(4000, 'Replaced by new connection');
    }
    cameraWs = ws;
    console.log('[WS] Camera connected');

    if (browserClients.size > 0) {
      ws.send(JSON.stringify({ cmd: 'start_stream' }));
    }

    notifyCameraStatus();

    ws.on('message', (data, isBinary) => {
      if (isBinary && Buffer.isBuffer(data) && data.length > 1) {
        broadcastToBrowsers(data, true);
      } else if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'status') {
            broadcastToBrowsers(data);
          }
        } catch { /* ignore */ }
      }
    });

    ws.on('close', () => {
      if (cameraWs === ws) {
        cameraWs = null;
        console.log('[WS] Camera disconnected');
        notifyCameraStatus();
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] Camera error:', err.message);
    });

  } else {
    browserClients.add(ws);
    console.log(`[WS] Browser connected (${browserClients.size} total)`);

    ws.send(JSON.stringify({ type: 'camera_status', online: !!cameraWs }));

    if (cameraWs && cameraWs.readyState === WebSocket.OPEN) {
      cameraWs.send(JSON.stringify({ cmd: 'start_stream' }));
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      try {
        JSON.parse(data.toString());
        sendToCamera(data.toString());
      } catch { /* ignore */ }
    });

    ws.on('close', () => {
      browserClients.delete(ws);
      console.log(`[WS] Browser disconnected (${browserClients.size} remaining)`);
      if (browserClients.size === 0) {
        sendToCamera({ cmd: 'stop_stream' });
      }
    });
  }
});

// ══════════════════════════════════════════════
//  SPA fallback
// ══════════════════════════════════════════════
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ══════════════════════════════════════════════
//  Start
// ══════════════════════════════════════════════
server.listen(PORT, () => {
  console.log(`[SERVER] DentistCam running on port ${PORT}`);
  console.log(`[SERVER] WebSocket path: /ws`);
  if (OPENAI_API_KEY) {
    console.log('[SERVER] OpenAI: configured');
  } else {
    console.log('[SERVER] OpenAI: NOT configured (set OPENAI_API_KEY)');
  }
  console.log(`[SERVER] Camera token: ${CAMERA_TOKEN.substring(0, 4)}****`);
});