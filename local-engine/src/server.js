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
const { HybridRouter } = require('./agent/providers');
const OllamaProvider = require('./agent/providers/ollama');

const crypto = require('crypto');

// Load configuration
const configPath = process.env.ENGINE_CONFIG_PATH || path.join(__dirname, '..', 'config.json');
let config = {
  port: 3721,
  host: '127.0.0.1',
  authToken: '',
  approvedDirectories: [process.cwd()],
  approvedApplications: ['code', 'notepad', 'calc', 'git'],
  security: {
    requireApprovalForShell: true,
    requireApprovalForFileWrite: true,
    requireApprovalForFileDelete: true,
    requireApprovalForClipboardRead: true,
    maxShellExecutionTimeoutMs: 45000,
    blockedShellPatterns: [
      'format\\s+[a-zA-Z]:',
      'rmdir\\s+/[sS]\\s+/[qQ]\\s+[cC]:\\\\',
      ':\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:',
      'dd\\s+if='
    ]
  }
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
const HOST = process.env.ENGINE_HOST || config.host || '127.0.0.1';

// Verify loopback isolation (Security Phase 9.1)
if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
  console.warn(`\n⚠️  [SECURITY WARNING] Local Engine is bound to non-loopback host "${HOST}". Ensure network isolation.`);
}

// Token setup: use configured token, or generate secure random token if empty
let AUTH_TOKEN = (process.env.ENGINE_AUTH_TOKEN || config.authToken || '').trim();
if (!AUTH_TOKEN) {
  AUTH_TOKEN = crypto.randomBytes(32).toString('hex');
  console.log(`[Server] Generated secure ephemeral token for session: ${AUTH_TOKEN.slice(0, 8)}...`);
}

// Ephemeral pairing code for first-run pairing and credential recovery (loopback-only)
const PAIRING_CODE = (process.env.ENGINE_PAIRING_CODE || crypto.randomBytes(3).toString('hex')).toUpperCase();

// Helper: Safely mask secret credentials
function maskSecret(str) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.length <= 8) return '••••••••';
  return trimmed.slice(0, 3) + '••••••••' + trimmed.slice(-4);
}

// Helper: Safely persist config.json
function persistConfigFile() {
  try {
    const toSave = {
      port: PORT,
      host: HOST,
      authToken: AUTH_TOKEN,
      activeProvider: config.activeProvider || 'hybrid',
      hybridRoutingPolicy: config.hybridRoutingPolicy || 'balanced',
      ollamaUrl: config.ollamaUrl || 'http://localhost:11434',
      ollamaModel: config.ollamaModel || 'llama3',
      preferLocalOllama: Boolean(config.preferLocalOllama),
      allowFallbackOnMissingCredentials: Boolean(config.allowFallbackOnMissingCredentials),
      approvedDirectories: permissionManager.getApprovedDirectories(),
      approvedApplications: config.approvedApplications || ['code', 'notepad', 'calc', 'git'],
      security: config.security || {
        requireApprovalForShell: true,
        requireApprovalForFileWrite: true,
        requireApprovalForFileDelete: true,
        requireApprovalForClipboardRead: true,
        maxShellExecutionTimeoutMs: 45000,
        blockedShellPatterns: [
          'format\\s+[a-zA-Z]:',
          'rmdir\\s+/[sS]\\s+/[qQ]\\s+[cC]:\\\\',
          ':\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:',
          'dd\\s+if='
        ]
      }
    };
    if (config.geminiApiKey) toSave.geminiApiKey = config.geminiApiKey;
    if (config.anthropicApiKey) toSave.anthropicApiKey = config.anthropicApiKey;
    if (config.openaiApiKey) toSave.openaiApiKey = config.openaiApiKey;

    fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Server] Could not persist config.json:', err.message);
  }
}

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

// Restrict CORS strictly to extension origins and local loopback (Phase 9.6)
const allowedOriginPatterns = [
  /^chrome-extension:\/\//,
  /^moz-extension:\/\//,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow local CLI/scripts/tests with no origin header
    if (!origin) return callback(null, true);
    const isAllowed = allowedOriginPatterns.some(pattern => pattern.test(origin));
    if (isAllowed) {
      return callback(null, true);
    }
    return callback(new Error('CORS policy: Access restricted to authorized extension and local loopback origins.'));
  },
  credentials: true
}));

app.use(express.json({ limit: '2mb' }));

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

