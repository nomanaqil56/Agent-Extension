// Antigravity Local Agent Engine - Automated Unit & Integration Tests

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const PermissionManager = require('../src/security/permissions');
const AuditLogger = require('../src/security/audit');
const EmergencyCoordinator = require('../src/security/emergency');
const ToolRegistry = require('../src/tools');
const { createProvider, HybridRouter, FallbackAgentProvider, OllamaProvider } = require('../src/agent/providers');

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
  const testLogsDir = path.join(__dirname, 'test-logs');
  const testConfig = {
    port: 3721,
    approvedDirectories: [workspaceRoot],
    approvedApplications: ['code', 'notepad', 'calc', 'git'],
    security: {
      requireApprovalForShell: false, // automated for base execution tests
      requireApprovalForFileWrite: false, // automated for base file tests
      requireApprovalForFileDelete: false,
      requireApprovalForClipboardRead: false,
      blockedShellPatterns: ['format\\s+[a-zA-Z]:', 'rmdir\\s+/[sS]']
    }
  };

  const permManager = new PermissionManager(testConfig);
  const auditLogger = new AuditLogger(testLogsDir);
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

  // 5. Default Approval Policy Enforcements (Phase 10.5 & Phase 14)
  await test('Security Policy: File write requires approval by default', async () => {
    const defaultSecurePM = new PermissionManager({
      approvedDirectories: [workspaceRoot],
      security: { requireApprovalForFileWrite: true }
    });
    const secureTools = new ToolRegistry(defaultSecurePM, auditLogger, emergencyCoord, mockServerContext);
    const target = path.join(workspaceRoot, 'local-engine', 'tests', 'test_approval_write.tmp');

    // 1. Without approval handler: must fail fast
    let failedWithoutApproval = false;
    try {
      await secureTools.execute('write_file', { filePath: target, content: 'Data' });
    } catch (e) {
      failedWithoutApproval = e.message.includes('requires user approval');
    }
    assert.strictEqual(failedWithoutApproval, true, 'Write must fail fast if unapproved');

    // 2. With approval handler: succeeds
    let caughtReq = null;
    await secureTools.execute('write_file', { filePath: target, content: 'Approved Data' }, (req) => {
      caughtReq = req;
      defaultSecurePM.resolveApproval(req.approvalId, true);
    });
    assert.ok(caughtReq, 'Approval callback must be triggered');
    assert.strictEqual(fs.existsSync(target), true);

    if (fs.existsSync(target)) fs.unlinkSync(target);
  });

  await test('Security Policy: Sensitive files require explicit user approval to inspect', async () => {
    const securePM = new PermissionManager({
      approvedDirectories: [workspaceRoot],
      security: { requireApprovalForFileWrite: false }
    });
    const secureTools = new ToolRegistry(securePM, auditLogger, emergencyCoord, mockServerContext);
    const envPath = path.join(workspaceRoot, 'local-engine', '.env.example');

    let approvalTriggered = false;
    await secureTools.execute('read_file', { filePath: envPath }, (req) => {
      approvalTriggered = true;
      assert.ok(req.actionType.includes('Sensitive credential file'));
      securePM.resolveApproval(req.approvalId, true);
    });
    assert.strictEqual(approvalTriggered, true, 'Sensitive file read must trigger approval');
  });

  await test('Approval Enforcement: Denied action stops execution cleanly', async () => {
    const approvalConfig = {
      ...testConfig,
      security: { requireApprovalForShell: true }
    };
    const approvalPM = new PermissionManager(approvalConfig);
    const approvalTools = new ToolRegistry(approvalPM, auditLogger, emergencyCoord, mockServerContext);

    let denied = false;
    try {
      await approvalTools.execute('execute_command', { command: 'echo "Denied cmd"' }, (req) => {
        approvalPM.resolveApproval(req.approvalId, false);
      });
    } catch (err) {
      denied = err.message.includes('denied by the user');
    }
    assert.strictEqual(denied, true, 'Action should have been denied by the user');
  });

  // 6. Dynamic Workspace Management (Phase 10.2)
  await test('Workspace Management: Dynamic add, list, and removal', async () => {
    const testDir = path.join(workspaceRoot, 'local-engine', 'tests');
    const initialList = permManager.getApprovedDirectories();
    assert.ok(initialList.length >= 1);

    permManager.addApprovedDirectory(testDir);
    assert.ok(permManager.isPathApproved(testDir));

    const removed = permManager.removeApprovedDirectory(testDir);
    assert.strictEqual(removed, true);
  });

  // 7. Terminal Tool Execution & Malicious Pattern Blocking
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

  await test('Terminal Tool: Process cancellation propagates via AbortSignal', async () => {
    const controller = new AbortController();
    const cmdPromise = tools.execute('execute_command', { command: 'powershell -Command "Start-Sleep -Seconds 10"' }, null, controller.signal);

    // Abort after 300ms
    setTimeout(() => controller.abort(), 300);

    let aborted = false;
    try {
      await cmdPromise;
    } catch (e) {
      aborted = e.message.includes('cancelled') || e.message.includes('aborted');
    }
    assert.strictEqual(aborted, true, 'Command execution must abort upon signal');
  });

  // 8. Desktop Telemetry & Clipboard Security
  await test('Desktop Tool: Queries host system telemetry', async () => {
    const res = await tools.execute('get_system_info', {});
    assert.ok(res.result.platform);
    assert.ok(res.result.memory);
    assert.ok(res.result.cpus > 0);
  });

  await test('Desktop Tool: Clipboard read requires approval when enabled', async () => {
    const clipPM = new PermissionManager({
      approvedDirectories: [workspaceRoot],
      security: { requireApprovalForClipboardRead: true }
    });
    const clipTools = new ToolRegistry(clipPM, auditLogger, emergencyCoord, mockServerContext);

    let approvalPrompted = false;
    const clipPromise = clipTools.execute('clipboard_read', {}, (req) => {
      approvalPrompted = true;
      clipPM.resolveApproval(req.approvalId, true);
    });

    await clipPromise;
    assert.strictEqual(approvalPrompted, true, 'Clipboard read must require approval');
  });

  // 9. Emergency Stop & Tool Blocking
  await test('Emergency Coordinator: Kills processes and halts execution', async () => {
    const stopResult = await emergencyCoord.emergencyStop();
    assert.strictEqual(stopResult.status, 'HALTED');
    assert.strictEqual(emergencyCoord.isEmergencyHalted(), true);

    let executionPrevented = false;
    try {
      await tools.execute('get_system_info', {});
    } catch (err) {
      executionPrevented = err.message.includes('Emergency Stop');
    }
    assert.strictEqual(executionPrevented, true, 'Tool execution should be prevented after Emergency Stop');
    emergencyCoord.resetHalt();
  });

  // 10. Browser Navigation Security & URL Validation
  await test('Browser Tool: Validates and blocks dangerous URL navigation schemes', async () => {
    const browserTool = tools.browserTool;
    assert.throws(() => browserTool.validateUrl('javascript:alert(1)'), /Dangerous URL scheme/);
    assert.throws(() => browserTool.validateUrl('chrome://settings'), /Browser internal management page/);
    assert.throws(() => browserTool.validateUrl('file:///C:/Windows/win.ini'), /Direct browser local file access/);
    assert.strictEqual(browserTool.validateUrl('https://example.com'), 'https://example.com');
  });

  // 11. Advanced Hybrid AI Router & Policy Engine (Phase Four)
  await test('Hybrid Router: Privacy-First policy routes local tasks strictly to local/offline engine', async () => {
    const router = new HybridRouter({
      hybridRoutingPolicy: 'privacy-first',
      geminiKey: 'mock-key' // Cloud key present, but must be bypassed for private local tasks!
    });

    const route = router.routeTask({
      task: 'Inspect local project files and read package.json',
      providerName: 'hybrid',
      toolRegistry: tools
    });

    assert.strictEqual(route.policy, 'privacy-first');
    assert.strictEqual(route.activeProviderName, 'autonomous');
    assert.ok(route.reason.includes('Privacy-First Policy'));
  });

  await test('Hybrid Router: Balanced policy routes complex reasoning to cloud provider when available', async () => {
    const router = new HybridRouter({
      hybridRoutingPolicy: 'balanced',
      geminiKey: 'mock-gemini-key'
    });

    const route = router.routeTask({
      task: 'Refactor and architect complex database algorithm',
      providerName: 'hybrid',
      toolRegistry: tools
    });

    assert.strictEqual(route.activeProviderName, 'gemini');
    assert.ok(route.reason.includes('Escalated to Cloud LLM'));
  });

  await test('Hybrid Router: Cloud-Preferred policy routes to available cloud model', async () => {
    const router = new HybridRouter({
      hybridRoutingPolicy: 'cloud-preferred',
      anthropicKey: 'mock-claude-key'
    });

    const route = router.routeTask({
      task: 'Summarize webpage',
      providerName: 'hybrid',
      toolRegistry: tools
    });

    assert.strictEqual(route.activeProviderName, 'anthropic');
  });

  await test('Hybrid Router: Manual provider selection reports transparent fallback when key missing', async () => {
    const router = new HybridRouter({});
    const route = router.routeTask({
      task: 'Search page',
      providerName: 'openai',
      toolRegistry: tools
    });

    assert.strictEqual(route.isFallback, true);
    assert.strictEqual(route.activeProviderName, 'autonomous');
    assert.ok(route.fallbackReason.includes('OpenAI API key missing'));
  });

  await test('Ollama Provider: checkHealth returns structured diagnostics', async () => {
    const ollama = new OllamaProvider('http://127.0.0.1:54321', 'test-model'); // unused test port
    const health = await ollama.checkHealth(500);
    assert.strictEqual(health.healthy, false);
    assert.ok(health.error.includes('unreachable'));
  });

  // 12. Audit Logger & Secret Redaction (Phase Twelve)
  await test('Audit Logger: Sanitizes API keys and tokens in logged events', async () => {
    auditLogger.log({
      action: 'TEST_SECRET_REDACTION',
      params: {
        apiKey: 'AIzaSySecretKey12345',
        token: 'secret_token_value',
        url: 'ws://127.0.0.1:3721?token=super_secret_token'
      }
    });

    const recent = auditLogger.getRecentEntries(5);
    const testEntry = recent.find(e => e.action === 'TEST_SECRET_REDACTION');
    assert.ok(testEntry);
    assert.strictEqual(testEntry.params.apiKey, '***REDACTED***');
    assert.strictEqual(testEntry.params.token, '***REDACTED***');
    assert.ok(!JSON.stringify(testEntry).includes('super_secret_token'));
  });

  await test('Audit Logger: clearLog clears records and appends authenticated clear event', async () => {
    const cleared = auditLogger.clearLog('test-suite');
    assert.ok(cleared);
    assert.strictEqual(cleared.action, 'AUDIT_LOG_CLEARED');

    const entries = auditLogger.getRecentEntries(10);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].action, 'AUDIT_LOG_CLEARED');
  });

  // Clean up test log directory
  try {
    fs.rmSync(testLogsDir, { recursive: true, force: true });
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
