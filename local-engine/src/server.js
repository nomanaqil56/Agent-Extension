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
const CredentialVault = require('./security/vault');
const CredentialBroker = require('./security/broker');
const ModelManager = require('./agent/models');

const crypto = require('crypto');

// Configuration paths: public config.json vs untracked local .secrets.json
const configPath = process.env.ENGINE_CONFIG_PATH || path.join(__dirname, '..', 'config.json');
const secretsPath = process.env.ENGINE_SECRETS_PATH || path.join(__dirname, '..', '.secrets.json');

let config = {
  port: 3721,
  host: '127.0.0.1',
  activeProvider: 'hybrid',
  hybridRoutingPolicy: 'balanced',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
  preferLocalOllama: false,
  allowFallbackOnMissingCredentials: false,
  approvedDirectories: [],
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

let secrets = {
  authToken: '',
  geminiApiKey: '',
  anthropicApiKey: '',
  openaiApiKey: ''
};

// Load public configuration
try {
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = { ...config, ...JSON.parse(raw) };
  }
} catch (e) {
  console.warn('[Server] Using default configuration');
}

// Load private secrets
try {
  if (fs.existsSync(secretsPath)) {
    const rawSecrets = fs.readFileSync(secretsPath, 'utf8');
    secrets = { ...secrets, ...JSON.parse(rawSecrets) };
  }
} catch (e) {
  console.warn('[Server] No .secrets.json loaded; will initialize on first secret creation');
}

// Secret Migration: strip secrets out of tracked config.json into untracked .secrets.json
let configNeedsCleaning = false;
['authToken', 'geminiApiKey', 'anthropicApiKey', 'openaiApiKey', 'geminiKey', 'anthropicKey', 'openAiKey', 'openaiKey'].forEach(k => {
  if (config[k]) {
    const canonicalKey = k.toLowerCase().includes('gemini') ? 'geminiApiKey' :
      k.toLowerCase().includes('anthropic') ? 'anthropicApiKey' :
      k.toLowerCase().includes('openai') ? 'openaiApiKey' :
      k === 'authToken' ? 'authToken' : k;
    if (!secrets[canonicalKey]) {
      secrets[canonicalKey] = config[k];
    }
    delete config[k];
    configNeedsCleaning = true;
  }
});

// Helper: Atomically and safely persist a JSON file using a temp file, fsync, and atomic rename
function writeAtomicJsonSync(filePath, data, fileMode = 0o600) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp.${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const serialized = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  let fd = null;
  try {
    fd = fs.openSync(tempPath, 'w', fileMode);
    fs.writeFileSync(fd, serialized, 'utf8');
    try {
      fs.fsyncSync(fd);
    } catch (e) {}
    fs.closeSync(fd);
    fd = null;

    // Platform-safe atomic rename (Windows file lock collisions fallback)
    if (process.platform === 'win32' && fs.existsSync(filePath)) {
      try {
        fs.renameSync(tempPath, filePath);
      } catch (renameErr) {
        try {
          fs.copyFileSync(tempPath, filePath);
          fs.unlinkSync(tempPath);
        } catch (copyErr) {
          throw renameErr;
        }
      }
    } else {
      fs.renameSync(tempPath, filePath);
    }
    return true;
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (e) {}
    }
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
    }
    throw err;
  }
}

// Helper: Safely persist .secrets.json using atomic file persistence
function persistSecretsFile() {
  try {
    writeAtomicJsonSync(secretsPath, secrets, 0o600);
    return true;
  } catch (err) {
    console.warn('[Server] Could not persist .secrets.json:', err.message);
    return false;
  }
}

// Secret Migration: persist private secrets first; only clean config.json after persistence succeeds
if (configNeedsCleaning) {
  const saved = persistSecretsFile();
  if (saved) {
    try {
      writeAtomicJsonSync(configPath, config, 0o644);
    } catch (e) {}
  } else {
    console.warn('[Server] Secret migration aborted: Could not save .secrets.json safely');
  }
}

