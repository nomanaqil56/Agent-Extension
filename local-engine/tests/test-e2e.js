// Antigravity Local Agent Engine - End-to-End WebSocket Bridge Test

const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

async function runE2ETest() {
  console.log('🧪 Starting Antigravity E2E Server & WebSocket Bridge Test...\n');

  const serverProcess = spawn('node', ['src/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, ENGINE_PORT: '3729', ENGINE_AUTH_TOKEN: 'e2e_test_token' }
  });

  serverProcess.stdout.on('data', (d) => {
    // console.log(`[Server] ${d.toString().trim()}`);
  });

  // Wait for server to bind
  await delay(1200);

  const wsUrl = 'ws://localhost:3729?token=e2e_test_token';
  const ws = new WebSocket(wsUrl);

  const receivedEvents = [];

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('E2E test timed out waiting for events')), 10000);

    ws.on('open', () => {
      console.log('  ✓ Connected to E2E WebSocket server');

      // 1. Register extension client
      ws.send(JSON.stringify({
        type: 'CLIENT_REGISTER',
        role: 'browser_extension',
        version: '1.0.0'
      }));

      // 2. Dispatch simulated agent user task
      ws.send(JSON.stringify({
        type: 'USER_TASK',
        task: 'Check host system telemetry and memory',
        provider: 'fallback'
      }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      receivedEvents.push(msg.type);

      if (msg.type === 'AGENT_THOUGHT') {
        console.log(`  ✓ Received Agent Thought: "${msg.thought.slice(0, 50)}..."`);
      } else if (msg.type === 'TOOL_START') {
        console.log(`  ✓ Received Tool Start: ${msg.tool}`);
      } else if (msg.type === 'TOOL_FINISH') {
        console.log(`  ✓ Received Tool Finish: ${msg.tool}`);
      } else if (msg.type === 'TASK_COMPLETE') {
        console.log('  ✓ Received Task Complete Summary');
        clearTimeout(timeout);
        resolve();
      }
    });

    ws.on('error', reject);
  });

  ws.close();
  serverProcess.kill('SIGTERM');

  assert.ok(receivedEvents.includes('AGENT_THOUGHT'), 'Should have received AGENT_THOUGHT');
  assert.ok(receivedEvents.includes('TOOL_START'), 'Should have received TOOL_START');
  assert.ok(receivedEvents.includes('TASK_COMPLETE'), 'Should have received TASK_COMPLETE');

  console.log('\n================================');
  console.log('🎉 E2E WebSocket Agent Flow PASSED');
  console.log('================================\n');
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

runE2ETest().catch(err => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
