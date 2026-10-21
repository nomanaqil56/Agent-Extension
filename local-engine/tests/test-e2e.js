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

    // 1c. Replay rejection: Re-submitting consumed pairing code must return 409
    const replayPair = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/pair',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { pairingCode: TEST_PAIRING });

    assert.strictEqual(replayPair.statusCode, 409, 'Replay of consumed pairing code must be rejected with 409');
    console.log('  ✓ Reused pairing code rejected with 409 (Single-use consumption enforced)');

    // 1d. Host Header Spoofing on /pair: Host header pointing to external domain must be rejected
    const spoofedHostPair = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/pair',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'attacker.evil.com:3721'
      }
    }, { pairingCode: 'ANY_CODE' });
    assert.strictEqual(spoofedHostPair.statusCode, 403, 'Spoofed external Host header on /pair must be rejected with 403');
    console.log('  ✓ Spoofed Host header rejected with 403 on /pair');

    // 1e. CORS Origin Validation: Untrusted web origins must be rejected
    const untrustedOrigin = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/health',
      method: 'GET',
      headers: {
        Origin: 'https://attacker.evil.com'
      }
    });
    assert.ok(untrustedOrigin.statusCode === 403 || untrustedOrigin.statusCode === 500, 'Untrusted web origin must trigger CORS error (403 or 500)');
    console.log('  ✓ Untrusted web origin rejected by CORS policy');

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

    // 2d. Explicit credential deletion
    const deleteCredConfig = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      geminiApiKey: ''
    });
    assert.strictEqual(deleteCredConfig.statusCode, 200);
    assert.strictEqual(deleteCredConfig.body.hasGeminiKey, false, 'Passing empty string must delete credential');
    console.log('  ✓ Explicit credential deletion works');

    // 2e. Re-add credential and verify masked placeholder does NOT overwrite
    await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      geminiApiKey: 'AIzaSyNewKey98765'
    });

    // Send update with masked string
    const preserveConfig = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      geminiApiKey: 'AIz••••765',
      hybridRoutingPolicy: 'balanced'
    });
    assert.strictEqual(preserveConfig.body.hasGeminiKey, true, 'Masked placeholder must not delete or overwrite secret');
    console.log('  ✓ Masked placeholder does not overwrite real secret');

    // 2f. Validation: Invalid provider enum rejected with 400
    const invalidProviderConfig = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      activeProvider: 'unsupported-provider-999'
    });
    assert.strictEqual(invalidProviderConfig.statusCode, 400, 'Invalid provider name must return 400');
    console.log('  ✓ Invalid provider name rejected with 400');

    // 2g. Validation: Invalid policy enum rejected with 400
    const invalidPolicyConfig = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      hybridRoutingPolicy: 'invalid-policy-name'
    });
    assert.strictEqual(invalidPolicyConfig.statusCode, 400, 'Invalid routing policy name must return 400');
    console.log('  ✓ Invalid routing policy rejected with 400');

    // 2h. Validation: Malformed Ollama URL rejected with 400
    const invalidUrlConfig = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      ollamaUrl: 'not-a-valid-url-format'
    });
    assert.strictEqual(invalidUrlConfig.statusCode, 400, 'Malformed URL must return 400');
    console.log('  ✓ Malformed Ollama URL rejected with 400');

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

            // Dispatch simulated user task with unique conversationId
            wsGood.send(JSON.stringify({
              type: 'USER_TASK',
              conversationId: 'conv_e2e_session_999',
              task: 'Query system memory and diagnostic telemetry',
              provider: 'fallback'
            }));
          }
        } else if (msg.type === 'AGENT_THOUGHT') {
          assert.strictEqual(msg.conversationId, 'conv_e2e_session_999', 'AGENT_THOUGHT must carry initiating conversationId');
          console.log(`  ✓ Agent Thought: "${msg.thought.slice(0, 45)}..." (Conv: ${msg.conversationId})`);
        } else if (msg.type === 'TOOL_START') {
          assert.strictEqual(msg.conversationId, 'conv_e2e_session_999', 'TOOL_START must carry initiating conversationId');
          console.log(`  ✓ Tool Start: ${msg.tool}`);
        } else if (msg.type === 'TOOL_FINISH') {
          assert.strictEqual(msg.conversationId, 'conv_e2e_session_999', 'TOOL_FINISH must carry initiating conversationId');
          console.log(`  ✓ Tool Finish: ${msg.tool}`);
        } else if (msg.type === 'TASK_COMPLETE') {
          assert.strictEqual(msg.conversationId, 'conv_e2e_session_999', 'TASK_COMPLETE must carry initiating conversationId');
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

    // --- TEST 5: Emergency Stop HTTP Lifecycle & Explicit Reset ---
    console.log('\n[Test 5] Testing Emergency Stop HTTP Lifecycle & Explicit Reset...');
    
    // 5a. Trigger emergency stop
    const stopRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/emergency-stop',
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    assert.strictEqual(stopRes.statusCode, 200);
    assert.strictEqual(stopRes.body.status, 'HALTED');
    console.log('  ✓ Emergency stop initiated via POST /emergency-stop');

    // 5b. Attempting task while halted must return 409
    const haltedTaskRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/task',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      task: 'Check telemetry diagnostics',
      provider: 'autonomous'
    });
    assert.strictEqual(haltedTaskRes.statusCode, 409, 'New task while emergency stop is active must return 409');
    assert.strictEqual(haltedTaskRes.body.halted, true);
    console.log('  ✓ New task blocked with 409 while emergency stop is active');

    // 5c. Explicit reset clears halt state
    const resetRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/emergency-stop/reset',
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    assert.strictEqual(resetRes.statusCode, 200);
    assert.strictEqual(resetRes.body.halted, false);
    console.log('  ✓ Explicit reset clears halt state via POST /emergency-stop/reset');

    // 5d. Task succeeds after explicit reset
    const resumedTaskRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/task',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      task: 'Check telemetry diagnostics',
      provider: 'autonomous'
    });
    assert.strictEqual(resumedTaskRes.statusCode, 200, 'Task must succeed after emergency stop is explicitly reset');
    console.log('  ✓ Task succeeds after emergency stop is explicitly reset');

    // --- TEST 6: Extension-Origin & CORS Restrictions (P1 — 4) ---
    console.log('\n[Test 6] Testing Extension-Origin & CORS Restrictions...');

    // 6a. Set explicit allowed extension ID via POST /config
    const ALLOWED_EXT_ID = 'testallowedextension123456';
    const configWithAllowlist = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      allowedExtensionIds: [ALLOWED_EXT_ID]
    });
    assert.strictEqual(configWithAllowlist.statusCode, 200);

    // 6b. Authorized extension origin is permitted
    const authOriginRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/health',
      method: 'GET',
      headers: {
        Origin: `chrome-extension://${ALLOWED_EXT_ID}`
      }
    });
    assert.strictEqual(authOriginRes.statusCode, 200, 'Authorized extension origin must be permitted with 200');
    console.log('  ✓ Authorized extension origin permitted');

    // 6c. Unauthorized extension origin is rejected with 403
    const unauthOriginRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/health',
      method: 'GET',
      headers: {
        Origin: 'chrome-extension://unauthorizedextensionid999999'
      }
    });
    assert.strictEqual(unauthOriginRes.statusCode, 403, 'Unauthorized extension origin must be rejected with 403');
    assert.ok(unauthOriginRes.body.error.includes('allowedExtensionIds'), 'Error must cite allowedExtensionIds');
    console.log('  ✓ Unauthorized extension origin rejected with 403');

    // 6d. Untrusted website origin rejected with 403
    const websiteOriginRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/health',
      method: 'GET',
      headers: {
        Origin: 'https://evil-phishing-site.com'
      }
    });
    assert.strictEqual(websiteOriginRes.statusCode, 403, 'Untrusted web origin must be rejected with 403');
    console.log('  ✓ Untrusted website origin rejected with 403');

    // 6e. Request without Origin header (CLI/test client) permitted
    const noOriginRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/health',
      method: 'GET'
    });
    assert.strictEqual(noOriginRes.statusCode, 200, 'Request without Origin header must be permitted');
    console.log('  ✓ Request without Origin header permitted');

    // 6f. Authentication independent of CORS: authorized origin without auth token still fails with 401
    const corsAuthIndependent = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/workspaces',
      method: 'GET',
      headers: {
        Origin: `chrome-extension://${ALLOWED_EXT_ID}`
      }
    });
    assert.strictEqual(corsAuthIndependent.statusCode, 401, 'Protected endpoint without auth token must return 401 even from authorized origin');
    console.log('  ✓ Authentication is strictly independent of CORS');

    // 6g. WebSocket Upgrade with untrusted origin rejected
    let wsUntrustedRejected = false;
    try {
      await new Promise((resolve, reject) => {
        const badWs = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`, {
          headers: { Origin: 'https://malicious-web-app.org' }
        });
        badWs.on('open', () => {
          badWs.close();
          reject(new Error('WebSocket with malicious origin should not open'));
        });
        badWs.on('error', () => {
          resolve();
        });
        badWs.on('unexpected-response', (req, res) => {
          assert.strictEqual(res.statusCode, 403);
          resolve();
        });
      });
      wsUntrustedRejected = true;
    } catch (e) {
      wsUntrustedRejected = false;
    }
    assert.strictEqual(wsUntrustedRejected, true, 'WebSocket upgrade with untrusted origin must be rejected');
    console.log('  ✓ WebSocket upgrade rejects untrusted origin');

    // --- TEST 7: Failure Injection & Transactional Configuration Persistence (P1 — 6) ---
    console.log('\n[Test 7] Testing Transactional Configuration Persistence & Durability...');

    // 7a. Verify durability: Saved configuration matches on disk
    const durableUpdate = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      hybridRoutingPolicy: 'cloud-preferred',
      ollamaModel: 'mistral'
    });
    assert.strictEqual(durableUpdate.statusCode, 200);

    // Verify disk content directly
    const diskContent = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
    assert.strictEqual(diskContent.hybridRoutingPolicy, 'cloud-preferred');
    assert.strictEqual(diskContent.ollamaModel, 'mistral');
    console.log('  ✓ Configuration changes durably persisted to disk');

    // 7b. Invalid payload rejected: in-memory state remains untouched
    const badUpdate = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`
      }
    }, {
      hybridRoutingPolicy: 'invalid-nonexistent-policy'
    });
    assert.strictEqual(badUpdate.statusCode, 400);

    // Verify in-memory state remained consistent (not corrupted)
    const checkConfig = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/config',
      method: 'GET',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    assert.strictEqual(checkConfig.body.hybridRoutingPolicy, 'cloud-preferred');
    console.log('  ✓ Failed updates maintain in-memory state consistency without corruption');

    console.log('\n================================');
    console.log('🎉 E2E WebSocket, Auth, Origin & Persistence Suite PASSED (7/7 Tests)');
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
