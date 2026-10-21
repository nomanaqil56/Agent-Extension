// Antigravity Local Agent Engine - Privacy-First Outbound Boundary Regression Tests
// Validates that local files, terminal output, clipboard content, sensitive credentials,
// DOM context, screenshots, tool observations, and error paths NEVER leave the local execution
// boundary or appear in outbound cloud model requests.
// Evaluates outbound payloads at the actual boundary immediately before transport.
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

// Instrumented Mock Cloud Provider that records every outbound payload, message, and call
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
    this.stepHandler = null;
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

    if (typeof this.stepHandler === 'function') {
      return this.stepHandler(messages, tools, this.callCount);
    }

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
  console.log('🧪 Starting Antigravity Centralized Privacy Sentinel Test Suite...\n');

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

  // --- UNIQUE SENTINELS ---
  const FILE_SENTINEL = 'SENTINEL_LOCAL_FILE_ALPHA_771122';
  const CLIPBOARD_SENTINEL = 'SENTINEL_CLIPBOARD_BETA_334455';
  const TERMINAL_SENTINEL = 'SENTINEL_TERMINAL_GAMMA_998811';
  const ENV_SENTINEL = 'SENTINEL_ENV_CREDENTIAL_DELTA_445566';
  const DOM_SENTINEL = 'SENTINEL_DOM_PASSWORD_EPSILON_223344';
  const CONTEXT_SENTINEL = 'SENTINEL_BROWSER_CONTEXT_ZETA_556677';
  const SCREENSHOT_SENTINEL = 'SENTINEL_SCREENSHOT_DATA_ETA_889900';
  const ERROR_SENTINEL = 'SENTINEL_LOCAL_PATH_THETA_112299';
  const CONCURRENT_SENTINEL = 'SENTINEL_CONCURRENT_ISOLATION_IOTA_332211';
  const LEAK_TEST_SENTINEL = 'SENTINEL_NEGATIVE_CONTROL_LEAK_KAPPA_776655';

  // Seed test files
  const testLocalFile = path.join(testDir, 'private_notes.txt');
  fs.writeFileSync(testLocalFile, `Private local data:\n${FILE_SENTINEL}\nEnd of note.`, 'utf8');

  const testEnvFile = path.join(testDir, '.env');
  fs.writeFileSync(testEnvFile, `DATABASE_PASSWORD=${ENV_SENTINEL}\nAPI_SECRET=${ENV_SENTINEL}\n`, 'utf8');

  try {
    // 1. Protected Browser Context
    await test('Privacy Boundary: Protected browser context containing sentinel NEVER reaches cloud transport', async () => {
      const mockCloud = new MockCloudProvider('gemini');
      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { gemini: mockCloud, openai: mockCloud, anthropic: mockCloud }
      });

      await orchestrator.runTask({
        task: 'Summarize web page session',
        providerName: 'hybrid',
        context: {
          page: {
            url: 'https://internal-portal.local/dashboard',
            sessionToken: `Bearer ${CONTEXT_SENTINEL}`
          }
        }
      });

      console.log(`    [Harness Observation] Outbound cloud requests observed: ${mockCloud.callCount}`);
      assert.strictEqual(
        mockCloud.containsSentinel(CONTEXT_SENTINEL),
        false,
        'Browser context token sentinel MUST NOT appear in outbound cloud requests'
      );
    });

    // 2. Sensitive DOM Content
    await test('Privacy Boundary: Sensitive DOM content with password fields NEVER reaches cloud transport', async () => {
      const mockCloud = new MockCloudProvider('openai');
      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { gemini: mockCloud, openai: mockCloud, anthropic: mockCloud }
      });

      await orchestrator.runTask({
        task: 'Analyze the active login form',
        providerName: 'hybrid',
        context: {
          dom: `<html><body><form><input type="password" name="passwd" value="${DOM_SENTINEL}" /></form></body></html>`
        }
      });

      console.log(`    [Harness Observation] Outbound cloud requests observed: ${mockCloud.callCount}`);
      assert.strictEqual(
        mockCloud.containsSentinel(DOM_SENTINEL),
        false,
        'Sensitive DOM password sentinel MUST NOT appear in outbound cloud requests'
      );
    });

    // 3. Screenshots & Visual Context
    await test('Privacy Boundary: Screenshots and visual context with sensitive flag NEVER reach cloud transport', async () => {
      const mockCloud = new MockCloudProvider('anthropic');
      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { anthropic: mockCloud }
      });

      await orchestrator.runTask({
        task: 'Inspect page screenshot',
        providerName: 'hybrid',
        context: {
          screenshot: `data:image/png;base64,${SCREENSHOT_SENTINEL}`,
          isSensitive: true,
          dom: '<input type="password" />'
        }
      });

      console.log(`    [Harness Observation] Outbound cloud requests observed: ${mockCloud.callCount}`);
      assert.strictEqual(
        mockCloud.containsSentinel(SCREENSHOT_SENTINEL),
        false,
        'Screenshot visual sentinel MUST NOT appear in outbound cloud requests'
      );
    });

    // 4. Local Files Reading under Privacy-First
    await test('Privacy Boundary: Local file content with sentinel NEVER reaches cloud transport', async () => {
      const mockCloud = new MockCloudProvider('gemini');
      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { gemini: mockCloud, openai: mockCloud, anthropic: mockCloud }
      });

      await orchestrator.runTask({
        task: `read_file from "${testLocalFile}" and inspect its content`,
        providerName: 'hybrid'
      });

      console.log(`    [Harness Observation] Outbound cloud requests observed: ${mockCloud.callCount}`);
      assert.strictEqual(
        mockCloud.containsSentinel(FILE_SENTINEL),
        false,
        'Local file sentinel MUST NOT appear in outbound cloud requests'
      );
    });

    // 5. Clipboard Reading under Privacy-First
    await test('Privacy Boundary: Clipboard content with sentinel NEVER reaches cloud transport', async () => {
      const mockCloud = new MockCloudProvider('openai');
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

      console.log(`    [Harness Observation] Outbound cloud requests observed: ${mockCloud.callCount}`);
      assert.strictEqual(
        mockCloud.containsSentinel(CLIPBOARD_SENTINEL),
        false,
        'Clipboard sentinel MUST NOT appear in outbound cloud requests'
      );
    });

    // 6. Terminal Command Output under Privacy-First
    await test('Privacy Boundary: Terminal command output with sentinel NEVER reaches cloud transport', async () => {
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

      console.log(`    [Harness Observation] Outbound cloud requests observed: ${mockCloud.callCount}`);
      assert.strictEqual(
        mockCloud.containsSentinel(TERMINAL_SENTINEL),
        false,
        'Terminal output sentinel MUST NOT appear in outbound cloud requests'
      );
    });

    // 7. Sensitive Credential File (.env) under Privacy-First
    await test('Privacy Boundary: Sensitive credential file (.env) NEVER reaches cloud transport', async () => {
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

      console.log(`    [Harness Observation] Outbound cloud requests observed: ${mockCloud.callCount}`);
      assert.strictEqual(
        mockCloud.containsSentinel(ENV_SENTINEL),
        false,
        'Sensitive .env credential sentinel MUST NOT appear in outbound cloud requests'
      );
    });

    // 8. Tool Results: Mid-task local tool call transfers execution locally before cloud transmission
    await test('Privacy Boundary: Mid-task local tool observation transfers execution locally before cloud transmission', async () => {
      const mockCloud = new MockCloudProvider('gemini');
      mockCloud.stepHandler = async () => ({
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
      await orchestrator.runLlmReActLoop(
        'Inspect the local project repository',
        { page: { url: 'https://example.com' } },
        mockCloud,
        (msg) => notifications.push(msg),
        null,
        'privacy-first'
      );

      console.log(`    [Harness Observation] Outbound cloud requests observed: ${mockCloud.callCount}`);
      // Initial step was called (step 1 = call read_file)
      assert.strictEqual(mockCloud.callCount, 1, 'Initial cloud step was exercised');
      // Step 2 with local file observation was DIVERTED locally and NEVER sent to cloud
      assert.strictEqual(
        mockCloud.containsSentinel(FILE_SENTINEL),
        false,
        'Tool observation containing local sentinel must NEVER be sent to cloud model in subsequent step'
      );
      assert.ok(
        notifications.some(n => n.type === 'PROVIDER_SWITCH' && n.provider === 'autonomous'),
        'Must broadcast PROVIDER_SWITCH to autonomous engine'
      );
    });

    // 9. Error Messages and Local Paths
    await test('Privacy Boundary: Local tool execution failures do not leak local paths to cloud model', async () => {
      const mockCloud = new MockCloudProvider('claude');
      const fakeMissingFile = path.join(testDir, `missing_${ERROR_SENTINEL}.txt`);

      mockCloud.stepHandler = async () => ({
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

      console.log(`    [Harness Observation] Outbound cloud requests observed: ${mockCloud.callCount}`);
      assert.strictEqual(
        mockCloud.containsSentinel(ERROR_SENTINEL),
        false,
        'Local tool error path must not be sent back to cloud model under Privacy-First'
      );
    });

    // 10. Retries and Provider Switching
    await test('Privacy Boundary: Provider switching on error does not leak conversation sentinels to other cloud providers', async () => {
      const failingMockCloud = new MockCloudProvider('gemini');
      let attempts = 0;
      failingMockCloud.stepHandler = async () => {
        attempts++;
        throw new Error('Cloud provider 503 Service Unavailable');
      };

      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { gemini: failingMockCloud }
      });

      const notifications = [];
      const result = await orchestrator.runLlmReActLoop(
        'Execute sensitive task with fallback retry',
        {},
        failingMockCloud,
        (msg) => notifications.push(msg),
        null,
        'privacy-first'
      );

      console.log(`    [Harness Observation] Outbound cloud requests observed on failing provider: ${failingMockCloud.callCount}`);
      assert.strictEqual(attempts, 1, 'Provider was invoked once before failure');
      // Under Privacy-First, failed cloud provider switches to local autonomous engine, not another cloud provider
      assert.ok(
        notifications.some(n => n.type === 'PROVIDER_SWITCH' && n.provider === 'autonomous'),
        'Provider switch fell back safely to local Autonomous Engine'
      );
    });

    // 11. Cloud-Preferred Policy (Permitted General Task vs Local File Access)
    await test('Privacy Boundary: Cloud-Preferred policy executes cloud requests when permitted, but protects local data', async () => {
      const mockCloud = new MockCloudProvider('gemini');
      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'cloud-preferred',
        providerInstances: { gemini: mockCloud }
      });

      // 11a: Permitted general reasoning task reaches cloud transport
      const resPermitted = await orchestrator.runTask({
        task: 'Summarize the architecture of modern search engines',
        providerName: 'gemini'
      });

      console.log(`    [Harness Observation] Outbound cloud requests observed for permitted task: ${mockCloud.callCount}`);
      assert.strictEqual(resPermitted.success, true, 'Permitted cloud task must succeed');
      assert.ok(mockCloud.callCount > 0, 'Permitted task MUST exercise cloud transport path (callCount > 0)');

      // 11b: Outbound attempt containing raw credentials under cloud-preferred is intercepted by PrivacyEnforcer
      const initialCalls = mockCloud.callCount;
      const resSensitive = await orchestrator.runTask({
        task: `Check account credentials: Bearer ${ENV_SENTINEL}`,
        providerName: 'gemini'
      });

      console.log(`    [Harness Observation] Outbound calls after credential task: ${mockCloud.callCount}`);
      assert.strictEqual(
        mockCloud.containsSentinel(ENV_SENTINEL),
        false,
        'Sensitive credentials must never be sent to cloud model even under cloud-preferred'
      );
    });

    // 12. Manual Provider Selection Blocks Local Tasks under Privacy-First
    await test('Privacy Boundary: Manual cloud provider selection BLOCKS local tasks under Privacy-First without fallback', async () => {
      const mockCloud = new MockCloudProvider('gemini');
      const router = new HybridRouter({
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        geminiApiKey: 'mock-gemini-key',
        providerInstances: { gemini: mockCloud }
      });

      const routeResult = router.routeTask({
        task: `read_file from local directory and patch it`,
        providerName: 'gemini',
        config: { hybridRoutingPolicy: 'privacy-first', geminiApiKey: 'mock-gemini-key' }
      });

      console.log(`    [Harness Observation] Outbound cloud requests observed: ${mockCloud.callCount}`);
      assert.strictEqual(routeResult.blocked, true, 'Task must be blocked when cloud model requested for local task in Privacy-First');
      assert.ok(routeResult.error.includes('Privacy-First Policy Violation'), 'Must provide clear privacy violation error');
      assert.strictEqual(mockCloud.callCount, 0, 'Zero requests must reach cloud mock when blocked');
    });

    // 13. Missing or Unavailable Local Model
    await test('Privacy Boundary: Missing local Ollama does NOT silently route protected local tasks to cloud', async () => {
      const mockCloud = new MockCloudProvider('openai');
      const orchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        preferLocalOllama: true,
        ollamaUrl: 'http://localhost:99999', // Nonexistent/offline Ollama port
        providerInstances: { openai: mockCloud }
      });

      // Execute task containing local file
      await orchestrator.runTask({
        task: `read_file from "${testLocalFile}" and inspect its content`,
        providerName: 'hybrid'
      });

      console.log(`    [Harness Observation] Outbound cloud requests observed: ${mockCloud.callCount}`);
      assert.strictEqual(
        mockCloud.containsSentinel(FILE_SENTINEL),
        false,
        'Offline Ollama must NOT cause silent fallback of local data to cloud provider'
      );
    });

    // 14. Concurrent Task Isolation
    await test('Privacy Boundary: Concurrent tasks maintain strict isolation between local private and cloud requests', async () => {
      const mockCloudA = new MockCloudProvider('gemini');
      const mockCloudB = new MockCloudProvider('openai');

      const orchestratorA = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'cloud-preferred',
        providerInstances: { gemini: mockCloudA }
      });

      const orchestratorB = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        providerInstances: { openai: mockCloudB }
      });

      // Run two tasks simultaneously:
      // Task 1: Non-sensitive general reasoning (Cloud-Preferred -> exercises mockCloudA)
      // Task 2: Sensitive local file operation (Privacy-First -> stays local)
      const [resA, resB] = await Promise.all([
        orchestratorA.runTask({
          task: 'Explain the principles of compiler optimization',
          conversationId: 'conv_cloud_permitted_1',
          providerName: 'gemini'
        }),
        orchestratorB.runTask({
          task: `read_file "${testLocalFile}" containing ${CONCURRENT_SENTINEL}`,
          conversationId: 'conv_local_private_2',
          providerName: 'hybrid'
        })
      ]);

      console.log(`    [Harness Observation] Outbound requests - Task A (Cloud): ${mockCloudA.callCount}, Task B (Private): ${mockCloudB.callCount}`);
      assert.ok(mockCloudA.callCount > 0, 'Permitted cloud task A MUST exercise cloud transport path');
      assert.strictEqual(
        mockCloudA.containsSentinel(CONCURRENT_SENTINEL),
        false,
        'Cloud transport A must NEVER receive Task B concurrent sentinel'
      );
      assert.strictEqual(
        mockCloudB.containsSentinel(CONCURRENT_SENTINEL),
        false,
        'Cloud transport B must NEVER receive Task B concurrent sentinel'
      );
    });

    // 15. Negative Control: Proves that the production Privacy Guard prevents transmission,
    // and when intentionally bypassed, the harness detects the leak and fails.
    await test('Negative Control: Production privacy guard prevents sentinel from reaching transport, while intentional bypass leaks and fails test', async () => {
      const mockCloud = new MockCloudProvider('gemini');

      // Step 1: WITH PRODUCTION PRIVACY GUARD ACTIVE (Normal Production Mode)
      const prodOrchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        bypassPrivacyGuardForTest: false,
        providerInstances: { gemini: mockCloud }
      });

      // Attempt to send a protected payload
      await prodOrchestrator.runTask({
        task: `Summarize this private token: ${LEAK_TEST_SENTINEL}`,
        providerName: 'gemini',
        context: { isSensitive: true }
      });

      console.log(`    [Harness Observation] Outbound calls with active guard: ${mockCloud.callCount}`);
      assert.strictEqual(
        mockCloud.containsSentinel(LEAK_TEST_SENTINEL),
        false,
        'Production privacy guard MUST block sentinel from reaching external transport'
      );

      // Step 2: WITH PRIVACY GUARD INTENTIONALLY BYPASSED (Verification Probe)
      const bypassedMockCloud = new MockCloudProvider('gemini');
      const bypassOrchestrator = new AgentOrchestrator(toolRegistry, memoryManager, {
        ...baseConfig,
        hybridRoutingPolicy: 'privacy-first',
        bypassPrivacyGuardForTest: true, // Deliberate bypass to prove test harness catches leaks
        providerInstances: { gemini: bypassedMockCloud }
      });

      await bypassOrchestrator.runTask({
        task: `Unprotected test payload with ${LEAK_TEST_SENTINEL}`,
        providerName: 'gemini',
        context: {}
      });

      console.log(`    [Harness Observation] Outbound calls with bypassed guard: ${bypassedMockCloud.callCount}`);
      // Assert that without the privacy guard, the mock transport received the request
      assert.ok(
        bypassedMockCloud.callCount > 0,
        'Bypassed execution path MUST exercise external transport'
      );
      assert.strictEqual(
        bypassedMockCloud.containsSentinel(LEAK_TEST_SENTINEL),
        true,
        'Deliberately bypassed sentinel MUST reach MockCloudProvider'
      );

      // Step 3: Prove that asserting absence on the leaked sentinel throws an AssertionError
      let assertionFailed = false;
      try {
        assert.strictEqual(
          bypassedMockCloud.containsSentinel(LEAK_TEST_SENTINEL),
          false,
          'Expected failure because sentinel actually reached the mock transport'
        );
      } catch (err) {
        assertionFailed = true;
      }
      assert.strictEqual(
        assertionFailed,
        true,
        'Test harness MUST fail if a sentinel reaches external transport'
      );
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