// Loopback-only Pairing Endpoint for First-Run and Credential Recovery
app.post('/pair', (req, res) => {
  const remoteIp = req.socket.remoteAddress || '';
  const isLoopback = remoteIp === '127.0.0.1' ||
                     remoteIp === '::1' ||
                     remoteIp === '::ffff:127.0.0.1' ||
                     req.hostname === 'localhost' ||
                     req.hostname === '127.0.0.1';

  if (!isLoopback) {
    return res.status(403).json({ error: 'Pairing is only allowed from local loopback.' });
  }

  const { pairingCode } = req.body || {};
  if (!pairingCode || pairingCode.trim().toUpperCase() !== PAIRING_CODE) {
    auditLogger.log({
      action: 'PAIRING_FAILED',
      status: 'DENIED',
      riskLevel: 'medium',
      params: { ip: remoteIp }
    });
    return res.status(401).json({ error: 'Invalid pairing code' });
  }

  auditLogger.log({
    action: 'PAIRING_SUCCESSFUL',
    status: 'APPROVED',
    riskLevel: 'low',
    params: { ip: remoteIp }
  });

  return res.json({
    success: true,
    token: AUTH_TOKEN,
    port: PORT,
    message: 'Pairing successful. Token retrieved.'
  });
});

// REST Endpoints
// Unauthenticated Health: minimized info to prevent reconnaissance (Phase 9.5)
app.get('/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    version: '1.0.0'
  });
});

// Authenticated engine details
app.get('/engine-info', authenticateHttp, (req, res) => {
  res.json({
    status: 'ONLINE',
    version: '1.0.0',
    port: PORT,
    host: HOST,
    extensionConnected: extensionClient !== null && extensionClient.readyState === 1,
    approvedDirectories: permissionManager.getApprovedDirectories(),
    toolsCount: toolRegistry.tools.size,
    activeProvider: config.activeProvider || 'hybrid',
    hybridRoutingPolicy: config.hybridRoutingPolicy || 'balanced'
  });
});

// Configuration retrieval (Secrets safely masked)
app.get('/config', authenticateHttp, (req, res) => {
  const geminiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || '';
  const anthropicKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
  const openaiKey = config.openaiApiKey || process.env.OPENAI_API_KEY || '';
  const ollamaUrl = config.ollamaUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const ollamaModel = config.ollamaModel || process.env.OLLAMA_MODEL || 'llama3';

  res.json({
    port: PORT,
    host: HOST,
    activeProvider: config.activeProvider || 'hybrid',
    hybridRoutingPolicy: config.hybridRoutingPolicy || 'balanced',
    ollamaUrl,
    ollamaModel,
    preferLocalOllama: Boolean(config.preferLocalOllama),
    allowFallbackOnMissingCredentials: Boolean(config.allowFallbackOnMissingCredentials),
    hasGeminiKey: Boolean(geminiKey),
    geminiApiKey: maskSecret(geminiKey),
    hasAnthropicKey: Boolean(anthropicKey),
    anthropicApiKey: maskSecret(anthropicKey),
    hasOpenaiKey: Boolean(openaiKey),
    openaiApiKey: maskSecret(openaiKey),
    approvedDirectories: permissionManager.getApprovedDirectories(),
    approvedApplications: config.approvedApplications || []
  });
});