const PORT = parseInt(process.env.ENGINE_PORT || config.port, 10) || 3721;
const HOST = process.env.ENGINE_HOST || config.host || '127.0.0.1';

// Verify loopback isolation (Security Phase 9.1)
if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
  console.warn(`\n⚠️  [SECURITY WARNING] Local Engine is bound to non-loopback host "${HOST}". Ensure network isolation.`);
}

// Token setup: precedence = process.env -> secrets.authToken -> generate secure random token
let AUTH_TOKEN = (process.env.ENGINE_AUTH_TOKEN || secrets.authToken || '').trim();
if (!AUTH_TOKEN) {
  AUTH_TOKEN = crypto.randomBytes(32).toString('hex');
  secrets.authToken = AUTH_TOKEN;
  persistSecretsFile();
  console.log('[Server] Secure persistent authentication token initialized in .secrets.json.');
}

// Ephemeral pairing state with entropy, 5-minute expiry, lockout, and single-use consumption
const PAIRING_EXPIRY_MS = 5 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;

const pairingState = {
  code: (process.env.ENGINE_PAIRING_CODE || crypto.randomBytes(4).toString('hex')).toUpperCase(),
  createdAt: Date.now(),
  expiresAt: Date.now() + PAIRING_EXPIRY_MS,
  failedAttempts: 0,
  consumed: false
};

const PAIRING_CODE = pairingState.code;

// Helper: Safely mask secret credentials for UI display
function maskSecret(str) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.length <= 8) return '••••••••';
  return trimmed.slice(0, 3) + '••••••••' + trimmed.slice(-4);
}

// Helper: Safely persist config.json (Strictly non-secret configuration only)
function persistConfigFile() {
  try {
    const toSave = {
      port: PORT,
      host: HOST,
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
    writeAtomicJsonSync(configPath, toSave, 0o644);
    return true;
  } catch (err) {
    console.warn('[Server] Could not persist config.json:', err.message);
    return false;
  }
}

// Helper: Rigorous loopback address normalizer and validator (Section 4.1)
function isLoopbackAddress(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const trimmed = ip.trim();
  // Strip IPv4-mapped IPv6 prefix (e.g. ::ffff:127.0.0.1 -> 127.0.0.1)
  const normalized = trimmed.replace(/^::ffff:/i, '');
  if (normalized === '127.0.0.1' || normalized === '::1') return true;
  // Standard IPv4 loopback subnet 127.0.0.0/8
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) {
    const parts = normalized.split('.').map(Number);
    return parts.every(p => p >= 0 && p <= 255);
  }
  return false;
}

// Validate that an HTTP request originated from local loopback (Physical socket check + Host header defense)
function validateLoopbackRequest(req) {
  // CRITICAL: We validate the physical socket remote peer address.
  // Never trust forwarded headers (X-Forwarded-For, X-Real-IP) as proof of loopback!
  const remoteIp = req.socket?.remoteAddress || '';
  if (!isLoopbackAddress(remoteIp)) {
    return {
      valid: false,
      reason: `Remote peer address "${remoteIp}" is not a valid local loopback address.`
    };
  }

  // Host header defense-in-depth: If a Host header is present, ensure it points to local loopback
  const hostHeader = (req.headers.host || '').trim().toLowerCase();
  if (hostHeader) {
    const hostWithoutPort = hostHeader.split(':')[0];
    const isLoopbackHost = hostWithoutPort === 'localhost' ||
                           hostWithoutPort === '127.0.0.1' ||
                           hostWithoutPort === '[::1]' ||
                           hostWithoutPort === HOST.toLowerCase();
    if (!isLoopbackHost) {
      return {
        valid: false,
        reason: `Host header "${hostHeader}" does not match local loopback host.`
      };
    }
  }

  return { valid: true };
}

// Initialize Security, Storage & Execution Core
const permissionManager = new PermissionManager(config);
const auditLogger = new AuditLogger();
const emergencyCoordinator = new EmergencyCoordinator(permissionManager, auditLogger);
const memoryManager = new MemoryManager();
const credentialVault = new CredentialVault();
const credentialBroker = new CredentialBroker(credentialVault, permissionManager, auditLogger);
const modelManager = new ModelManager({ ...config, ...secrets }, credentialVault);

