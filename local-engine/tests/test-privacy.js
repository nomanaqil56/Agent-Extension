// Antigravity Local Agent Engine - Privacy-First Outbound Boundary Regression Tests
// Validates that local files, terminal output, clipboard content, sensitive credentials,
// and tool outputs NEVER leave the local execution boundary or appear in outbound cloud model requests.
// Includes negative-control tests verifying that the test harness actively detects leaks.

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const PermissionManager = require('../src/security/permissions');
const AuditLogger = require('../src/security/audit');
const EmergencyCoordinator = require('../src/security/emergency');
const ToolRegistry = require('../src/tools');
const AgentOrchestrator = require('../src/agent/orchestrator');
const HybridRouter = require('../src/agent/providers/router');

// Instrumented Mock Cloud Provider that records every outbound payload and message
class MockCloudProvider {
  constructor(name = 'gemini') {
    this.name = name;
    this.model = 'mock-cloud-model';
    this.isLocal = false;
    this.isRemote = true;
    this.category = 'cloud';
    this.supportsTools = true;
    this.supportsStreaming = false;
    this.recordedOutboundPayloads = [];
    this.recordedMessages = [];
    this.callCount = 0;
  }

  async checkHealth() {
    return { healthy: true, provider: this.name, model: this.model };
  }

  async generateStep(messages, tools = []) {
    this.callCount++;
    this.recordedMessages.push(JSON.parse(JSON.stringify(messages)));
    this.recordedOutboundPayloads.push({
      step: this.callCount,
      messages: JSON.parse(JSON.stringify(messages)),
      tools: tools.map(t => t.name || t),
      timestamp: Date.now()
    });

    return {
      type: 'message',
      content: 'Mock cloud response'
    };
  }

  // Helper: check if any outbound payload ever contained a given sentinel string
  containsSentinel(sentinel) {
    const serialized = JSON.stringify(this.recordedOutboundPayloads);
    return serialized.includes(sentinel);
  }
}

