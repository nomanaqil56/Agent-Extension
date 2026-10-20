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

  await test('Hybrid Router: Manual provider selection blocks execution when credentials missing without fallback', async () => {
    const router = new HybridRouter({});
    const route = router.routeTask({
      task: 'Search page',
      providerName: 'openai',
      toolRegistry: tools
    });

    assert.strictEqual(route.blocked, true);
    assert.strictEqual(route.activeProviderName, 'openai');
    assert.ok(route.error.includes('OpenAI API key is not configured'));
  });

  await test('Hybrid Router: Manual provider selection falls back only when explicitly enabled', async () => {
    const router = new HybridRouter({ allowFallbackOnMissingCredentials: true });
    const route = router.routeTask({
      task: 'Search page',
      providerName: 'openai',
      toolRegistry: tools
    });

    assert.strictEqual(route.isFallback, true);
    assert.strictEqual(route.activeProviderName, 'autonomous');
    assert.ok(route.fallbackReason.includes('OpenAI API key missing'));
  });

  await test('Hybrid Router: Balanced policy keeps ordinary tasks local even when cloud keys exist', async () => {
    const router = new HybridRouter({
      hybridRoutingPolicy: 'balanced',
      geminiKey: 'mock-gemini-key'
    });

    const route = router.routeTask({
      task: 'Inspect local file list and read package.json',
      providerName: 'hybrid',
      toolRegistry: tools
    });

    assert.strictEqual(route.activeProviderName, 'autonomous');
    assert.ok(route.reason.includes('Balanced Policy: Handled locally'));
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

  // 13. Workspace Removal & Zero-Workspace Lockdown
  await test('Workspace Removal: Can remove approved directory and leave list completely empty', async () => {
    const pm = new PermissionManager({ approvedDirectories: ['D:\\MockWorkspace'] });
    assert.strictEqual(pm.getApprovedDirectories().length, 1);
    const removed = pm.removeApprovedDirectory('D:\\MockWorkspace');
    assert.strictEqual(removed, true);
    assert.strictEqual(pm.getApprovedDirectories().length, 0);
    assert.strictEqual(pm.isWorkspaceConfigured(), false);
  });

  await test('Workspace Lockdown: Denies all filesystem and terminal operations when no workspace is approved', async () => {
    const emptyPM = new PermissionManager({ approvedDirectories: [] });
    assert.strictEqual(emptyPM.isWorkspaceConfigured(), false);
    const emptyTools = new ToolRegistry(emptyPM, auditLogger, emergencyCoord, mockServerContext);

    let fileBlocked = false;
    try {
      await emptyTools.execute('read_file', { filePath: path.join(workspaceRoot, 'package.json') });
    } catch (e) {
      fileBlocked = e.message.includes('No approved workspace directory is configured');
    }
    assert.strictEqual(fileBlocked, true, 'read_file must be blocked when no workspace approved');

    let commandBlocked = false;
    try {
      await emptyTools.execute('execute_command', { command: 'echo hello' });
    } catch (e) {
      commandBlocked = e.message.includes('No approved workspace directory is configured');
    }
    assert.strictEqual(commandBlocked, true, 'execute_command must be blocked when no workspace approved');
  });

  await test('Workspace Access: Requires explicit user action to grant access to another workspace', async () => {
    const pm = new PermissionManager({ approvedDirectories: [] });
    assert.strictEqual(pm.isWorkspaceConfigured(), false);
    pm.addApprovedDirectory(workspaceRoot);
    assert.strictEqual(pm.isWorkspaceConfigured(), true);
    assert.strictEqual(pm.isPathApproved(path.join(workspaceRoot, 'package.json')), true);
  });

  // 14. Settings Synchronization & Dynamic Orchestrator Updates
  await test('Settings Synchronization: Dynamic configuration update propagates to orchestrator and router', async () => {
    const AgentOrchestrator = require('../src/agent/orchestrator');
    const MemoryManager = require('../src/agent/memory');
    const orchestrator = new AgentOrchestrator(tools, new MemoryManager(), {
      activeProvider: 'hybrid',
      hybridRoutingPolicy: 'balanced'
    });

    assert.strictEqual(orchestrator.config.hybridRoutingPolicy, 'balanced');
    orchestrator.updateConfig({
      hybridRoutingPolicy: 'privacy-first',
      ollamaUrl: 'http://127.0.0.1:11434'
    });
    assert.strictEqual(orchestrator.config.hybridRoutingPolicy, 'privacy-first');
    assert.strictEqual(orchestrator.config.ollamaUrl, 'http://127.0.0.1:11434');
  });

  // 15. Desktop Application Process Security & Argument Validation (P0 Security)
  await test('Desktop Security: Rejects command injection, unapproved binaries, and unsafe arguments', async () => {
    const desktopTool = tools.desktopTool;

    // Unapproved executable
    let unapprovedBlocked = false;
    try {
      await desktopTool.launchApp('powershell', ['-Command', 'calc']);
    } catch (e) {
      unapprovedBlocked = e.message.includes('not in the approved');
    }
    assert.strictEqual(unapprovedBlocked, true, 'Unapproved binary powershell must be blocked');

    // Calc with dangerous arguments
    let calcArgsBlocked = false;
    try {
      await desktopTool.launchApp('calc', ['& calc.exe']);
    } catch (e) {
      calcArgsBlocked = e.message.includes('takes no command-line arguments');
    }
    assert.strictEqual(calcArgsBlocked, true, 'calc must not accept arguments');

    // Notepad with flag switch
    let notepadSwitchBlocked = false;
    try {
      await desktopTool.launchApp('notepad', ['/A']);
    } catch (e) {
      notepadSwitchBlocked = e.message.includes('Switch flags are not permitted');
    }
    assert.strictEqual(notepadSwitchBlocked, true, 'notepad must not accept flag switches');

    // Null-byte in argument
    let nullByteBlocked = false;
    try {
      await desktopTool.launchApp('code', ['file.js\0malicious']);
    } catch (e) {
      nullByteBlocked = e.message.includes('null bytes');
    }
    assert.strictEqual(nullByteBlocked, true, 'Arguments with null bytes must be blocked');

    // Control characters in argument
    let ctrlCharBlocked = false;
    try {
      await desktopTool.launchApp('code', ['file.js\x1b[31m']);
    } catch (e) {
      ctrlCharBlocked = e.message.includes('control characters');
    }
    assert.strictEqual(ctrlCharBlocked, true, 'Arguments with control chars must be blocked');
  });

  // 16. Clipboard Security & Stdin Stream Isolation (P0 Security)
  await test('Clipboard Security: Treats clipboard text as untrusted data without shell interpretation', async () => {
    const desktopTool = tools.desktopTool;

    // Write text containing PowerShell sub-expressions, quotes, newlines, and metacharacters
    const attackPayload = '$(calc.exe); & whoami ` | Out-File evil.txt; "quotes" \'single\'\nNewline payload \u2605';
    const writeResult = await desktopTool.writeClipboard(attackPayload);
    assert.strictEqual(writeResult.success, true, 'Safe clipboard write must succeed without command execution');

    // Read back and verify exact data integrity without code execution
    const readResult = await desktopTool.readClipboard();
    assert.ok(readResult.text.includes('$(calc.exe)'), 'Payload text must be preserved verbatim as data');
    assert.ok(readResult.text.includes('quotes'), 'Quotes must be preserved verbatim');
    // Ensure no evil.txt was created
    assert.strictEqual(fs.existsSync(path.join(workspaceRoot, 'evil.txt')), false, 'Shell command must not execute');
  });

  // 17. Audit Logger Advanced Redaction & Large Payload Truncation (P1 Security)
  await test('Audit Logger: Redacts multiple key formats, Bearer tokens, hex hashes, and truncates large payloads', async () => {
    const fakeGemini = 'AIzaSyAABBCCDDEEFFGG1122334455';
    const fakeAnthropic = 'sk-ant-api03-abcdef1234567890abcdef1234567890';
    const fakeOpenai = 'sk-proj-abcde12345abcde12345abcde';
    const fakeBearer = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M';
    const fakeHexSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const largeContent = 'A'.repeat(500);

    const logged = auditLogger.log({
      action: 'DEEP_REDACTION_TEST',
      params: {
        geminiApiKey: fakeGemini,
        anthropicApiKey: fakeAnthropic,
        openaiApiKey: fakeOpenai,
        authHeader: fakeBearer,
        secretHex: fakeHexSecret,
        bigBody: largeContent
      }
    });

    const asString = JSON.stringify(logged);
    assert.ok(!asString.includes(fakeGemini), 'Gemini key must be redacted');
    assert.ok(!asString.includes(fakeAnthropic), 'Anthropic key must be redacted');
    assert.ok(!asString.includes(fakeOpenai), 'OpenAI key must be redacted');
    assert.ok(!asString.includes(fakeBearer), 'Bearer token must be redacted');
    assert.ok(!asString.includes(fakeHexSecret), 'Hex secret must be redacted');
    assert.ok(asString.includes('[TRUNCATED 500 chars]'), 'Large content must be truncated');
  });

  // 18. Canonical Provider Configuration Schema (P0 Integration)
  await test('Canonical Provider Schema: HybridRouter resolves canonical names and backward-compatible aliases', async () => {
    const router = new HybridRouter({});

    // Canonical keys
    const canonicalConfig = {
      geminiApiKey: 'gemini-canon-key',
      anthropicApiKey: 'anthropic-canon-key',
      openaiApiKey: 'openai-canon-key',
      ollamaUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'deepseek-r1'
    };
    const avail1 = router.getProviderAvailability(canonicalConfig);
    assert.strictEqual(avail1.gemini.available, true);
    assert.strictEqual(avail1.gemini.key, 'gemini-canon-key');
    assert.strictEqual(avail1.anthropic.key, 'anthropic-canon-key');
    assert.strictEqual(avail1.openai.key, 'openai-canon-key');
    assert.strictEqual(avail1.ollama.baseUrl, 'http://127.0.0.1:11434');
    assert.strictEqual(avail1.ollama.model, 'deepseek-r1');

    // Legacy aliases
    const legacyConfig = {
      geminiKey: 'gemini-leg-key',
      anthropicKey: 'anthropic-leg-key',
      openAiKey: 'openai-leg-key'
    };
    const avail2 = router.getProviderAvailability(legacyConfig);
    assert.strictEqual(avail2.gemini.key, 'gemini-leg-key');
    assert.strictEqual(avail2.anthropic.key, 'anthropic-leg-key');
    assert.strictEqual(avail2.openai.key, 'openai-leg-key');
  });

  // 19. Workspace Lockdown: Out-of-workspace operations are strictly forbidden without prompting approval
  await test('Workspace Lockdown: Out-of-workspace file actions are strictly forbidden', async () => {
    const pm = new PermissionManager({ approvedDirectories: [workspaceRoot] });

    // read_file outside workspace -> forbidden
    const readRisk = pm.analyzeActionRisk('read_file', { filePath: 'C:\\Windows\\win.ini' });
    assert.strictEqual(readRisk.blocked, true);
    assert.strictEqual(readRisk.riskLevel, 'forbidden');
    assert.strictEqual(readRisk.needsApproval, false);

    // write_file outside workspace -> forbidden
    const writeRisk = pm.analyzeActionRisk('write_file', { filePath: 'C:\\Windows\\system32\\bad.dll' });
    assert.strictEqual(writeRisk.blocked, true);
    assert.strictEqual(writeRisk.riskLevel, 'forbidden');
    assert.strictEqual(writeRisk.needsApproval, false);

    // delete_file outside workspace -> forbidden
    const deleteRisk = pm.analyzeActionRisk('delete_file', { filePath: 'C:\\Windows\\system32\\hosts' });
    assert.strictEqual(deleteRisk.blocked, true);
    assert.strictEqual(deleteRisk.riskLevel, 'forbidden');
    assert.strictEqual(deleteRisk.needsApproval, false);

    // list_files outside workspace -> forbidden
    const listRisk = pm.analyzeActionRisk('list_files', { dirPath: 'C:\\Windows' });
    assert.strictEqual(listRisk.blocked, true);
    assert.strictEqual(listRisk.riskLevel, 'forbidden');
    assert.strictEqual(listRisk.needsApproval, false);
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
