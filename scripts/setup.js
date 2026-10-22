// Antigravity Agent Suite - Automated Setup Wizard
// 8-Phase Fail-Closed Setup & Verification Pipeline

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log(`
=====================================================
   ⚡ ANTIGRAVITY BROWSER AGENT - SETUP WIZARD
=====================================================
`);

const rootDir = path.resolve(__dirname, '..');
const engineDir = path.join(rootDir, 'local-engine');
const extensionDir = path.join(rootDir, 'extension');
const envExample = path.join(engineDir, '.env.example');
const envFile = path.join(engineDir, '.env');
const configJsonPath = path.join(engineDir, 'config.json');

// ===================================================
// Phase 1: Preflight Environment & Manifest Validation
// ===================================================
console.log('🔍 Phase 1/8: Preflight environment validation...');
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
if (isNaN(majorVersion) || majorVersion < 18) {
  console.error(`   ✗ FATAL: Node.js version 18.0.0 or higher is required. Found: ${nodeVersion}`);
  process.exit(1);
}
console.log(`   ✓ Node.js runtime compatible (${nodeVersion}).`);

// Check required directories
const requiredDirs = [engineDir, extensionDir, path.join(extensionDir, 'sidepanel')];
for (const dir of requiredDirs) {
  if (!fs.existsSync(dir)) {
    console.error(`   ✗ FATAL: Required project directory does not exist: "${dir}"`);
    process.exit(1);
  }
}

// Check package.json manifests
try {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const enginePkg = JSON.parse(fs.readFileSync(path.join(engineDir, 'package.json'), 'utf8'));
  if (!rootPkg.name || !enginePkg.name) {
    throw new Error('Missing name in package manifests.');
  }
  console.log('   ✓ Project package manifests valid.');
} catch (pkgErr) {
  console.error(`   ✗ FATAL: Package manifest validation failed: ${pkgErr.message}`);
  process.exit(1);
}

// ===================================================
// Phase 2: Dependency Installation (Fatal on Failure)
// ===================================================
console.log('\n📦 Phase 2/8: Installing Local Engine dependencies...');
try {
  execSync('npm install', { cwd: engineDir, stdio: 'inherit' });
  console.log('   ✓ Dependencies installed successfully.');
} catch (depErr) {
  console.error(`   ✗ FATAL: Dependency installation failed (${depErr.message || 'npm install failed'}).`);
  console.error('   Setup aborted. Engine dependencies must install cleanly before proceeding.');
  process.exit(1);
}

// ===================================================
// Phase 3: Secure Credential Vault Initialization
// ===================================================
console.log('\n🔐 Phase 3/8: Initializing authoritative Credential Vault...');
let CredentialVault;
let vault;
try {
  CredentialVault = require(path.join(engineDir, 'src', 'security', 'vault.js'));
  vault = new CredentialVault();
  if (!vault.isVaultUsable()) {
    const status = vault.getSecurityStatus();
    throw new Error(status.protectionError || 'Vault failed cryptographic usability check.');
  }
  console.log(`   ✓ Credential Vault initialized (Protection: ${vault.getSecurityStatus().protectionMechanism}).`);
} catch (vaultErr) {
  console.error(`   ✗ FATAL: Credential Vault initialization failed: ${vaultErr.message}`);
  console.error('   Setup aborted. Cannot proceed without secure, fail-closed credential storage.');
  process.exit(1);
}

// ===================================================
// Phase 4: Authentication Token Setup & Verification
// ===================================================
console.log('\n🔑 Phase 4/8: Configuring and verifying security authentication token...');
let existingToken = vault.getAuthToken();
let activeToken = existingToken;

if (!activeToken) {
  const generatedToken = `agy_${crypto.randomBytes(24).toString('hex')}`;
  vault.setAuthToken(generatedToken);
  activeToken = generatedToken;
  console.log('   ✓ Generated new persistent security authentication token.');
} else {
  console.log('   ✓ Preserved valid existing authentication token from vault.');
}

// Verify token was persisted and can be read back cleanly
const verifyToken = vault.getAuthToken();
if (!verifyToken || verifyToken !== activeToken) {
  console.error('   ✗ FATAL: Token persistence verification failed: retrieved token does not match active token.');
  process.exit(1);
}
console.log('   ✓ Authentication token persistence verified successfully.');

// ===================================================
// Phase 5: Configuration Sanitization & Non-Secret Defaults
// ===================================================
console.log('\n⚙️  Phase 5/8: Sanitizing configuration files...');

