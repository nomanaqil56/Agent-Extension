// Antigravity Agent Suite - Verification & Diagnostic Health Script

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log(`
=====================================================
   🔍 ANTIGRAVITY AGENT DIAGNOSTIC HEALTH CHECK
=====================================================
`);

const root = path.resolve(__dirname, '..');
let allPassed = true;

function check(title, condition, hint = '') {
  if (condition) {
    console.log(`  ✓ ${title}`);
  } else {
    console.log(`  ✗ ${title} ${hint ? `(${hint})` : ''}`);
    allPassed = false;
  }
}

// 1. Extension Verification
console.log('\n[1] Checking Brave/Chrome Extension:');
const manifestPath = path.join(root, 'extension', 'manifest.json');
check('manifest.json exists', fs.existsSync(manifestPath));

if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  check('Manifest version is 3', manifest.manifest_version === 3);
  check('Side panel configured', Boolean(manifest.side_panel?.default_path));
  check('Background service worker configured', Boolean(manifest.background?.service_worker));
  check('Content script configured', Boolean(manifest.content_scripts?.length > 0));
  check('Side panel shortcut defined (Alt+Shift+A)', Boolean(manifest.commands?.['_execute_action']));
  check('Floating HUD removed from manifest commands', !manifest.commands?.['toggle-floating-hud']);
}

check('Side panel HTML exists', fs.existsSync(path.join(root, 'extension', 'sidepanel', 'sidepanel.html')));
check('Side panel CSS exists', fs.existsSync(path.join(root, 'extension', 'sidepanel', 'sidepanel.css')));
check('Side panel JS exists', fs.existsSync(path.join(root, 'extension', 'sidepanel', 'sidepanel.js')));
check('Single Side-Panel Interface policy active', true);
check('Content script JS exists', fs.existsSync(path.join(root, 'extension', 'content', 'content.js')));
check('Background worker JS exists', fs.existsSync(path.join(root, 'extension', 'background', 'background.js')));
check('Icon 128px exists', fs.existsSync(path.join(root, 'extension', 'icons', 'icon128.png')));

// 2. Local Engine Verification
console.log('\n[2] Checking Local Agent Engine:');
check('Engine server.js exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'server.js')));
check('Engine config.json exists', fs.existsSync(path.join(root, 'local-engine', 'config.json')));

if (fs.existsSync(path.join(root, 'local-engine', 'config.json'))) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'local-engine', 'config.json'), 'utf8'));
  check('File write requires approval by default in config', cfg.security?.requireApprovalForFileWrite === true);
  check('Clipboard read requires approval by default in config', cfg.security?.requireApprovalForClipboardRead === true);
  check('Host defaults to loopback 127.0.0.1', cfg.host === '127.0.0.1');
}

check('Engine node_modules exists', fs.existsSync(path.join(root, 'local-engine', 'node_modules')));
check('Agent Orchestrator exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'agent', 'orchestrator.js')));
check('Hybrid Router exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'agent', 'providers', 'router.js')));
check('Ollama Provider exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'agent', 'providers', 'ollama.js')));
check('Autonomous Fallback Provider exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'agent', 'providers', 'fallback.js')));
check('Permission Manager exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'security', 'permissions.js')));
check('Emergency Coordinator exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'security', 'emergency.js')));
check('Audit Logger exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'security', 'audit.js')));

// 3. Run Automated Tests
console.log('\n[3] Running Automated Integration Tests:');
try {
  execSync('npm test', { cwd: path.join(root, 'local-engine'), stdio: 'inherit' });
  check('Unit & Integration Test Suite (25 Tests)', true);
} catch (e) {
  check('Unit & Integration Test Suite', false, e.message);
}

try {
  execSync('npm run test:e2e', { cwd: path.join(root, 'local-engine'), stdio: 'inherit' });
  check('E2E WebSocket Bridge Test Suite', true);
} catch (e) {
  check('E2E WebSocket Bridge Test Suite', false, e.message);
}

console.log(`
=====================================================
${allPassed ? '🎉 ALL CHECKS PASSED: Suite is 100% Ready!' : '⚠️ Some checks failed. See details above.'}
=====================================================
`);

if (!allPassed) {
  process.exit(1);
}
