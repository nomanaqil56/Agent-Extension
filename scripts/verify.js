// Antigravity Agent Suite - Verification & Diagnostic Health Script
// Comprehensive validation across security, syntax, configuration, unit tests, E2E tests, and secret isolation

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log(`
=====================================================
   🔍 ANTIGRAVITY COMPREHENSIVE VERIFICATION SUITE
=====================================================
`);

const root = path.resolve(__dirname, '..');
let allPassed = true;

const summary = {
  passed: 0,
  failed: 0,
  skipped: 0,
  manualRequired: 0
};

function check(title, condition, hint = '') {
  if (condition) {
    console.log(`  ✓ ${title}`);
    summary.passed++;
  } else {
    console.log(`  ✗ ${title} ${hint ? `(${hint})` : ''}`);
    summary.failed++;
    allPassed = false;
  }
}

function skip(title, reason) {
  console.log(`  ⏭ [SKIPPED] ${title} — ${reason}`);
  summary.skipped++;
}

function manual(title, instruction) {
  console.log(`  🔎 [MANUAL VALIDATION REQUIRED] ${title} — ${instruction}`);
  summary.manualRequired++;
}

// 1. Structure & Configuration Validation
console.log('\n[1] Project Structure & Manifest V3 Configuration:');
const manifestPath = path.join(root, 'extension', 'manifest.json');
check('Extension Manifest exists', fs.existsSync(manifestPath));

if (fs.existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    check('Manifest version is 3', manifest.manifest_version === 3);
    check('Side panel configured (single primary interface)', Boolean(manifest.side_panel?.default_path));
    check('Background service worker configured', Boolean(manifest.background?.service_worker));
    check('Content scripts configured', Boolean(manifest.content_scripts?.length > 0));
    check('Side panel keyboard shortcut defined (Alt+Shift+A)', Boolean(manifest.commands?.['_execute_action']));
    check('Floating HUD removed from manifest commands', !manifest.commands?.['toggle-floating-hud']);
  } catch (err) {
    check('Manifest JSON parsing', false, err.message);
  }
}

check('Side panel HTML exists', fs.existsSync(path.join(root, 'extension', 'sidepanel', 'sidepanel.html')));
check('Side panel CSS exists', fs.existsSync(path.join(root, 'extension', 'sidepanel', 'sidepanel.css')));
check('Side panel JS exists', fs.existsSync(path.join(root, 'extension', 'sidepanel', 'sidepanel.js')));
check('Content script JS exists', fs.existsSync(path.join(root, 'extension', 'content', 'content.js')));
check('Background worker JS exists', fs.existsSync(path.join(root, 'extension', 'background', 'background.js')));
check('Extension 128px icon exists', fs.existsSync(path.join(root, 'extension', 'icons', 'icon128.png')));

// 2. Secret Protection & Git Tracking Defense
console.log('\n[2] Secret Isolation & Untracked Credentials Check:');
const gitignorePath = path.join(root, '.gitignore');
check('.gitignore exists', fs.existsSync(gitignorePath));
if (fs.existsSync(gitignorePath)) {
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  check('.gitignore ignores .secrets.json', gitignore.includes('.secrets.json'));
  check('.gitignore ignores .env', gitignore.includes('.env'));
}

const configJsonPath = path.join(root, 'local-engine', 'config.json');
if (fs.existsSync(configJsonPath)) {
  const cfg = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
  check('config.json contains NO authToken', !cfg.authToken);
  check('config.json contains NO geminiApiKey', !cfg.geminiApiKey && !cfg.geminiKey);
  check('config.json contains NO anthropicApiKey', !cfg.anthropicApiKey && !cfg.anthropicKey);
  check('config.json contains NO openaiApiKey', !cfg.openaiApiKey && !cfg.openAiKey && !cfg.openaiKey);
  check('config.json starts with empty approvedDirectories (no implicit cwd)', Array.isArray(cfg.approvedDirectories) && cfg.approvedDirectories.length === 0);
  check('config.json binds strictly to loopback (127.0.0.1)', cfg.host === '127.0.0.1');
}

// 3. Syntax Verification (node -c)
console.log('\n[3] JavaScript Syntax Verification:');
const filesToCompile = [
  'local-engine/src/server.js',
  'local-engine/src/security/permissions.js',
  'local-engine/src/security/audit.js',
  'local-engine/src/security/emergency.js',
  'local-engine/src/tools/index.js',
  'local-engine/src/tools/desktop.js',
  'local-engine/src/tools/files.js',
  'local-engine/src/tools/terminal.js',
  'local-engine/src/tools/browser.js',
  'local-engine/src/agent/orchestrator.js',
  'local-engine/src/agent/providers/router.js',
  'local-engine/src/agent/providers/gemini.js',
  'local-engine/src/agent/providers/anthropic.js',
  'local-engine/src/agent/providers/openai.js',
  'local-engine/src/agent/providers/ollama.js',
  'local-engine/src/agent/providers/fallback.js',
  'extension/background/background.js',
  'extension/content/content.js',
  'scripts/setup.js'
];

