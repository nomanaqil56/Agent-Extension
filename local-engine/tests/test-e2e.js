// Antigravity Local Agent Engine - End-to-End WebSocket Bridge & Authentication Test Suite

const WebSocket = require('ws');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body: json || data });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runE2ETest() {
  console.log('🧪 Starting Antigravity E2E Server, Auth & WebSocket Bridge Test...\n');

  const TEST_PORT = 3729;
  const TEST_TOKEN = 'e2e_secret_token_12345';
  const TEST_PAIRING = 'PAIR99';
  const testConfigPath = path.join(__dirname, 'fixtures', 'test-e2e-config.json');

  let serverProcess = null;

  try {
    serverProcess = spawn('node', ['src/server.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        ENGINE_PORT: String(TEST_PORT),
        ENGINE_AUTH_TOKEN: TEST_TOKEN,
        ENGINE_PAIRING_CODE: TEST_PAIRING,
        ENGINE_CONFIG_PATH: testConfigPath
      }
    });

    serverProcess.stdout.on('data', (d) => {
      // console.log(`[Server] ${d.toString().trim()}`);
    });
    serverProcess.stderr.on('data', (d) => {
      // console.error(`[Server Err] ${d.toString().trim()}`);
    });

    // Wait for server to bind
    await delay(1500);

    // --- TEST 1: First-Run Pairing Flow (POST /pair) ---
    console.log('[Test 1] Testing loopback-only Pairing flow (POST /pair)...');

    // 1a. Invalid pairing code
    const invalidPair = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/pair',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { pairingCode: 'WRONG_CODE' });

    assert.strictEqual(invalidPair.statusCode, 401, 'Invalid pairing code should be rejected with 401');
    console.log('  ✓ Invalid pairing code rejected with 401');

    // 1b. Valid pairing code retrieves token
    const validPair = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/pair',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { pairingCode: TEST_PAIRING });

    assert.strictEqual(validPair.statusCode, 200, 'Valid pairing code should succeed with 200');
    assert.strictEqual(validPair.body.token, TEST_TOKEN, 'Pairing must return authentic session token');
    console.log('  ✓ Valid pairing code retrieves security token');

    // --- TEST 2: Settings Synchronization (POST /config and GET /config) ---
    console.log('\n[Test 2] Testing Authenticated Settings Synchronization...');

    // 2a. Unauthenticated /config rejected
    const unauthConfig = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'GET'
    });
    assert.strictEqual(unauthConfig.statusCode, 401, 'Unauthenticated /config must return 401');
    console.log('  ✓ Unauthenticated /config blocked');

    // 2b. Authenticated update of provider settings
    const updateConfig = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      activeProvider: 'hybrid',
      hybridRoutingPolicy: 'privacy-first',
      geminiApiKey: 'AIzaSyE2ETestKeySecret123',
      ollamaUrl: 'http://localhost:11434'
    });
    assert.strictEqual(updateConfig.statusCode, 200, 'Authenticated /config update must succeed');
    assert.strictEqual(updateConfig.body.hybridRoutingPolicy, 'privacy-first');
    console.log('  ✓ Settings updated via POST /config');

    // 2c. Verify masked secrets in GET /config
    const getConfig = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'GET',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    assert.strictEqual(getConfig.statusCode, 200);
    assert.strictEqual(getConfig.body.hasGeminiKey, true);
    assert.ok(getConfig.body.geminiApiKey.includes('••••'), 'Secret key must be masked in GET /config');
    assert.strictEqual(getConfig.body.hybridRoutingPolicy, 'privacy-first');
    console.log('  ✓ GET /config returns masked secrets and applied settings');

    // --- TEST 3: WebSocket Authentication Failure (Clean Code 4003) ---
    console.log('\n[Test 3] Testing WebSocket Handshake Authentication Failure...');
    await new Promise((resolve, reject) => {
      // Connect without query token
      const wsBad = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      let authFailedReceived = false;

      wsBad.on('open', () => {
        // Send incorrect token in handshake message
        wsBad.send(JSON.stringify({
          type: 'AUTH_HANDSHAKE',
          token: 'invalid_token_xyz'
        }));
      });

      wsBad.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AUTH_FAILED') {
          authFailedReceived = true;
          console.log('  ✓ Received AUTH_FAILED message from server');
        }
      });

      wsBad.on('close', (code, reason) => {
        try {
          assert.strictEqual(authFailedReceived, true, 'Should have received AUTH_FAILED message');
          assert.strictEqual(code, 4003, 'Socket should be closed with code 4003 on auth failure');
          console.log(`  ✓ Socket closed cleanly with Code ${code} (${reason || 'Invalid token'})`);
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      wsBad.on('error', () => {
        // Expected on forced close
      });
    });

    // --- TEST 4: WebSocket Authentication Handshake Success & Task Execution ---
    console.log('\n[Test 4] Testing WebSocket Handshake Success & Task Execution...');
    await new Promise((resolve, reject) => {
      // Connect without query token
      const wsGood = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      const receivedEvents = [];

      const timeout = setTimeout(() => {
        wsGood.close();
        reject(new Error('WebSocket flow timed out'));
      }, 12000);

      wsGood.on('open', () => {
        console.log('  ✓ Raw WebSocket opened without token in URL');
        // Send authenticated handshake
        wsGood.send(JSON.stringify({
          type: 'AUTH_HANDSHAKE',
          token: TEST_TOKEN
        }));
      });

      wsGood.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        receivedEvents.push(msg.type);

        if (msg.type === 'ENGINE_STATUS') {
          if (msg.authenticated && msg.connected) {
            console.log('  ✓ Authenticated ENGINE_STATUS received');
            // Register extension client
            wsGood.send(JSON.stringify({
              type: 'CLIENT_REGISTER',
              role: 'browser_extension',
              version: '1.0.0'
            }));

            // Dispatch simulated user task
            wsGood.send(JSON.stringify({
              type: 'USER_TASK',
              task: 'Query system memory and diagnostic telemetry',
              provider: 'fallback'
            }));
          }
        } else if (msg.type === 'AGENT_THOUGHT') {
          console.log(`  ✓ Agent Thought: "${msg.thought.slice(0, 45)}..."`);
        } else if (msg.type === 'TOOL_START') {
          console.log(`  ✓ Tool Start: ${msg.tool}`);
        } else if (msg.type === 'TOOL_FINISH') {
          console.log(`  ✓ Tool Finish: ${msg.tool}`);
        } else if (msg.type === 'TASK_COMPLETE') {
          console.log('  ✓ Task Complete received');
          clearTimeout(timeout);
          wsGood.close();

          try {
            assert.ok(receivedEvents.includes('ENGINE_STATUS'), 'Must receive ENGINE_STATUS');
            assert.ok(receivedEvents.includes('AGENT_THOUGHT'), 'Must receive AGENT_THOUGHT');
            assert.ok(receivedEvents.includes('TOOL_START'), 'Must receive TOOL_START');
            assert.ok(receivedEvents.includes('TASK_COMPLETE'), 'Must receive TASK_COMPLETE');
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      });

      wsGood.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    console.log('\n================================');
    console.log('🎉 E2E WebSocket & Auth Suite PASSED (5/5 Tests)');
    console.log('================================\n');

  } finally {
    // Guaranteed cleanup: Terminate spawned server process even if tests throw
    if (serverProcess) {
      try {
        serverProcess.kill('SIGTERM');
        // On Windows, child processes might need tree termination
        if (process.platform === 'win32' && serverProcess.pid) {
          try {
            const { execSync } = require('child_process');
            execSync(`taskkill /pid ${serverProcess.pid} /T /F`, { stdio: 'ignore' });
          } catch (e) {}
        }
      } catch (e) {}
      console.log('  ✓ Server child process terminated cleanly.');
    }
    if (fs.existsSync(testConfigPath)) {
      try { fs.unlinkSync(testConfigPath); } catch (e) {}
    }
  }
}

runE2ETest().catch(err => {
  console.error('\n❌ E2E test failed:', err);
  process.exit(1);
});