// Server context for browser bridge
let extensionClient = null;
const serverContext = {
  getExtensionClient: () => (extensionClient && extensionClient.readyState === 1 && extensionClient.__authenticated ? extensionClient : null)
};

const toolRegistry = new ToolRegistry(
  permissionManager,
  auditLogger,
  emergencyCoordinator,
  serverContext,
  credentialBroker
);

const orchestrator = new AgentOrchestrator(
  toolRegistry,
  memoryManager,
  { ...config, ...secrets },
  modelManager,
  credentialBroker
);

// Initialize Express App
const app = express();

// Dynamic helper: get current allowed extension IDs from env or runtime config
function getAllowedExtensionIds() {
  if (process.env.ALLOWED_EXTENSION_IDS) {
    return process.env.ALLOWED_EXTENSION_IDS.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (Array.isArray(config.allowedExtensionIds)) {
    return config.allowedExtensionIds.map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// Validate request origin against extension allowlist, loopback origins, and untrusted web origins
function validateRequestOrigin(origin) {
  // Allow local CLI/scripts/tests with no origin header
  if (!origin) return { allowed: true, reason: 'No origin header (CLI/test client)' };

  const lower = origin.toLowerCase().trim();

  // Allow local loopback HTTP origins
  if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(lower) || /^http:\/\/localhost(:\d+)?$/.test(lower)) {
    return { allowed: true, reason: 'Local loopback origin' };
  }

  // Check browser extension origins
  if (lower.startsWith('chrome-extension://') || lower.startsWith('moz-extension://')) {
    // Extract extension ID (strip scheme and trailing path/query/fragment)
    const extId = lower.replace(/^(chrome|moz)-extension:\/\//, '').split('/')[0].split('?')[0].split('#')[0];

    // Reject malformed extension IDs
    if (!extId || !/^[a-z0-9_\-\.\@{}]{4,64}$/i.test(extId)) {
      return {
        allowed: false,
        reason: `CORS policy: Malformed or invalid extension ID in origin "${origin}".`
      };
    }

    const allowed = getAllowedExtensionIds();
    if (allowed.length > 0) {
      if (allowed.includes(extId)) {
        return { allowed: true, reason: 'Allowed extension origin' };
      }
      return {
        allowed: false,
        reason: `CORS policy: Extension origin "${origin}" is not in the allowedExtensionIds list.`
      };
    }

    // In production mode, an empty allowlist must NEVER automatically trust arbitrary extensions
    const isProduction = process.env.NODE_ENV === 'production' || config.environment === 'production';
    if (isProduction) {
      return {
        allowed: false,
        reason: 'CORS policy: In production mode, extension origins must be explicitly configured in allowedExtensionIds.'
      };
    }

    // Safe & documented behavior for empty allowlist in development:
    // When no explicit allowlist is configured in development, extension schemes (chrome-extension://, moz-extension://)
    // are permitted for developer unpack/sideloading convenience, while untrusted web origins remain strictly blocked.
    return { allowed: true, reason: 'Development extension scheme permitted (empty allowlist)' };
  }

  // Explicitly reject all untrusted web origins
  return {
    allowed: false,
    reason: `CORS policy: Access denied for untrusted web origin "${origin}".`
  };
}

// Restrict CORS strictly to extension origins and local loopback (Section 4.3)
app.use(cors({
  origin: (origin, callback) => {
    const check = validateRequestOrigin(origin);
    if (check.allowed) {
      return callback(null, true);
    }
    return callback(new Error(check.reason));
  },
  credentials: true
}));

// Explicit error handler for CORS policy rejections (deliberate 403 Forbidden with structured JSON)
app.use((err, req, res, next) => {
  if (err && err.message && err.message.includes('CORS policy:')) {
    return res.status(403).json({ error: err.message });
  }
  next(err);
});

app.use(express.json({ limit: '2mb' }));

// Token Authentication Middleware for HTTP (Authorization: Bearer <token> or X-Auth-Token)
function authenticateHttp(req, res, next) {
  const authHeader = req.headers.authorization;
  const customHeader = req.headers['x-auth-token'];
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : (customHeader ? customHeader.trim() : null);

  if (token && token === AUTH_TOKEN) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized: Invalid or missing Antigravity security token' });
}

// Loopback-only Pairing Endpoint with Expiry, Rate-Limiting, and One-Time Consumption
app.post('/pair', (req, res) => {
  const remoteIp = req.socket?.remoteAddress || '';
  const loopbackCheck = validateLoopbackRequest(req);
  if (!loopbackCheck.valid) {
    return res.status(403).json({ error: `Pairing forbidden: ${loopbackCheck.reason}` });
  }

  // Check rate limiting / lockout
  if (pairingState.failedAttempts >= MAX_PAIRING_ATTEMPTS) {
    auditLogger.log({
      action: 'PAIRING_LOCKED',
      status: 'BLOCKED',
      riskLevel: 'high',
      params: { ip: remoteIp, failedAttempts: pairingState.failedAttempts }
    });
    return res.status(429).json({ error: 'Too many failed pairing attempts. Pairing locked for security. Restart engine to reset.' });
  }

  // Check expiration (5-minute TTL)
  if (Date.now() > pairingState.expiresAt) {
    auditLogger.log({
      action: 'PAIRING_EXPIRED',
      status: 'DENIED',
      riskLevel: 'medium',
      params: { ip: remoteIp }
    });
    return res.status(410).json({ error: 'Pairing code has expired. Restart engine to generate a fresh pairing code.' });
  }

  // Check one-time consumption (Replay prevention)
  if (pairingState.consumed) {
    auditLogger.log({
      action: 'PAIRING_REPLAY_REJECTED',
      status: 'DENIED',
      riskLevel: 'high',
      params: { ip: remoteIp }
    });
    return res.status(409).json({ error: 'Pairing code has already been consumed. One-time pairing codes cannot be reused.' });
  }

  const { pairingCode } = req.body || {};
  if (!pairingCode || pairingCode.trim().toUpperCase() !== pairingState.code) {
    pairingState.failedAttempts++;
    const remaining = Math.max(0, MAX_PAIRING_ATTEMPTS - pairingState.failedAttempts);
    auditLogger.log({
      action: 'PAIRING_FAILED',
      status: 'DENIED',
      riskLevel: 'medium',
      params: { ip: remoteIp, remainingAttempts: remaining }
    });
    return res.status(401).json({
      error: 'Invalid pairing code',
      remainingAttempts: remaining
    });
  }

  // Consume code immediately upon success
  pairingState.consumed = true;
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

// Configuration retrieval (Secrets safely masked from .secrets.json)
app.get('/config', authenticateHttp, (req, res) => {
  const geminiKey = secrets.geminiApiKey || process.env.GEMINI_API_KEY || '';
  const anthropicKey = secrets.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
  const openaiKey = secrets.openaiApiKey || process.env.OPENAI_API_KEY || '';
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

// Authenticated Configuration Update (Canonical schema with strict validation and safe secret persistence)
app.post('/config', authenticateHttp, (req, res) => {
  try {
    const {
      activeProvider,
      selectedProvider,
      hybridRoutingPolicy,
      geminiApiKey,
      geminiKey,
      anthropicApiKey,
      anthropicKey,
      openaiApiKey,
      openAiKey,
      openaiKey,
      ollamaUrl,
      ollamaModel,
      preferLocalOllama,
      allowFallbackOnMissingCredentials,
      allowedExtensionIds
    } = req.body || {};

    // Create candidate staging objects to ensure transactional behavior
    const candidateConfig = { ...config };
    const candidateSecrets = { ...secrets };

    const targetProvider = activeProvider !== undefined ? activeProvider : selectedProvider;

    // 1. Validate Provider Enum
    const validProviders = new Set([
      'hybrid', 'gemini', 'anthropic', 'openai', 'ollama', 'autonomous',
      'google', 'claude', 'chatgpt', 'local', 'fallback'
    ]);
    if (targetProvider !== undefined) {
      if (typeof targetProvider !== 'string' || !validProviders.has(targetProvider.toLowerCase().trim())) {
        return res.status(400).json({
          error: `Invalid provider "${targetProvider}". Supported providers: hybrid, gemini, anthropic, openai, ollama, autonomous.`
        });
      }
      candidateConfig.activeProvider = targetProvider.toLowerCase().trim();
    }

    // 2. Validate Routing Policy Enum
    const validPolicies = new Set(['balanced', 'privacy-first', 'cloud-preferred', 'manual']);
    if (hybridRoutingPolicy !== undefined) {
      if (typeof hybridRoutingPolicy !== 'string' || !validPolicies.has(hybridRoutingPolicy.toLowerCase().trim())) {
        return res.status(400).json({
          error: `Invalid hybridRoutingPolicy "${hybridRoutingPolicy}". Supported policies: balanced, privacy-first, cloud-preferred, manual.`
        });
      }
      candidateConfig.hybridRoutingPolicy = hybridRoutingPolicy.toLowerCase().trim();
    }

    // 3. Validate Ollama URL
    if (ollamaUrl !== undefined) {
      if (typeof ollamaUrl !== 'string') {
        return res.status(400).json({ error: 'ollamaUrl must be a string.' });
      }
      const trimmedUrl = ollamaUrl.trim();
      try {
        const parsed = new URL(trimmedUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return res.status(400).json({ error: 'ollamaUrl must use http or https protocol.' });
        }
        candidateConfig.ollamaUrl = trimmedUrl;
      } catch (urlErr) {
        return res.status(400).json({ error: `Invalid ollamaUrl format: "${trimmedUrl}"` });
      }
    }

    // 4. Validate Ollama Model
    if (ollamaModel !== undefined) {
      if (typeof ollamaModel !== 'string' || ollamaModel.trim().length === 0 || ollamaModel.length > 64) {
        return res.status(400).json({ error: 'ollamaModel must be a non-empty string under 64 characters.' });
      }
      if (!/^[a-zA-Z0-9_\-\.:]+$/.test(ollamaModel.trim())) {
        return res.status(400).json({ error: 'ollamaModel contains invalid characters.' });
      }
      candidateConfig.ollamaModel = ollamaModel.trim();
    }

    // 5. Booleans
    if (preferLocalOllama !== undefined) candidateConfig.preferLocalOllama = Boolean(preferLocalOllama);
    if (allowFallbackOnMissingCredentials !== undefined) {
      candidateConfig.allowFallbackOnMissingCredentials = Boolean(allowFallbackOnMissingCredentials);
    }

    if (allowedExtensionIds !== undefined) {
      if (!Array.isArray(allowedExtensionIds)) {
        return res.status(400).json({ error: 'allowedExtensionIds must be an array of strings.' });
      }
      candidateConfig.allowedExtensionIds = allowedExtensionIds.map(s => String(s).trim()).filter(Boolean);
    }

    // 6. Update secret keys with strict validation and explicit semantics:
    // - Omitted or containing '••••': preserve existing secret
    // - Explicit null or empty string "": delete credential
    // - New non-empty string: validate and update credential
    let secretsChanged = false;

    const handleSecretField = (key, val) => {
      if (val === undefined) return;
      if (typeof val === 'string' && val.includes('••••')) return;
      if (val === null || val === '') {
        if (candidateSecrets[key] !== '') {
          candidateSecrets[key] = '';
          secretsChanged = true;
        }
      } else if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed.length > 512) {
          throw new Error(`API key for ${key} exceeds maximum length (512 characters).`);
        }
        if (/[\x00-\x1F\x7F]/.test(trimmed)) {
          throw new Error(`API key for ${key} contains invalid control characters.`);
        }
        if (trimmed.length > 0 && candidateSecrets[key] !== trimmed) {
          candidateSecrets[key] = trimmed;
          secretsChanged = true;
        }
      } else {
        throw new Error(`Invalid type for credential ${key}; expected string.`);
      }
    };

    handleSecretField('geminiApiKey', geminiApiKey ?? geminiKey);
    handleSecretField('anthropicApiKey', anthropicApiKey ?? anthropicKey);
    handleSecretField('openaiApiKey', openaiApiKey ?? openAiKey ?? openaiKey);

    // Transactional durability phase: Persist to disk before mutating memory state
    let secretsPersisted = false;
    if (secretsChanged) {
      try {
        writeAtomicJsonSync(secretsPath, candidateSecrets, 0o600);
        secretsPersisted = true;
      } catch (secErr) {
        return res.status(500).json({
          error: `Failed to persist credentials: ${secErr.message}. No settings were modified.`
        });
      }
    }

    // Prepare non-secret config to save
    const toSaveConfig = {
      port: PORT,
      host: HOST,
      activeProvider: candidateConfig.activeProvider || 'hybrid',
      hybridRoutingPolicy: candidateConfig.hybridRoutingPolicy || 'balanced',
      ollamaUrl: candidateConfig.ollamaUrl || 'http://localhost:11434',
      ollamaModel: candidateConfig.ollamaModel || 'llama3',
      preferLocalOllama: Boolean(candidateConfig.preferLocalOllama),
      allowFallbackOnMissingCredentials: Boolean(candidateConfig.allowFallbackOnMissingCredentials),
      approvedDirectories: permissionManager.getApprovedDirectories(),
      approvedApplications: candidateConfig.approvedApplications || ['code', 'notepad', 'calc', 'git'],
      allowedExtensionIds: candidateConfig.allowedExtensionIds || config.allowedExtensionIds || [],
      security: candidateConfig.security || config.security
    };

    try {
      writeAtomicJsonSync(configPath, toSaveConfig, 0o644);
    } catch (cfgErr) {
      // Rollback secrets file if previously written
      if (secretsPersisted) {
        try {
          writeAtomicJsonSync(secretsPath, secrets, 0o600);
        } catch (rbErr) {
          console.error('[Server] Secret rollback failed:', rbErr.message);
        }
      }
      return res.status(500).json({
        error: `Failed to persist configuration file: ${cfgErr.message}. Changes were rolled back.`
      });
    }

    // Both persistence writes succeeded: Commit candidate states to in-memory runtime
    config = candidateConfig;
    secrets = candidateSecrets;

    // Synchronize encrypted Credential Vault (Section 9)
    if (secrets.geminiApiKey) {
      credentialVault.storeSecret('gemini', secrets.geminiApiKey, { category: 'provider_key', provider: 'gemini' });
    } else if (candidateSecrets.geminiApiKey === '') {
      credentialVault.deleteSecret('gemini');
    }
    if (secrets.openaiApiKey) {
      credentialVault.storeSecret('openai', secrets.openaiApiKey, { category: 'provider_key', provider: 'openai' });
    } else if (candidateSecrets.openaiApiKey === '') {
      credentialVault.deleteSecret('openai');
    }
    if (secrets.anthropicApiKey) {
      credentialVault.storeSecret('anthropic', secrets.anthropicApiKey, { category: 'provider_key', provider: 'anthropic' });
    } else if (candidateSecrets.anthropicApiKey === '') {
      credentialVault.deleteSecret('anthropic');
    }

    // Dynamically update orchestrator & modelManager config with merged settings and credentials
    modelManager.updateConfig({ ...config, ...secrets });
    orchestrator.updateConfig({ ...config, ...secrets });

    auditLogger.log({
      action: 'SETTINGS_CONFIGURED',
      status: 'SUCCESS',
      riskLevel: 'low',
      params: {
        activeProvider: config.activeProvider,
        hybridRoutingPolicy: config.hybridRoutingPolicy,
        hasGemini: Boolean(secrets.geminiApiKey || process.env.GEMINI_API_KEY),
        hasAnthropic: Boolean(secrets.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
        hasOpenai: Boolean(secrets.openaiApiKey || process.env.OPENAI_API_KEY),
        ollamaUrl: config.ollamaUrl
      }
    });

    return res.json({
      success: true,
      message: 'Configuration updated and applied.',
      activeProvider: config.activeProvider,
      hybridRoutingPolicy: config.hybridRoutingPolicy,
      hasGeminiKey: Boolean(secrets.geminiApiKey || process.env.GEMINI_API_KEY),
      hasAnthropicKey: Boolean(secrets.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
      hasOpenaiKey: Boolean(secrets.openaiApiKey || process.env.OPENAI_API_KEY),
      ollamaUrl: config.ollamaUrl,
      preferLocalOllama: config.preferLocalOllama
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to update configuration.' });
  }
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
    const mergedConfig = { ...config, ...secrets };
    const router = new HybridRouter(mergedConfig);
    const availability = router.getProviderAvailability(mergedConfig);

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

// Provider connection testing (Section 5 & 7)
app.post('/provider/test', authenticateHttp, async (req, res) => {
  try {
    const provider = req.body?.provider || config.activeProvider || 'gemini';
    const result = await modelManager.testConnection(provider);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stored credentials metadata listing (Section 9 & 10) - NO SECRETS
app.get('/credentials', authenticateHttp, (req, res) => {
  res.json({
    credentials: credentialBroker.listAvailableCredentials()
  });
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

app.post('/emergency-stop/reset', authenticateHttp, (req, res) => {
  emergencyCoordinator.resetHalt();
  res.json({ success: true, halted: false, message: 'Emergency stop halt state cleared successfully.' });
});

app.post('/task', authenticateHttp, async (req, res) => {
  const { task, provider } = req.body;
  if (!task) return res.status(400).json({ error: 'Task is required' });

  // Emergency stop is an intentional safety control: A new task must NOT automatically clear the halt
  if (emergencyCoordinator.isEmergencyHalted()) {
    return res.status(409).json({
      error: 'Emergency Stop is currently active. You must explicitly reset the emergency stop before starting a new task.',
      halted: true
    });
  }

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

// WebSocket Upgrade with Loopback & Origin Security Validation
server.on('upgrade', (request, socket, head) => {
  try {
    const loopback = validateLoopbackRequest(request);
    if (!loopback.valid) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const originCheck = validateRequestOrigin(request.headers.origin);
    if (!originCheck.allowed) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.__authenticated = false;
      ws.__authHandshakeDone = false;
      ws.__connectedAt = Date.now();
      wss.emit('connection', ws, request);
    });
  } catch (err) {
    socket.destroy();
  }
});

// WebSocket Connection Lifecycle & Authentication Enforcement
wss.on('connection', (ws, req) => {
  console.log(`[Server] Antigravity Extension connected from ${req.socket.remoteAddress}`);

  let currentTaskAbort = null;
  let handshakeTimer = null;

  // Enforce mandatory AUTH_HANDSHAKE message within 5 seconds
  handshakeTimer = setTimeout(() => {
    if (!ws.__authenticated) {
      console.warn('[Server] WS connection timed out waiting for authentication handshake');
      try {
        ws.send(JSON.stringify({ type: 'AUTH_FAILED', error: 'Authentication handshake timeout' }));
        ws.close(4001, 'Authentication handshake timeout');
      } catch (e) {}
    }
  }, 5000);

  ws.on('message', async (data) => {
    try {
      if (data.length > 2 * 1024 * 1024) {
        ws.send(JSON.stringify({ type: 'ERROR', error: 'Payload too large (max 2MB)' }));
        return;
      }

      const msg = JSON.parse(data.toString());

      // Handle Authentication Handshake
      if (msg.type === 'AUTH_HANDSHAKE') {
        if (ws.__authHandshakeDone) {
          return; // Ignore duplicate handshake attempts
        }
        ws.__authHandshakeDone = true;

        if (msg.token && msg.token === AUTH_TOKEN) {
          if (handshakeTimer) clearTimeout(handshakeTimer);
          ws.__authenticated = true;

          // Prevent duplicate / stale sockets from overriding newer connection
          if (extensionClient && extensionClient !== ws && extensionClient.readyState === 1) {
            try {
              extensionClient.close(4000, 'Superceded by newer connection');
            } catch (e) {}
          }
          extensionClient = ws;

          auditLogger.log({
            action: 'WS_AUTH_SUCCESS',
            status: 'APPROVED',
            riskLevel: 'low',
            params: { ip: req.socket.remoteAddress }
          });

          ws.send(JSON.stringify({
            type: 'ENGINE_STATUS',
            connected: true,
            authenticated: true,
            port: PORT,
            message: 'Authentication successful. Connected to Antigravity Local Agent Engine.'
          }));
        } else {
          if (handshakeTimer) clearTimeout(handshakeTimer);
          auditLogger.log({
            action: 'WS_AUTH_FAILED',
            status: 'DENIED',
            riskLevel: 'medium',
            params: { ip: req.socket.remoteAddress }
          });
          ws.send(JSON.stringify({ type: 'AUTH_FAILED', error: 'Invalid security token' }));
          ws.close(4003, 'Invalid token');
        }
        return;
      }

      // Block all other messages if unauthenticated
      if (!ws.__authenticated) {
        ws.send(JSON.stringify({ type: 'AUTH_REQUIRED', error: 'Authentication required. Complete AUTH_HANDSHAKE first.' }));
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

        case 'EMERGENCY_RESET':
        case 'RESET_HALT':
          console.log('[Server] Received Emergency Stop Reset signal');
          emergencyCoordinator.resetHalt();
          ws.send(JSON.stringify({
            type: 'EMERGENCY_RESET',
            halted: false,
            message: 'Emergency stop state cleared.'
          }));
          break;

        case 'USER_TASK': {
          const taskConversationId = msg.conversationId || null;

          // Prevent new execution while Emergency Stop is active
          if (emergencyCoordinator.isEmergencyHalted()) {
            ws.send(JSON.stringify({
              type: 'TASK_COMPLETE',
              conversationId: taskConversationId,
              success: false,
              halted: true,
              summary: '🛑 Task rejected: Emergency Stop is currently active. You must explicitly reset the emergency stop before starting a new task.'
            }));
            break;
          }

          currentTaskAbort = emergencyCoordinator.createAbortController();
          try {
            await orchestrator.runTask({
              task: msg.task,
              conversationId: taskConversationId,
              providerName: msg.provider || config.activeProvider || 'hybrid',
              context: msg.context || {},
              clientWs: ws,
              abortSignal: currentTaskAbort.signal
            });
          } catch (taskErr) {
            ws.send(JSON.stringify({
              type: 'AGENT_MESSAGE',
              conversationId: taskConversationId,
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

        case 'TASK_CANCEL':
          if (currentTaskAbort) {
            currentTaskAbort.abort();
            currentTaskAbort = null;
          }
          ws.send(JSON.stringify({
            type: 'TASK_COMPLETE',
            conversationId: msg.conversationId || null,
            success: false,
            cancelled: true,
            summary: '🛑 Task was cancelled by user.'
          }));
          break;

        case 'PROVIDER_TEST': {
          const testProvider = msg.provider || config.activeProvider || 'gemini';
          const testRes = await modelManager.testConnection(testProvider);
          ws.send(JSON.stringify({
            type: 'PROVIDER_TEST_RESULT',
            provider: testProvider,
            ...testRes
          }));
          break;
        }

        case 'GET_CREDENTIALS': {
          ws.send(JSON.stringify({
            type: 'CREDENTIALS_LIST',
            credentials: credentialBroker.listAvailableCredentials()
          }));
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
if (require.main === module) {
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
}

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
  PAIRING_CODE,
  isLoopbackAddress,
  validateLoopbackRequest,
  validateRequestOrigin,
  getAllowedExtensionIds,
  writeAtomicJsonSync
};

