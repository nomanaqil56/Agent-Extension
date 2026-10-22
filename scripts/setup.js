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

// 2. Setup Environment Variables & Secure Credentials
console.log('\n🔑 2/3 Configuring environment variables & secure credentials...');
const generatedToken = `agy_${crypto.randomBytes(24).toString('hex')}`;
const configJsonPath = path.join(engineDir, 'config.json');

if (!fs.existsSync(envFile)) {
  let envTemplate = fs.existsSync(envExample) ? fs.readFileSync(envExample, 'utf8') : '';
  if (!envTemplate) {
    envTemplate = `ENGINE_PORT=3721\nENGINE_AUTH_TOKEN=\nENGINE_HOST=127.0.0.1\n`;
  }
  const envContent = envTemplate.replace(/ENGINE_AUTH_TOKEN=.*/, `ENGINE_AUTH_TOKEN=${generatedToken}`);
  fs.writeFileSync(envFile, envContent, 'utf8');
  console.log('   ✓ Created local-engine/.env with cryptographically generated security token.');
} else {
  // Check if .env is using the insecure default token
  let existingEnv = fs.readFileSync(envFile, 'utf8');
  if (existingEnv.includes('agy_local_secret_token_default')) {
    existingEnv = existingEnv.replace(/ENGINE_AUTH_TOKEN=agy_local_secret_token_default/, `ENGINE_AUTH_TOKEN=${generatedToken}`);
    fs.writeFileSync(envFile, existingEnv, 'utf8');
    console.log('   ✓ Replaced insecure default token in local-engine/.env with secure generated token.');
  } else {
    console.log('   ✓ local-engine/.env already configured.');
  }
}

// Store security token in encrypted Credential Vault (Section 7.1 & 7.2)
try {
  const CredentialVault = require(path.join(engineDir, 'src', 'security', 'vault.js'));
  const vault = new CredentialVault();
  vault.initSecurity();
  if (!vault.getAuthToken()) {
    vault.setAuthToken(generatedToken);
    console.log('   ✓ Security token securely stored in encrypted Credential Vault.');
  } else {
    console.log('   ✓ Security token already configured in encrypted Credential Vault.');
  }
} catch (e) {
  console.warn('   ! Credential Vault setup note:', e.message);
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