// Authenticated Configuration Update
app.post('/config', authenticateHttp, (req, res) => {
  const {
    activeProvider,
    hybridRoutingPolicy,
    geminiApiKey,
    anthropicApiKey,
    openaiApiKey,
    ollamaUrl,
    ollamaModel,
    preferLocalOllama,
    allowFallbackOnMissingCredentials
  } = req.body || {};

  if (activeProvider !== undefined) config.activeProvider = activeProvider;
  if (hybridRoutingPolicy !== undefined) config.hybridRoutingPolicy = hybridRoutingPolicy;
  if (ollamaUrl !== undefined) config.ollamaUrl = ollamaUrl.trim();
  if (ollamaModel !== undefined) config.ollamaModel = ollamaModel.trim();
  if (preferLocalOllama !== undefined) config.preferLocalOllama = Boolean(preferLocalOllama);
  if (allowFallbackOnMissingCredentials !== undefined) {
    config.allowFallbackOnMissingCredentials = Boolean(allowFallbackOnMissingCredentials);
  }

  // Update secret keys only if provided and not masked
  if (geminiApiKey !== undefined && !geminiApiKey.includes('••••')) {
    config.geminiApiKey = geminiApiKey.trim();
  }
  if (anthropicApiKey !== undefined && !anthropicApiKey.includes('••••')) {
    config.anthropicApiKey = anthropicApiKey.trim();
  }
  if (openaiApiKey !== undefined && !openaiApiKey.includes('••••')) {
    config.openaiApiKey = openaiApiKey.trim();
  }

  // Dynamically update orchestrator config
  orchestrator.updateConfig(config);

  // Persist updated configuration
  persistConfigFile();

  auditLogger.log({
    action: 'SETTINGS_CONFIGURED',
    status: 'SUCCESS',
    riskLevel: 'low',
    params: {
      activeProvider: config.activeProvider,
      hybridRoutingPolicy: config.hybridRoutingPolicy,
      hasGemini: Boolean(config.geminiApiKey || process.env.GEMINI_API_KEY),
      hasAnthropic: Boolean(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
      hasOpenai: Boolean(config.openaiApiKey || process.env.OPENAI_API_KEY),
      ollamaUrl: config.ollamaUrl
    }
  });

  return res.json({
    success: true,
    message: 'Configuration updated and applied.',
    activeProvider: config.activeProvider,
    hybridRoutingPolicy: config.hybridRoutingPolicy,
    hasGeminiKey: Boolean(config.geminiApiKey || process.env.GEMINI_API_KEY),
    hasAnthropicKey: Boolean(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    hasOpenaiKey: Boolean(config.openaiApiKey || process.env.OPENAI_API_KEY),
    ollamaUrl: config.ollamaUrl,
    preferLocalOllama: config.preferLocalOllama
  });
});

// Workspaces management (Phase 10.2)
app.get('/workspaces', authenticateHttp, (req, res) => {
  res.json({
    workspaces: permissionManager.getApprovedDirectories()
  });
});

app.post('/workspaces', authenticateHttp, (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ error: 'Directory path is required' });
  try {
    const added = permissionManager.addApprovedDirectory(dirPath);
    persistConfigFile();
    auditLogger.log({
      action: 'WORKSPACE_SCOPE_EXPANDED',
      status: 'APPROVED',
      riskLevel: 'high',
      params: { directory: added }
    });
    res.json({ success: true, added, workspaces: permissionManager.getApprovedDirectories() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/workspaces', authenticateHttp, (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ error: 'Directory path is required' });
  try {
    const removed = permissionManager.removeApprovedDirectory(dirPath);
    persistConfigFile();
    auditLogger.log({
      action: 'WORKSPACE_SCOPE_REDUCED',
      status: 'APPROVED',
      riskLevel: 'medium',
      params: { directory: dirPath, removed }
    });
    res.json({ success: true, removed, workspaces: permissionManager.getApprovedDirectories() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Provider Status Check (without revealing secrets)
app.get('/providers', authenticateHttp, async (req, res) => {
  try {
    const router = new HybridRouter(config);
    const availability = router.getProviderAvailability(config);

    const ollama = new OllamaProvider(availability.ollama.baseUrl, availability.ollama.model);
    const ollamaHealth = await ollama.checkHealth(1200);

    res.json({
      activeProvider: config.activeProvider || 'hybrid',
      routingPolicy: config.hybridRoutingPolicy || 'balanced',
      providers: {
        gemini: { configured: availability.gemini.available, model: availability.gemini.model },
        anthropic: { configured: availability.anthropic.available, model: availability.anthropic.model },
        openai: { configured: availability.openai.available, model: availability.openai.model },
        ollama: {
          configured: true,
          baseUrl: availability.ollama.baseUrl,
          model: availability.ollama.model,
          healthy: ollamaHealth.healthy,
          hasModel: ollamaHealth.hasConfiguredModel || false,
          error: ollamaHealth.error || null
        },
        autonomous: { configured: true, model: 'deterministic-rules' }
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit retrieval
app.get('/audit', authenticateHttp, (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json({
    entries: auditLogger.getRecentEntries(limit)
  });
});

// Audit clear with audit record
app.post('/audit/clear', authenticateHttp, (req, res) => {
  const entry = auditLogger.clearLog(req.body.operator || 'user');
  res.json({ success: true, cleared: true, entry });
});

app.post('/emergency-stop', authenticateHttp, async (req, res) => {
  const result = await emergencyCoordinator.emergencyStop();
  res.json(result);
});

app.post('/task', authenticateHttp, async (req, res) => {
  const { task, provider } = req.body;
  if (!task) return res.status(400).json({ error: 'Task is required' });

  emergencyCoordinator.resetHalt();
  const abortController = emergencyCoordinator.createAbortController();
  try {
    const result = await orchestrator.runTask({
      task,
      providerName: provider || config.activeProvider || 'hybrid',
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
const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

// WebSocket Upgrade & Authentication (Supports both query token and handshake message per Phase 9.4)
server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');

    // If query token provided and incorrect, reject
    if (token && token !== AUTH_TOKEN) {
      console.warn(`[Server] Rejected unauthorized WS connection from ${request.socket.remoteAddress}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Upgrade socket
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.__authenticated = (token === AUTH_TOKEN);
      wss.emit('connection', ws, request);
    });
  } catch (err) {
    socket.destroy();
  }
});

// WebSocket Connection Handling
wss.on('connection', (ws, req) => {
  console.log(`[Server] Antigravity Extension connected from ${req.socket.remoteAddress}`);

  let currentTaskAbort = null;
  let handshakeTimer = null;

  // If not authenticated via query token, require AUTH_HANDSHAKE within 5 seconds
  if (!ws.__authenticated) {
    handshakeTimer = setTimeout(() => {
      if (!ws.__authenticated) {
        console.warn('[Server] WS connection timed out waiting for authentication handshake');
        ws.close(4001, 'Authentication handshake timeout');
      }
    }, 5000);
  } else {
    extensionClient = ws;
    ws.send(JSON.stringify({
      type: 'ENGINE_STATUS',
      connected: true,
      authenticated: true,
      port: PORT,
      message: 'Connected to Antigravity Local Agent Engine'
    }));
  }

  ws.on('message', async (data) => {
    try {
      if (data.length > 2 * 1024 * 1024) {
        ws.send(JSON.stringify({ type: 'ERROR', error: 'Payload too large (max 2MB)' }));
        return;
      }

      const msg = JSON.parse(data.toString());

      // Handle Handshake Authentication Message
      if (msg.type === 'AUTH_HANDSHAKE') {
        if (msg.token === AUTH_TOKEN) {
          ws.__authenticated = true;
          extensionClient = ws;
          if (handshakeTimer) clearTimeout(handshakeTimer);
          ws.send(JSON.stringify({
            type: 'ENGINE_STATUS',
            connected: true,
            authenticated: true,
            port: PORT,
            message: 'Authentication successful. Connected to Local Agent Engine.'
          }));
        } else {
          ws.send(JSON.stringify({ type: 'AUTH_FAILED', error: 'Invalid security token' }));
          ws.close(4003, 'Invalid token');
        }
        return;
      }

      // Block all other messages if unauthenticated
      if (!ws.__authenticated) {
        ws.send(JSON.stringify({ type: 'AUTH_REQUIRED', error: 'Authentication required' }));
        return;
      }

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
            summary: '🛑 Execution halted immediately by Emergency Stop.',
            halted: true,
            success: false
          }));
          break;

        case 'USER_TASK': {
          emergencyCoordinator.resetHalt();
          currentTaskAbort = emergencyCoordinator.createAbortController();
          try {
            await orchestrator.runTask({
              task: msg.task,
              providerName: msg.provider || config.activeProvider || 'hybrid',
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
    if (handshakeTimer) clearTimeout(handshakeTimer);
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
    if (handshakeTimer) clearTimeout(handshakeTimer);
    console.error('[Server] WS Error:', err);
  });
});

// Start listening - strictly bound to loopback HOST (127.0.0.1) unless intentional override
server.listen(PORT, HOST, () => {
  console.log(`
==========================================================
   🚀 ANTIGRAVITY LOCAL AGENT ENGINE ONLINE
==========================================================
   Host:            ${HOST} (Loopback only)
   Port:            ${PORT}
   WebSocket:       ws://${HOST}:${PORT}
   Pairing Code:    ${PAIRING_CODE}
   Health Endpoint: http://${HOST}:${PORT}/health
   Approved Scope:  ${permissionManager.getApprovedDirectories().join(', ')}
   Active Provider: ${config.activeProvider || 'hybrid'}
   Routing Policy:  ${config.hybridRoutingPolicy || 'balanced'}
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

module.exports = {
  app,
  server,
  permissionManager,
  emergencyCoordinator,
  toolRegistry,
  orchestrator,
  config,
  PORT,
  HOST,
  AUTH_TOKEN,
  PAIRING_CODE
};