// 5a. Ensure .env contains non-secret settings only (never plaintext tokens)
if (!fs.existsSync(envFile)) {
  let envTemplate = fs.existsSync(envExample) ? fs.readFileSync(envExample, 'utf8') : '';
  if (!envTemplate) {
    envTemplate = `ENGINE_PORT=3721\nENGINE_HOST=127.0.0.1\n`;
  }
  const sanitizedEnv = envTemplate
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('ENGINE_AUTH_TOKEN='))
    .join('\n');
  fs.writeFileSync(envFile, sanitizedEnv.trim() + '\n', 'utf8');
  console.log('   ✓ Initialized local-engine/.env with non-secret defaults.');
} else {
  let existingEnv = fs.readFileSync(envFile, 'utf8');
  if (existingEnv.includes('ENGINE_AUTH_TOKEN=')) {
    const scrubbedEnv = existingEnv
      .split(/\r?\n/)
      .map(line => line.trim().startsWith('ENGINE_AUTH_TOKEN=') ? '# ENGINE_AUTH_TOKEN=[STORED_IN_SECURE_VAULT]' : line)
      .join('\n');
    fs.writeFileSync(envFile, scrubbedEnv, 'utf8');
    console.log('   ✓ Scrubbed legacy plaintext tokens from local-engine/.env.');
  } else {
    console.log('   ✓ local-engine/.env configuration clean.');
  }
}

// 5b. Remove secrets from tracked config.json if present (MANDATORY SANITIZATION)
if (fs.existsSync(configJsonPath)) {
  try {
    const rawConfig = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
    let cleaned = false;
    ['authToken', 'geminiApiKey', 'anthropicApiKey', 'openaiApiKey', 'geminiKey', 'anthropicKey', 'openAiKey', 'openaiKey'].forEach(k => {
      if (rawConfig[k]) {
        delete rawConfig[k];
        cleaned = true;
      }
    });
    if (cleaned) {
      fs.writeFileSync(configJsonPath, JSON.stringify(rawConfig, null, 2), 'utf8');
      console.log('   ✓ Removed credentials from local-engine/config.json.');
    } else {
      console.log('   ✓ local-engine/config.json configuration clean.');
    }
  } catch (cfgErr) {
    console.error(`   ✗ FATAL: Mandatory configuration sanitization failed on "${configJsonPath}": ${cfgErr.message}`);
    process.exit(1);
  }
}

// ===================================================
// Phase 6: Extension Asset Generation & Validation
// ===================================================
console.log('\n🎨 Phase 6/8: Verifying extension assets...');
try {
  require('./generate-icons.js');
  console.log('   ✓ Extension icons generated and verified.');
} catch (iconErr) {
  console.error(`   ✗ FATAL: Mandatory extension icon generation failed: ${iconErr.message}`);
  process.exit(1);
}

// Validate all mandatory extension assets
const requiredExtensionAssets = [
  path.join(extensionDir, 'manifest.json'),
  path.join(extensionDir, 'icons', 'icon16.png'),
  path.join(extensionDir, 'icons', 'icon48.png'),
  path.join(extensionDir, 'icons', 'icon128.png'),
  path.join(extensionDir, 'sidepanel', 'sidepanel.html'),
  path.join(extensionDir, 'sidepanel', 'sidepanel.css'),
  path.join(extensionDir, 'sidepanel', 'sidepanel.js'),
  path.join(extensionDir, 'background', 'background.js'),
  path.join(extensionDir, 'content', 'content.js'),
  path.join(extensionDir, 'content', 'content.css')
];

for (const assetPath of requiredExtensionAssets) {
  if (!fs.existsSync(assetPath)) {
    console.error(`   ✗ FATAL: Mandatory extension asset missing at: "${assetPath}"`);
    process.exit(1);
  }
}

// Validate extension manifest schema
const manifestPath = path.join(extensionDir, 'manifest.json');
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.manifest_version !== 3) {
    throw new Error('Manifest version must be 3.');
  }
  if (!manifest.side_panel?.default_path) {
    throw new Error('Manifest missing side_panel.default_path.');
  }
  console.log('   ✓ Extension Manifest V3 verified.');
} catch (mErr) {
  console.error(`   ✗ FATAL: Extension manifest is invalid: ${mErr.message}`);
  process.exit(1);
}

// ===================================================
// Phase 7: Final Integrity Verification
// ===================================================
console.log('\n🛡️  Phase 7/8: Performing final integrity checks...');
if (!vault.isVaultUsable()) {
  console.error('   ✗ FATAL: Vault state corrupted during setup.');
  process.exit(1);
}
console.log('   ✓ All integrity checks passed.');

// ===================================================
// Phase 8: Success Report
// ===================================================
console.log(`
=====================================================
   ✓ SETUP COMPLETE! (All 8 Phases Verified)
=====================================================

HOW TO RUN:
1. Start the Local Agent Engine:
   npm run start:engine

2. Load the Extension into Brave or Chrome:
   - Go to: brave://extensions or chrome://extensions
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select folder: ${extensionDir}

3. Press Alt+Shift+A (or click the toolbar icon) to open the Antigravity Side Panel!
   Configure your security token and providers in the Settings tab.
=====================================================
`);
