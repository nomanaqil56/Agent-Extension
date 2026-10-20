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

// 2. Setup Environment Variables
console.log('\n🔑 2/3 Configuring environment variables...');
if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, envFile);
  console.log('   ✓ Created local-engine/.env from .env.example');
} else {
  console.log('   ✓ local-engine/.env already exists.');
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

3. Press Alt+Shift+A (or click the toolbar icon) to open the side panel!
   Press Alt+Space anytime to toggle the floating HUD!
=====================================================
`);
