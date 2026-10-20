// Antigravity Local Agent Engine - Central Server Daemon (HTTP + WebSocket)
// Authenticated companion service bridging the browser extension with local computer tools

require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const PermissionManager = require('./security/permissions');
const AuditLogger = require('./security/audit');
const EmergencyCoordinator = require('./security/emergency');
const ToolRegistry = require('./tools');
const MemoryManager = require('./agent/memory');
const AgentOrchestrator = require('./agent/orchestrator');

// Load configuration
const configPath = path.join(__dirname, '..', 'config.json');
let config = {
  port: 3721,
  authToken: 'agy_local_secret_token_default',
  approvedDirectories: [process.cwd()],
  approvedApplications: ['code', 'notepad', 'calc', 'git']
};

try {
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = { ...config, ...JSON.parse(raw) };
  }
} catch (e) {
  console.warn('[Server] Using default configuration');
}

const PORT = parseInt(process.env.ENGINE_PORT || config.port, 10) || 3721;
const AUTH_TOKEN = process.env.ENGINE_AUTH_TOKEN || config.authToken || 'agy_local_secret_token_default';

// Initialize Security, Storage & Execution Core
const permissionManager = new PermissionManager(config);
const auditLogger = new AuditLogger();
const emergencyCoordinator = new EmergencyCoordinator(permissionManager, auditLogger);
const memoryManager = new MemoryManager();

// Server context for browser bridge
let extensionClient = null;
const serverContext = {
  getExtensionClient: () => extensionClient
};

const toolRegistry = new ToolRegistry(
  permissionManager,
  auditLogger,
  emergencyCoordinator,
  serverContext
);

const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, config);

// Initialize Express App
const app = express();
app.use(cors());
app.use(express.json());

// Token Authentication Middleware for HTTP
function authenticateHttp(req, res, next) {
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token;
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : queryToken;

  if (token && token === AUTH_TOKEN) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized: Invalid Antigravity security token' });
}

// REST Endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    version: '1.0.0',
    port: PORT,
    extensionConnected: extensionClient !== null && extensionClient.readyState === 1,
    approvedDirectories: permissionManager.approvedDirectories,
    toolsCount: toolRegistry.tools.size
  });
});

app.get('/audit', authenticateHttp, (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json({
    entries: auditLogger.getRecentEntries(limit)
  });
});

app.post('/emergency-stop', authenticateHttp, async (req, res) => {
  const result = await emergencyCoordinator.emergencyStop();
  res.json(result);
});

app.post('/task', authenticateHttp, async (req, res) => {
  const { task, provider } = req.body;
  if (!task) return res.status(400).json({ error: 'Task is required' });

  const abortController = emergencyCoordinator.createAbortController();
  try {
    const result = await orchestrator.runTask({
      task,
      providerName: provider || config.activeProvider,
      context: req.body.context || {},
      abortSignal: abortController.signal
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    emergencyCoordinator.removeAbortController(abortController);
  }
});

// Create HTTP Server & WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// WebSocket Upgrade & Authentication
server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token');

    if (token !== AUTH_TOKEN) {
      console.warn(`[Server] Rejected unauthorized WS connection from ${request.socket.remoteAddress}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } catch (err) {
    socket.destroy();
  }
});

// WebSocket Connection Handling
wss.on('connection', (ws, req) => {
  console.log(`[Server] Antigravity Extension connected from ${req.socket.remoteAddress}`);

  // Set as active extension bridge
  extensionClient = ws;

  ws.send(JSON.stringify({
    type: 'ENGINE_STATUS',
    connected: true,
    port: PORT,
    message: 'Connected to Antigravity Local Agent Engine'
  }));

  let currentTaskAbort = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'CLIENT_REGISTER':
          console.log(`[Server] Client registered: ${msg.role || 'client'} v${msg.version || '1.0'}`);
          break;

        case 'BROWSER_ACTION_RESPONSE':
          toolRegistry.browserTool.handleActionResponse(msg);
          break;

        case 'APPROVAL_RESPONSE':
          try {
            permissionManager.resolveApproval(msg.approvalId, msg.approved);
          } catch (e) {
            console.warn('[Server] Approval resolution error:', e.message);
          }
          break;

        case 'EMERGENCY_STOP':
          console.warn('[Server] Received Emergency Stop signal from Extension');
          await emergencyCoordinator.emergencyStop();
          ws.send(JSON.stringify({
            type: 'TASK_COMPLETE',
            summary: '🛑 Execution halted immediately by Emergency Stop.'
          }));
          break;

        case 'USER_TASK': {
          currentTaskAbort = emergencyCoordinator.createAbortController();
          try {
            await orchestrator.runTask({
              task: msg.task,
              providerName: msg.provider || config.activeProvider || 'fallback',
              context: msg.context || {},
              clientWs: ws,
              abortSignal: currentTaskAbort.signal
            });
          } catch (taskErr) {
            ws.send(JSON.stringify({
              type: 'AGENT_MESSAGE',
              message: `❌ Task Error: ${taskErr.message}`
            }));
          } finally {
            if (currentTaskAbort) {
              emergencyCoordinator.removeAbortController(currentTaskAbort);
              currentTaskAbort = null;
            }
          }
          break;
        }

        case 'PING':
          ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
          break;

        default:
          console.warn('[Server] Unrecognized WS message type:', msg.type);
      }
    } catch (err) {
      console.error('[Server] Message handling error:', err);
    }
  });

  ws.on('close', () => {
    console.log('[Server] Extension client disconnected');
    if (extensionClient === ws) {
      extensionClient = null;
    }
    if (currentTaskAbort) {
      emergencyCoordinator.removeAbortController(currentTaskAbort);
      currentTaskAbort = null;
    }
  });

  ws.on('error', (err) => {
    console.error('[Server] WS Error:', err);
  });
});

// Start listening
server.listen(PORT, () => {
  console.log(`
==========================================================
   🚀 ANTIGRAVITY LOCAL AGENT ENGINE ONLINE
==========================================================
   Port:            ${PORT}
   WebSocket:       ws://localhost:${PORT}?token=***
   Health Endpoint: http://localhost:${PORT}/health
   Approved Scope:  ${permissionManager.approvedDirectories.join(', ')}
   Active Provider: ${config.activeProvider}
==========================================================
`);
});

// Handle graceful exit
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down Local Agent Engine...');
  await emergencyCoordinator.emergencyStop();
  server.close(() => {
    console.log('[Server] Engine stopped cleanly.');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  await emergencyCoordinator.emergencyStop();
  process.exit(0);
});