filesToCompile.forEach(relPath => {
  const fullPath = path.join(root, relPath);
  if (fs.existsSync(fullPath)) {
    try {
      execSync(`node -c "${fullPath}"`, { stdio: 'pipe' });
      check(`Syntax OK: ${relPath}`, true);
    } catch (e) {
      check(`Syntax OK: ${relPath}`, false, e.message);
    }
  }
});

// 4. Automated Unit & Security Tests
console.log('\n[4] Running Automated Unit & Security Test Suite:');
try {
  execSync('npm test', { cwd: path.join(root, 'local-engine'), stdio: 'inherit' });
  check('Local Engine Unit & Security Suite passed', true);
} catch (e) {
  check('Local Engine Unit & Security Suite', false, e.message);
}

// 5. Automated E2E WebSocket & Auth Tests
console.log('\n[5] Running Automated End-to-End WebSocket & Auth Suite:');
try {
  execSync('npm run test:e2e', { cwd: path.join(root, 'local-engine'), stdio: 'inherit' });
  check('E2E WebSocket, Pairing, and Settings Suite passed', true);
} catch (e) {
  check('E2E WebSocket, Pairing, and Settings Suite', false, e.message);
}

// 6. Automated Privacy-First Boundary Sentinel Tests
console.log('\n[6] Running Automated Privacy-First Boundary Sentinel Tests:');
try {
  execSync('npm run test:privacy', { cwd: path.join(root, 'local-engine'), stdio: 'inherit' });
  check('Privacy-First Outbound Boundary Sentinel Suite passed', true);
} catch (e) {
  check('Privacy-First Outbound Boundary Sentinel Suite', false, e.message);
}

// 7. External Environment & Live Inference Status
console.log('\n[7] External Provider Live Inference Status:');
if (process.env.GEMINI_API_KEY) {
  check('Live Gemini provider configured via environment', true);
} else {
  skip('Live Gemini Cloud Inference', 'GEMINI_API_KEY environment variable not set; automated tests use mock boundary');
}

if (process.env.ANTHROPIC_API_KEY) {
  check('Live Anthropic provider configured via environment', true);
} else {
  skip('Live Anthropic Cloud Inference', 'ANTHROPIC_API_KEY environment variable not set; automated tests use mock boundary');
}

if (process.env.OPENAI_API_KEY) {
  check('Live OpenAI provider configured via environment', true);
} else {
  skip('Live OpenAI Cloud Inference', 'OPENAI_API_KEY environment variable not set; automated tests use mock boundary');
}

// Check Ollama service availability
try {
  const ollamaCheck = execSync('curl -s http://127.0.0.1:11434/api/tags', { timeout: 1500, stdio: 'pipe' });
  check('Live local Ollama daemon online and responsive', true);
} catch (e) {
  skip('Live local Ollama daemon', 'Ollama is not running locally on port 11434 (offline fallback active)');
}

// 8. Manual Validation Checkpoints
console.log('\n[8] Manual Validation Requirements:');
manual('Browser Extension UI', 'Load unpacked extension in Brave/Chrome via chrome://extensions, pin extension, and press Alt+Shift+A to verify side panel opens');
manual('First-run Pairing UI', 'Start engine (`npm run start:engine`), copy pairing code into Settings tab, click Pair Engine, and verify green status pill');
manual('Workspace Approval UI', 'In Side Panel Settings tab, approve a project folder and verify file actions succeed in that folder and are blocked outside');
manual('Voice Input Dictation', 'Click microphone icon in Side Panel and speak test instruction (requires browser Web Speech microphone permission)');

// Summary & Status
console.log(`
=====================================================
                 VERIFICATION REPORT
=====================================================
  Passed:              ${summary.passed}
  Failed:              ${summary.failed}
  Skipped:             ${summary.skipped}
  Manual Required:     ${summary.manualRequired}
-----------------------------------------------------
  Overall Outcome:     ${allPassed ? 'VERIFIED FOR THE TESTED SCOPE' : 'BLOCKED / FAILED'}
=====================================================
`);

if (!allPassed) {
  process.exit(1);
}
