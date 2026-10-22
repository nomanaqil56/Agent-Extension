// Antigravity Agent Suite - Automated Setup Script

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log(`
=====================================================
   ⚡ ANTIGRAVITY BROWSER AGENT - SETUP WIZARD
=====================================================
`);

const rootDir = path.resolve(__dirname, '..');
const engineDir = path.join(rootDir, 'local-engine');
const envExample = path.join(engineDir, '.env.example');
const envFile = path.join(engineDir, '.env');

// 1. Install Local Engine Dependencies
console.log('📦 1/3 Checking Local Engine dependencies...');
try {
  execSync('npm install', { cwd: engineDir, stdio: 'inherit' });
  console.log('   ✓ Dependencies installed successfully.');
} catch (e) {
  console.error('   ✗ Failed to install dependencies:', e.message);
}

const crypto = require('crypto');

// 2. Setup Environment Variables & Authoritative Credential Vault
console.log('\n🔑 2/3 Configuring authoritative Credential Vault & non-secret settings...');
const generatedToken = `agy_${crypto.randomBytes(24).toString('hex')}`;
const configJsonPath = path.join(engineDir, 'config.json');

// Store security token in authoritative encrypted Credential Vault (Section 7.1 & 7.2)
try {
  const CredentialVault = require(path.join(engineDir, 'src', 'security', 'vault.js'));
  const vault = new CredentialVault();
  vault.initSecurity();
  if (!vault.getAuthToken()) {
    vault.setAuthToken(generatedToken);
    console.log('   ✓ Security token securely stored in authoritative Credential Vault.');
  } else {
    console.log('   ✓ Security token already configured in authoritative Credential Vault.');
  }
} catch (e) {
  console.warn('   ! Credential Vault setup note:', e.message);
}

// Ensure .env exists with non-secret settings only (never plaintext tokens)
if (!fs.existsSync(envFile)) {
  let envTemplate = fs.existsSync(envExample) ? fs.readFileSync(envExample, 'utf8') : '';
  if (!envTemplate) {
    envTemplate = `ENGINE_PORT=3721\nENGINE_HOST=127.0.0.1\n`;
  }
  // Strip any token assignments from .env
  const sanitizedEnv = envTemplate
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('ENGINE_AUTH_TOKEN='))
    .join('\n');
  fs.writeFileSync(envFile, sanitizedEnv.trim() + '\n', 'utf8');
  console.log('   ✓ Initialized local-engine/.env with non-secret configuration settings.');
} else {
  // Scrub any legacy plaintext tokens from existing .env
  let existingEnv = fs.readFileSync(envFile, 'utf8');
  if (existingEnv.includes('ENGINE_AUTH_TOKEN=')) {
    const scrubbedEnv = existingEnv
      .split(/\r?\n/)
      .map(line => line.trim().startsWith('ENGINE_AUTH_TOKEN=') ? '# ENGINE_AUTH_TOKEN=[STORED_IN_SECURE_VAULT]' : line)
      .join('\n');
    fs.writeFileSync(envFile, scrubbedEnv, 'utf8');
    console.log('   ✓ Removed plaintext tokens from local-engine/.env (secured in Credential Vault).');
  } else {
    console.log('   ✓ local-engine/.env already configured (non-secret settings).');
  }
}

// Remove secrets from tracked config.json if present
try {
  if (fs.existsSync(configJsonPath)) {
    const rawConfig = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
    if (rawConfig.authToken || rawConfig.geminiApiKey || rawConfig.anthropicApiKey || rawConfig.openaiApiKey) {
      delete rawConfig.authToken;
      delete rawConfig.geminiApiKey;
      delete rawConfig.anthropicApiKey;
      delete rawConfig.openaiApiKey;
      fs.writeFileSync(configJsonPath, JSON.stringify(rawConfig, null, 2), 'utf8');
      console.log('   ✓ Removed credentials from tracked local-engine/config.json.');
    }
  }
} catch (e) {
  console.warn('   ! config.json update note:', e.message);
}

// 3. Generate Extension Icons
console.log('\n🎨 3/3 Verifying extension assets...');
try {
  require('./generate-icons.js');
  console.log('   ✓ Extension icons generated.');
} catch (e) {
  console.warn('   ! Icon generation note:', e.message);
}

console.log(`
=====================================================
   ✓ SETUP COMPLETE!
=====================================================

HOW TO RUN:
1. Start the Local Agent Engine:
   npm run start:engine

2. Load the Extension into Brave or Chrome:
   - Go to: brave://extensions or chrome://extensions
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select folder: ${path.join(rootDir, 'extension')}

3. Press Alt+Shift+A (or click the toolbar icon) to open the Antigravity Side Panel!
   Configure your security token and providers in the Settings tab.
=====================================================
`);
