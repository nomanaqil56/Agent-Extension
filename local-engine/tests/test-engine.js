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
      requireApprovalForShell: false, // automatic for base testing
      requireApprovalForFileWrite: false,
      requireApprovalForFileDelete: false, // approval specifically tested in Approval Enforcement tests
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

  // 3. Parameter Alias Handling Regression Tests
  await test('Parameter Mismatch Regression: write_file accepts targetFile / path / filePath', async () => {
    const aliasPath = path.join(workspaceRoot, 'local-engine', 'tests', 'test_alias.tmp');
    // Call using targetFile alias
    await tools.execute('write_file', { targetFile: aliasPath, content: 'Alias Content' });
    // Call using path alias
    const read1 = await tools.execute('read_file', { path: aliasPath });
    assert.strictEqual(read1.result.content, 'Alias Content');
    // Call using filePath
    const info = await tools.execute('file_info', { filePath: aliasPath });
    assert.strictEqual(info.result.exists, true);
    // Delete using delete_file with path alias
    const del = await tools.execute('delete_file', { path: aliasPath });
    assert.strictEqual(del.result.deleted, true);
    assert.strictEqual(fs.existsSync(aliasPath), false);
  });

  // 4. Path Traversal & Symlink Defense
  await test('Path Traversal: Rejects traversal with dot-dot escape', async () => {
    const traversal = path.join(workspaceRoot, '..', '..', 'Windows', 'win.ini');
    assert.strictEqual(permManager.isPathApproved(traversal), false);
  });

  await test('Path Defense: Rejects null-byte injection in path', async () => {
    assert.strictEqual(permManager.isPathApproved(workspaceRoot + '\0/evil.txt'), false);
  });

  // 5. Interactive Approval & Denial Enforcement
  await test('Approval Enforcement: Approval request can be authorized', async () => {
    const approvalConfig = {
      ...testConfig,
      security: { requireApprovalForShell: true }
    };
    const approvalPM = new PermissionManager(approvalConfig);
    const approvalTools = new ToolRegistry(approvalPM, auditLogger, emergencyCoord, mockServerContext);

    let caughtReq = null;
    const execPromise = approvalTools.execute('execute_command', { command: 'echo "Approved cmd"' }, (req) => {
      caughtReq = req;
      // Simulate user clicking "Authorize Action" in extension UI
      approvalPM.resolveApproval(req.approvalId, true);
    });

    const res = await execPromise;
    assert.ok(caughtReq);
    assert.strictEqual(res.result.success, true);
  });

  await test('Approval Enforcement: Denied action stops execution', async () => {
    const approvalConfig = {
      ...testConfig,
      security: { requireApprovalForShell: true }
    };
    const approvalPM = new PermissionManager(approvalConfig);
    const approvalTools = new ToolRegistry(approvalPM, auditLogger, emergencyCoord, mockServerContext);

    let denied = false;
    try {
      await approvalTools.execute('execute_command', { command: 'echo "Denied cmd"' }, (req) => {
        // Simulate user clicking "Deny"
        approvalPM.resolveApproval(req.approvalId, false);
      });
    } catch (err) {
      denied = err.message.includes('denied by the user');
    }
    assert.strictEqual(denied, true, 'Action should have been denied by the user');
  });

  // 6. Terminal Execution
  await test('Terminal Tool: Executes shell command and captures stdout', async () => {
    const cmd = 'echo "Antigravity Terminal Test"';
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

  // 7. Desktop Telemetry
  await test('Desktop Tool: Queries host system telemetry', async () => {
    const res = await tools.execute('get_system_info', {});
    assert.ok(res.result.platform);
    assert.ok(res.result.memory);
    assert.ok(res.result.cpus > 0);
  });

  // 8. Emergency Stop & Tool Blocking
  await test('Emergency Coordinator: Kills processes and halts execution', async () => {
    const stopResult = await emergencyCoord.emergencyStop();
    assert.strictEqual(stopResult.status, 'HALTED');
    assert.strictEqual(emergencyCoord.isEmergencyHalted(), true);

    // Verify that further tool executions are blocked while halted
    let executionPrevented = false;
    try {
      await tools.execute('get_system_info', {});
    } catch (err) {
      executionPrevented = err.message.includes('Emergency Stop');
    }
    assert.strictEqual(executionPrevented, true, 'Tool execution should be prevented after Emergency Stop');
    emergencyCoord.resetHalt();
  });

  // 9. Hybrid AI Provider Routing & Fallback Metadata
  await test('Hybrid Provider: Routes to Autonomous Engine and reports fallback metadata when no keys configured', async () => {
    const { createProvider, FallbackAgentProvider } = require('../src/agent/providers');
    const hybrid = createProvider('hybrid', {}, tools);
    assert.ok(hybrid.provider instanceof FallbackAgentProvider);
    assert.strictEqual(hybrid.activeProviderName, 'autonomous');
    assert.strictEqual(hybrid.isFallback, true);
    assert.ok(hybrid.fallbackReason.includes('Hybrid AI'));
  });

  await test('Provider Fallback: Reports missing key when cloud provider explicitly requested', async () => {
    const { createProvider } = require('../src/agent/providers');
    const gemini = createProvider('gemini', {}, tools);
    assert.strictEqual(gemini.isFallback, true);
    assert.strictEqual(gemini.activeProviderName, 'autonomous');
    assert.ok(gemini.fallbackReason.includes('Gemini API key missing'));
  });

  // 10. Audit Logging
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