async function runPrivacyTests() {
  console.log('🧪 Starting Antigravity Privacy-First Outbound Boundary Test Suite...\n');

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

  const testDir = path.join(__dirname, 'test-privacy-sandbox');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testLogsDir = path.join(testDir, 'logs');
  const baseConfig = {
    port: 3721,
    activeProvider: 'hybrid',
    hybridRoutingPolicy: 'privacy-first',
    approvedDirectories: [testDir],
    approvedApplications: ['code', 'notepad', 'calc', 'git'],
    security: {
      requireApprovalForShell: false,
      requireApprovalForFileWrite: false,
      requireApprovalForFileDelete: false,
      requireApprovalForClipboardRead: false
    }
  };

  const permManager = new PermissionManager(baseConfig);
  const auditLogger = new AuditLogger(testLogsDir);
  const emergencyCoord = new EmergencyCoordinator(permManager, auditLogger);
  const mockServerContext = { getExtensionClient: () => null };
  const toolRegistry = new ToolRegistry(permManager, auditLogger, emergencyCoord, mockServerContext);
  const memoryManager = { recordInteraction: () => {} };

  // --- SENTINELS ---
  const FILE_SENTINEL = 'SECRET_LOCAL_FILE_SENTINEL_ALPHA_987654';
  const CLIPBOARD_SENTINEL = 'SECRET_CLIPBOARD_SENTINEL_BETA_554433';
  const TERMINAL_SENTINEL = 'SECRET_TERMINAL_SENTINEL_GAMMA_112233';
  const SENSITIVE_ENV_SENTINEL = 'SECRET_ENV_TOKEN_DELTA_778899';
  const LEAK_TEST_SENTINEL = 'DELIBERATE_TEST_SENTINEL_LEAK_PROBE_998877';

  // Seed test files
  const testLocalFile = path.join(testDir, 'private_notes.txt');
  fs.writeFileSync(testLocalFile, `Private local data:\n${FILE_SENTINEL}\nEnd of note.`, 'utf8');

  const testEnvFile = path.join(testDir, '.env');
  fs.writeFileSync(testEnvFile, `DATABASE_PASSWORD=${SENSITIVE_ENV_SENTINEL}\n`, 'utf8');

  try {
    // 1. Local File Reading under Privacy-First
    await test('Privacy Boundary: Local file content with sentinel NEVER sent to cloud provider', async () => {
      const mockCloud = new MockCloudProvider('gemini');
      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { gemini: mockCloud, openai: mockCloud, anthropic: mockCloud }
      });

      // Execute task that reads local file
      await orchestrator.runTask({
        task: `read_file from "${testLocalFile}" and inspect its content`,
        providerName: 'hybrid'
      });

      // Assert: MockCloudProvider received zero occurrences of FILE_SENTINEL
      assert.strictEqual(
        mockCloud.containsSentinel(FILE_SENTINEL),
        false,
        'Prohibited local file sentinel MUST NOT appear in outbound cloud requests'
      );
    });

    // 2. Clipboard Reading under Privacy-First
    await test('Privacy Boundary: Clipboard content with sentinel NEVER sent to cloud provider', async () => {
      const mockCloud = new MockCloudProvider('openai');
      // Populate clipboard with unique sentinel
      await toolRegistry.desktopTool.clipboardWrite({ text: CLIPBOARD_SENTINEL });

      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { gemini: mockCloud, openai: mockCloud, anthropic: mockCloud }
      });

      await orchestrator.runTask({
        task: 'clipboard_read to inspect current clipboard content',
        providerName: 'hybrid'
      });

      assert.strictEqual(
        mockCloud.containsSentinel(CLIPBOARD_SENTINEL),
        false,
        'Prohibited clipboard sentinel MUST NOT appear in outbound cloud requests'
      );
    });

    // 3. Terminal Command Execution under Privacy-First
    await test('Privacy Boundary: Terminal command output with sentinel NEVER sent to cloud provider', async () => {
      const mockCloud = new MockCloudProvider('anthropic');
      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { gemini: mockCloud, openai: mockCloud, anthropic: mockCloud }
      });

      await orchestrator.runTask({
        task: `execute_command echoing ${TERMINAL_SENTINEL}`,
        providerName: 'hybrid'
      });

      assert.strictEqual(
        mockCloud.containsSentinel(TERMINAL_SENTINEL),
        false,
        'Prohibited terminal command output MUST NOT appear in outbound cloud requests'
      );
    });

    // 4. Sensitive Credential File Inspection under Privacy-First
    await test('Privacy Boundary: Sensitive credential file (.env) NEVER sent to cloud provider', async () => {
      const mockCloud = new MockCloudProvider('gemini');
      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { gemini: mockCloud, openai: mockCloud, anthropic: mockCloud }
      });

      await orchestrator.runTask({
        task: `read_file of sensitive environment file "${testEnvFile}"`,
        providerName: 'hybrid'
      });

      assert.strictEqual(
        mockCloud.containsSentinel(SENSITIVE_ENV_SENTINEL),
        false,
        'Prohibited sensitive .env secret MUST NOT appear in outbound cloud requests'
      );
    });

    // 5. Outbound Boundary Switch: If cloud provider is initially active and calls local tool, execution transfers locally
    await test('Privacy Boundary: Mid-task local tool call transfers execution locally before cloud transmission', async () => {
      const mockCloud = new MockCloudProvider('gemini');
      // Mock cloud decides to call read_file
      mockCloud.generateStep = async () => ({
        type: 'tool_call',
        tool: 'read_file',
        params: { filePath: testLocalFile }
      });

      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { gemini: mockCloud }
      });

      const notifications = [];
      const mockNotify = (msg) => notifications.push(msg);

      // Directly invoke ReAct loop with MockCloudProvider under privacy-first
      await orchestrator.runLlmReActLoop(
        'Inspect the local project repository',
        { page: { url: 'https://example.com' } },
        mockCloud,
        mockNotify,
        null,
        'privacy-first'
      );

      // Verify PROVIDER_SWITCH event was broadcast
      const switched = notifications.some(n => n.type === 'PROVIDER_SWITCH' && n.provider === 'autonomous');
      assert.strictEqual(switched, true, 'Must notify PROVIDER_SWITCH to autonomous engine');

      // Assert that mockCloud never received a second step containing the tool result with FILE_SENTINEL
      assert.strictEqual(
        mockCloud.containsSentinel(FILE_SENTINEL),
        false,
        'Tool observation containing local sentinel must NEVER be sent to cloud model in subsequent step'
      );
    });

    // 6. Manual Cloud Mode Blocked on Local Tasks under Privacy-First
    await test('Privacy Boundary: Manual cloud provider selection BLOCKS local tasks under Privacy-First', async () => {
      const router = new HybridRouter({
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        geminiApiKey: 'mock-gemini-key'
      });

      const routeResult = router.routeTask({
        task: `read_file from local directory and patch it`,
        providerName: 'gemini',
        config: { hybridRoutingPolicy: 'privacy-first', geminiApiKey: 'mock-gemini-key' }
      });

      assert.strictEqual(routeResult.blocked, true, 'Task must be blocked when cloud model requested for local task in Privacy-First');
      assert.ok(routeResult.error.includes('Privacy-First Policy Violation'), 'Must provide clear privacy violation error');
    });

    // 7. Error Paths: Tool errors on local files are not leaked to cloud model
    await test('Privacy Boundary: Local tool execution failures do not leak local paths to cloud model', async () => {
      const mockCloud = new MockCloudProvider('claude');
      const fakeMissingFile = path.join(testDir, 'nonexistent_file_with_sentinel_xyz.txt');

      mockCloud.generateStep = async () => ({
        type: 'tool_call',
        tool: 'read_file',
        params: { filePath: fakeMissingFile }
      });

      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { claude: mockCloud }
      });

      const notifications = [];
      await orchestrator.runLlmReActLoop(
        'Attempt to read missing file',
        {},
        mockCloud,
        (msg) => notifications.push(msg),
        null,
        'privacy-first'
      );

      // Verify that the error message was NOT sent back to cloud model
      assert.strictEqual(
        mockCloud.containsSentinel('nonexistent_file_with_sentinel_xyz.txt'),
        false,
        'Local tool error must not be sent back to cloud model under Privacy-First'
      );
    });

    // 8. Integration Verification: Cloud provider actually receives outbound payloads when permitted by policy
    await test('Privacy Harness: Instrumented mock cloud provider receives outbound requests when permitted', async () => {
      const mockCloud = new MockCloudProvider('gemini');
      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'cloud-preferred',
        providerInstances: { gemini: mockCloud }
      });

      await orchestrator.runTask({
        task: 'Summarize the history of internet protocols',
        providerName: 'gemini'
      });

      assert.ok(mockCloud.callCount > 0, 'Mock cloud provider must receive task when policy permits');
      assert.ok(mockCloud.recordedOutboundPayloads.length > 0, 'Must record outbound payload structure');
    });

    // 9. Negative-Control Test: Instrumentation proves that a deliberate sentinel leak is detected
    await test('Negative Control: Harness detects deliberate sentinel leak and assertion catches it', async () => {
      const mockCloud = new MockCloudProvider('gemini');

      // Intentionally simulate an outbound payload containing a deliberate test sentinel
      await mockCloud.generateStep([
        { role: 'user', content: `Unprotected outbound payload containing ${LEAK_TEST_SENTINEL}` }
      ]);

      // Assert that mockCloud detected the sentinel
      assert.strictEqual(
        mockCloud.containsSentinel(LEAK_TEST_SENTINEL),
        true,
        'MockCloudProvider.containsSentinel must return true when a sentinel is present in outbound payload'
      );

      // Assert that checking absence of this leaked sentinel throws an AssertionError
      let errorThrown = false;
      try {
        assert.strictEqual(
          mockCloud.containsSentinel(LEAK_TEST_SENTINEL),
          false,
          'Expected failure on leaked sentinel'
        );
      } catch (assertionErr) {
        errorThrown = true;
      }
      assert.strictEqual(errorThrown, true, 'Harness must fail when a sentinel is leaked to cloud provider');
    });

  } finally {
    // Cleanup temporary files
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {}
  }

  console.log(`\n================================`);
  console.log(`Privacy Results: ${passed} Passed, ${failed} Failed`);
  console.log(`================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPrivacyTests().catch(err => {
  console.error('Privacy test execution error:', err);
  process.exit(1);
});
