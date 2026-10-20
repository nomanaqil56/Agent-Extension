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
  check('Commands (shortcuts) defined', Boolean(manifest.commands?.['toggle-floating-hud']));
}

check('Side panel HTML exists', fs.existsSync(path.join(root, 'extension', 'sidepanel', 'sidepanel.html')));
check('Side panel CSS exists', fs.existsSync(path.join(root, 'extension', 'sidepanel', 'sidepanel.css')));
check('Side panel JS exists', fs.existsSync(path.join(root, 'extension', 'sidepanel', 'sidepanel.js')));
check('Floating HUD HTML exists', fs.existsSync(path.join(root, 'extension', 'floating', 'floating.html')));
check('Content script JS exists', fs.existsSync(path.join(root, 'extension', 'content', 'content.js')));
check('Background worker JS exists', fs.existsSync(path.join(root, 'extension', 'background', 'background.js')));
check('Icon 128px exists', fs.existsSync(path.join(root, 'extension', 'icons', 'icon128.png')));

// 2. Local Engine Verification
console.log('\n[2] Checking Local Agent Engine:');
check('Engine server.js exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'server.js')));
check('Engine config.json exists', fs.existsSync(path.join(root, 'local-engine', 'config.json')));
check('Engine node_modules exists', fs.existsSync(path.join(root, 'local-engine', 'node_modules')));
check('Agent Orchestrator exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'agent', 'orchestrator.js')));
check('Fallback Provider exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'agent', 'providers', 'fallback.js')));
check('Permission Manager exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'security', 'permissions.js')));
check('Emergency Coordinator exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'security', 'emergency.js')));
check('Audit Logger exists', fs.existsSync(path.join(root, 'local-engine', 'src', 'security', 'audit.js')));

// 3. Run Automated Tests
console.log('\n[3] Running Automated Integration Tests:');
try {
  execSync('npm test', { cwd: path.join(root, 'local-engine'), stdio: 'inherit' });
  check('Unit & Integration Test Suite', true);
} catch (e) {
  check('Unit & Integration Test Suite', false, e.message);
}

console.log(`
=====================================================
${allPassed ? '🎉 ALL CHECKS PASSED: Suite is 100% Ready!' : '⚠️ Some checks failed. See details above.'}
=====================================================
`);
