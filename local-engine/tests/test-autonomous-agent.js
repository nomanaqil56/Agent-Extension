// Antigravity Local Agent Engine - Comprehensive Autonomous Architecture Test Suite
// Validates Section 28 requirements: ReAct Loop, Agent.md hierarchy, Credential Vault,
// Credential Broker (Zero Password Leak), Structured Grants, Loop Detection & Empirical Verification.

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const InstructionManager = require('../src/agent/instructions');
const CredentialVault = require('../src/security/vault');
const CredentialBroker = require('../src/security/broker');
const PermissionManager = require('../src/security/permissions');
const AuditLogger = require('../src/security/audit');
const EmergencyCoordinator = require('../src/security/emergency');
const ToolRegistry = require('../src/tools');
const ModelManager = require('../src/agent/models');
const AgentOrchestrator = require('../src/agent/orchestrator');

let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.stack || err.message}\n`);
    failedTests++;
  }
}

async function runAutonomousTestSuite() {
  console.log('\n🧪 Starting Antigravity Master Autonomous Architecture Test Suite...\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-master-test-'));
  const vaultPath = path.join(testTempDir, 'test-vault.enc');

  const auditLogger = new AuditLogger(path.join(testTempDir, 'test-audit.log'));
  const permissionManager = new PermissionManager({
    approvedDirectories: [testTempDir],
    security: {
      requireApprovalForFileWrite: true,
      requireApprovalForFileDelete: true,
      requireApprovalForShell: true
    }
  });
  const emergencyCoordinator = new EmergencyCoordinator(permissionManager, auditLogger);
  const credentialVault = new CredentialVault(vaultPath);
  const credentialBroker = new CredentialBroker(credentialVault, permissionManager, auditLogger);
  const toolRegistry = new ToolRegistry(permissionManager, auditLogger, emergencyCoordinator, {}, credentialBroker);

  // ==========================================
  // SECTION 1: Agent.md & Instruction Hierarchy
  // ==========================================
  await test('Agent.md: Dynamically loads authoritative instructions and respects 5-tier hierarchy', () => {
    const im = new InstructionManager();
    const loaded = im.loadAgentMarkdown();
    assert.ok(loaded.content && loaded.content.length > 50, 'Agent.md content should be non-empty');
    assert.ok(loaded.content.includes('Core Operating Principles'), 'Agent.md should contain core operating principles');

    const effective = im.buildEffectiveInstructions({
      activeWorkspaces: [testTempDir],
      activePolicy: 'balanced'
    });
    assert.ok(effective.includes('MANDATORY SECURITY & PRIVACY POLICIES'), 'Instructions must include Tier 1 security');
    assert.ok(effective.includes('AUTHORIZED USER SCOPES'), 'Instructions must include Tier 2 scopes');
    assert.ok(effective.includes('Agent.md'), 'Instructions must include Tier 3 Agent.md');
    assert.ok(!effective.includes('D:\\') && !effective.includes('/home/'), 'Instructions must sanitize workspace paths to avoid leaking machine directory hierarchy');
  });

  // ==========================================
  // SECTION 2: Credential Vault (Section 9)
  // ==========================================
  await test('Credential Vault: Encrypts, retrieves, masks, and metadata-lists secrets without leaking plaintext', () => {
    const rawSecret = 'sk-ant-api03-testSecretToken-1234567890abcdef';
    credentialVault.storeSecret('test_anthropic', rawSecret, {
      category: 'provider_key',
      provider: 'anthropic'
    });

    assert.strictEqual(credentialVault.hasSecret('test_anthropic'), true);

    // Internal retrieval succeeds for authorized subsystem
    const retrieved = credentialVault.getSecret('test_anthropic');
    assert.strictEqual(retrieved, rawSecret, 'Decrypted secret must match stored secret');

    // Metadata list NEVER exposes secret
    const list = credentialVault.listSecrets();
    const entry = list.find(x => x.id === 'test_anthropic');
    assert.ok(entry, 'Metadata entry must exist');
    assert.strictEqual(entry.secret, undefined, 'Metadata entry must not contain secret');
    assert.strictEqual(entry.raw, undefined, 'Metadata entry must not contain raw secret');

    // Masking check
    const masked = credentialVault.maskValue(rawSecret);
    assert.ok(masked.includes('...'), 'Masked value must contain ellipsis');
    assert.ok(!masked.includes('testSecretToken'), 'Masked value must not reveal secret body');

    // Deletion
    credentialVault.deleteSecret('test_anthropic');
    assert.strictEqual(credentialVault.hasSecret('test_anthropic'), false);
    assert.strictEqual(credentialVault.getSecret('test_anthropic'), null);
  });

  // ==========================================
  // SECTION 3: Credential Broker (Section 10 - Zero Passwords to Model)
  // ==========================================
  await test('Credential Broker: Executes authorized domain operation without returning password to model', async () => {
    credentialVault.storeSecret('cred_github_test', 'ghp_syntheticSuperSecretToken991122', {
      category: 'web_auth',
      domain: 'github.com',
      username: 'agent_user'
    });

    // 1. Phishing Domain Mismatch defense
    let mismatchBlocked = false;
    try {
      await credentialBroker.brokerAuthentication({
        credentialId: 'cred_github_test',
        targetDomain: 'phishing-github.com'
      });
    } catch (e) {
      mismatchBlocked = e.message.includes('bound to "github.com"');
    }
    assert.strictEqual(mismatchBlocked, true, 'Credential Broker must reject domain mismatch');

    // 2. Authorized domain flow
    permissionManager.authorizeDomain('github.com');
    const authResult = await credentialBroker.brokerAuthentication({
      credentialId: 'cred_github_test',
      targetDomain: 'github.com'
    });

    assert.strictEqual(authResult.success, true);
    assert.strictEqual(authResult.authenticated, true);
    assert.strictEqual(authResult.secret, undefined, 'Broker result must NOT contain raw secret');
    assert.strictEqual(authResult.password, undefined, 'Broker result must NOT contain password');

    // 3. Sanitizer check: observation text containing secret is sanitized
    const dirtyOutput = 'Logged in with token ghp_syntheticSuperSecretToken991122 successfully';
    const cleanOutput = credentialBroker.sanitizeText(dirtyOutput);
    assert.ok(!cleanOutput.includes('ghp_syntheticSuperSecretToken991122'), 'Sanitizer must scrub raw secrets');
    assert.ok(cleanOutput.includes('[REDACTED_SECRET_'), 'Sanitizer must insert redaction marker');
  });

  // ==========================================
  // SECTION 4: Structured Grants & Natural Language Parsing (Section 12)
  // ==========================================
  await test('Permission Grants: Natural language requests produce structured, scope-confined grants', () => {
    // Natural language grant: "allow modifying files in my project directory for this task"
    const grant = permissionManager.parseNaturalLanguageGrant(
      'For this task, allow creating and modifying files inside my project directory without asking every time'
    );
    assert.ok(grant, 'Should produce a structured grant');
    assert.strictEqual(grant.action, 'write_file');
    assert.strictEqual(grant.scope, 'task');
    assert.strictEqual(grant.riskLevel, 'medium');

    // Target inside approved project directory is now authorized without prompting
    const targetFile = path.join(testTempDir, 'granted_file.txt');
    const risk = permissionManager.analyzeActionRisk('write_file', { filePath: targetFile });
    assert.strictEqual(risk.allowed, true);
    assert.strictEqual(risk.needsApproval, false);
    assert.strictEqual(risk.grantApplied, true);

    // Unrelated out-of-scope paths are STILL forbidden!
    const outsideFile = path.join(os.tmpdir(), 'unrelated_forbidden.txt');
    const outsideRisk = permissionManager.analyzeActionRisk('write_file', { filePath: outsideFile });
    assert.strictEqual(outsideRisk.blocked, true, 'Natural language grant must NOT authorize out-of-workspace paths');
  });

  // ==========================================
  // SECTION 5: Tool Registry Additions (Section 13)
  // ==========================================
  await test('Filesystem Tools: create_directory, copy_file, and move_file work within approved workspace', async () => {
    const subDir = path.join(testTempDir, 'test_subdir');
    const createRes = await toolRegistry.execute('create_directory', { dirPath: subDir });
    assert.strictEqual(createRes.result.created, true);
    assert.strictEqual(fs.existsSync(subDir), true);

    const fileA = path.join(testTempDir, 'fileA.txt');
    const fileB = path.join(subDir, 'fileB.txt');
    const fileC = path.join(subDir, 'fileC.txt');
    fs.writeFileSync(fileA, 'Test content for copy/move', 'utf8');

    // copy_file
    const copyRes = await toolRegistry.execute('copy_file', { source: fileA, destination: fileB });
    assert.strictEqual(copyRes.result.copied, true);
    assert.strictEqual(fs.readFileSync(fileB, 'utf8'), 'Test content for copy/move');

    // move_file (requires approval by default to prevent unintended destructive file replacement)
    let moveApprovalTriggered = false;
    const moveRes = await toolRegistry.execute('move_file', { source: fileB, destination: fileC }, (req) => {
      moveApprovalTriggered = true;
      permissionManager.resolveApproval(req.approvalId, true);
    });
    assert.strictEqual(moveApprovalTriggered, true, 'move_file should request user approval before deleting source file');
    assert.strictEqual(moveRes.result.moved, true);
    assert.strictEqual(fs.existsSync(fileB), false);
    assert.strictEqual(fs.existsSync(fileC), true);
  });

  // ==========================================
  // SECTION 6: Autonomous ReAct Execution Loop (Section 4)
  // ==========================================
  await test('ReAct Loop: Autonomous multi-step reasoning, tool execution, and empirical verification', async () => {
    const targetFile = path.join(testTempDir, 'autonomous_target.txt');

    let step = 0;
    const mockModel = {
      isLocal: true,
      category: 'local',
      generateStep: async (messages, tools) => {
        step++;
        if (step === 1) {
          // Model decides to write the file
          return {
            type: 'tool_call',
            tool: 'write_file',
            params: { filePath: targetFile, content: 'Autonomous Agent Output 2026' }
          };
        }
        if (step === 2) {
          // Model decides to inspect what it wrote
          return {
            type: 'tool_call',
            tool: 'read_file',
            params: { filePath: targetFile }
          };
        }
        // Model provides final summary
        return {
          type: 'message',
          content: 'Task completed successfully: File written and verified.'
        };
      }
    };

    const modelManager = new ModelManager({
      activeProvider: 'autonomous'
    }, credentialVault);

    const orchestrator = new AgentOrchestrator(toolRegistry, null, {
      activeProvider: 'autonomous',
      maxIterations: 10
    }, modelManager, credentialBroker);

    const events = [];
    const notify = (evt) => events.push(evt);

    const result = await orchestrator.runLlmReActLoop(
      'Write autonomous_target.txt and verify content',
      {},
      mockModel,
      notify,
      null,
      'balanced',
      'autonomous'
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.existsSync(targetFile), true);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), 'Autonomous Agent Output 2026');

    // Check empirical verification
    assert.ok(result.verifications && result.verifications.length > 0, 'Must contain empirical verification');
    assert.ok(result.verifications[0].includes('File verified:'), 'Verification must report file existence and size');
  });

  // ==========================================
  // SECTION 7: Loop Detection & Error Recovery (Section 4)
  // ==========================================
  await test('ReAct Loop: Detects infinite tool calling loops and warns agent to adapt', async () => {
    let callCount = 0;
    let loopWarningReceived = false;

    const repeatingModel = {
      isLocal: true,
      category: 'local',
      generateStep: async (messages) => {
        callCount++;
        // Check if loop warning message was injected
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && typeof lastMsg.content === 'string' && lastMsg.content.includes('Warning: You have called')) {
          loopWarningReceived = true;
          return {
            type: 'message',
            content: 'Adapted plan after loop warning.'
          };
        }

        return {
          type: 'tool_call',
          tool: 'get_system_info',
          params: {}
        };
      }
    };

    const orchestrator = new AgentOrchestrator(toolRegistry, null, {
      activeProvider: 'autonomous',
      maxIterations: 8
    }, null, credentialBroker);

    const events = [];
    const result = await orchestrator.runLlmReActLoop(
      'Test repeating tool loop',
      {},
      repeatingModel,
      (e) => events.push(e),
      null,
      'balanced',
      'autonomous'
    );

    assert.strictEqual(loopWarningReceived, true, 'Orchestrator must inject warning when identical tool is called 3 times');
    assert.strictEqual(result.success, true);
  });

  // ==========================================
  // SECTION 8: Task Cancellation via AbortSignal (Section 21)
  // ==========================================
  await test('Task Cancellation: AbortSignal halts execution immediately without marking success', async () => {
    const abortController = new AbortController();
    abortController.abort(); // Pre-aborted

    const orchestrator = new AgentOrchestrator(toolRegistry, null, {
      activeProvider: 'autonomous'
    }, null, credentialBroker);

    const result = await orchestrator.runTask({
      task: 'Cancelled task',
      providerName: 'autonomous',
      abortSignal: abortController.signal
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.aborted, true);
  });

  // Clean up test sandbox
  try {
    fs.rmSync(testTempDir, { recursive: true, force: true });
  } catch (e) {}

  console.log(`\n========================================`);
  console.log(`Results: ${passedTests} Passed, ${failedTests} Failed`);
  console.log(`========================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAutonomousTestSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
