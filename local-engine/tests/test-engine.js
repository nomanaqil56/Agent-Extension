// Antigravity Local Agent Engine - Automated Unit & Integration Tests

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const PermissionManager = require('../src/security/permissions');
const AuditLogger = require('../src/security/audit');
const EmergencyCoordinator = require('../src/security/emergency');
const ToolRegistry = require('../src/tools');

async function runTests() {
  console.log('🧪 Starting Antigravity Local Agent Engine Test Suite...\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    Error: ${err.message}\n`);
      failed++;
    }
  }

  const workspaceRoot = path.resolve(__dirname, '..', '..');
  const testConfig = {
    port: 3721,
    approvedDirectories: [workspaceRoot],
    approvedApplications: ['code', 'notepad', 'calc', 'git'],
    security: {
      requireApprovalForShell: false, // automatic for testing
      blockedShellPatterns: ['format\\s+[a-zA-Z]:', 'rmdir\\s+/[sS]']
    }
  };

  const permManager = new PermissionManager(testConfig);
  const auditLogger = new AuditLogger(path.join(__dirname, 'test-logs'));
  const emergencyCoord = new EmergencyCoordinator(permManager, auditLogger);
  const mockServerContext = { getExtensionClient: () => null };
  const tools = new ToolRegistry(permManager, auditLogger, emergencyCoord, mockServerContext);

  // 1. Filesystem Permissions & Scoping
  await test('File Scope: Allows approved directory path', async () => {
    assert.strictEqual(permManager.isPathApproved(path.join(workspaceRoot, 'package.json')), true);
  });

  await test('File Scope: Rejects path traversal outside approved directory', async () => {
    const forbiddenPath = 'C:\\Windows\\System32\\calc.exe';
    assert.strictEqual(permManager.isPathApproved(forbiddenPath), false);
  });

  // 2. File Operations
  const testFilePath = path.join(workspaceRoot, 'local-engine', 'tests', 'test_artifact.tmp');
  await test('Files Tool: write_file and read_file', async () => {
    await tools.execute('write_file', { filePath: testFilePath, content: 'Antigravity Unit Test Line 1\nLine 2' });
    const read = await tools.execute('read_file', { filePath: testFilePath });
    assert.strictEqual(read.result.content.includes('Antigravity Unit Test'), true);
  });

  await test('Files Tool: patch_file replaces text', async () => {
    await tools.execute('patch_file', {
      filePath: testFilePath,
      targetContent: 'Line 2',
      replacementContent: 'Line 2 Patched Successfully'
    });
    const read = await tools.execute('read_file', { filePath: testFilePath });
    assert.strictEqual(read.result.content.includes('Line 2 Patched Successfully'), true);
  });

  // Clean up test artifact
  if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

  // 3. Terminal Execution
  await test('Terminal Tool: Executes shell command and captures stdout', async () => {
    const cmd = process.platform === 'win32' ? 'echo "Antigravity Terminal Test"' : 'echo "Antigravity Terminal Test"';
    const res = await tools.execute('execute_command', { command: cmd });
    assert.strictEqual(res.result.success, true);
    assert.strictEqual(res.result.stdout.includes('Antigravity Terminal Test'), true);
  });

  await test('Terminal Tool: Security blocks malicious command pattern', async () => {
    let blocked = false;
    try {
      await tools.execute('execute_command', { command: 'format C: /fs:NTFS' });
    } catch (e) {
      blocked = true;
    }
    assert.strictEqual(blocked, true);
  });

  // 4. Desktop Telemetry
  await test('Desktop Tool: Queries host system telemetry', async () => {
    const res = await tools.execute('get_system_info', {});
    assert.ok(res.result.platform);
    assert.ok(res.result.memory);
    assert.ok(res.result.cpus > 0);
  });

  // 5. Emergency Stop
  await test('Emergency Coordinator: Kills processes and cancels pending', async () => {
    const stopResult = await emergencyCoord.emergencyStop();
    assert.strictEqual(stopResult.status, 'HALTED');
  });

  // 6. Audit Logging
  await test('Audit Logger: Records and retrieves events', async () => {
    const entries = auditLogger.getRecentEntries(10);
    assert.ok(entries.length > 0);
    assert.ok(entries.some(e => e.action === 'TOOL_EXECUTION'));
  });

  // Clean up test log directory
  try {
    fs.rmSync(path.join(__dirname, 'test-logs'), { recursive: true, force: true });
  } catch (e) {}

  console.log(`\n================================`);
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log(`================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution fatal error:', err);
  process.exit(1);
});
