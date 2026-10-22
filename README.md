# ⚡ Antigravity Browser & Desktop AI Agent Suite

A unified AI side panel and computer-capable agent system built with a **Brave/Chrome Manifest V3 Extension** and an authenticated, loopback-restricted **Local Agent Engine**.

```
┌─────────────────────────────────────────────────────────────┐
│                   BRAVE / CHROME EXTENSION                  │
│                                                             │
│   • Single Primary Interface: Persistent Side Panel         │
│   • Quick Summon: Alt+Shift+A or Toolbar Action Icon        │
│   • Multi-Session Conversation History (Isolated & Bounded) │
│   • Visual Highlights & DOM Distillation                    │
│   • Multi-Tab Management & Visual Screenshot View           │
│   • Hands-free Voice Dictation (Web Speech API)             │
│   • Approvals, Audit Logs & Model Selector (Hybrid AI)      │
│   • Dynamic Workspace Folder Management in Settings         │
└──────────────────────────────▲──────────────────────────────┘
                               │ Authenticated Loopback Bridge
                               │ (127.0.0.1:3721 with Secret Token / Handshake)
┌──────────────────────────────▼──────────────────────────────┐
│                     LOCAL AGENT ENGINE                      │
│                                                             │
│   • Hybrid AI Router (Privacy-First, Balanced, Cloud, Manual)│
│   • Scoped Filesystem Access (Explicitly Approved Folders)  │
│   • Write Approval & Delete Approval by Default             │
│   • Sensitive File Protection (.env, id_rsa, keys)          │
│   • Controlled Terminal (PowerShell / Bash with AbortSignal)│
│   • Safe Desktop Spawning (Shell-free, strict arg policies) │
│   • Safe Clipboard (Piped stdin, zero shell interpolation)  │
│   • Ephemeral Pairing (5-min expiry, lockout, single-use)   │
│   • Authoritative Credential Vault (DPAPI / AES-256-GCM)    │
│   • Instant Emergency Stop Coordinator                      │
│   • Local Models (Ollama) & Cloud (Gemini, Claude, GPT-4o)  │
│   • Zero-Config Autonomous Engine (Deterministic Offline)   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🌟 Key Capabilities

### 1. Unified Side Panel Command Interface
- **Single Primary Interface**: The persistent **Side Panel** (`Alt+Shift+A` or browser toolbar icon) serves as the single primary command center for chat, tool execution, approvals, audit logs, and settings. Floating HUDs have been completely removed.
- **Persistent Conversation History**: Multi-session management with "New Task", conversation switching, and auto-restoration across panel open/close cycles via `chrome.storage.local`.
- **Strict Stream & Task Association**: Background task streams are tagged with initiating `conversationId`, ensuring that switching conversations while an agent task is active never corrupts or pollutes other chat views.
- **Bounded Retention**: Automatically limits conversation counts and per-conversation messages to avoid exceeding browser storage quotas.
- **Cinematic Dark Aesthetics**: Glassmorphic dark obsidian UI (`#07090E`), neon cyan accents (`#00F2FE`), glowing micro-animations, and live step execution badges.
- **Hands-Free Voice Commands**: Built-in voice dictation using the Web Speech API with microphone animations and optional Speech Synthesis audio feedback.

### 2. Autonomous Browser Automation
- **Deep Page Awareness**: Automatically distills active webpages into structured, numbered element trees (`[1]`, `[2]`, `[3]`) capturing interactive buttons, links, inputs, and forms.
- **Visual Highlighting**: Places glowing target boxes and action badges directly on the webpage as the agent operates.
- **Multi-Tab Control**: Autonomous tab opening, closing, switching, search queries, and navigation across workflows.
- **Navigation Safety**: Strictly blocks dangerous URL schemes (`javascript:`, `file:`, `data:`) and browser-internal pages (`chrome://`, `brave://`).
- **Visual Viewport Screenshots**: Instant capture of visible tabs for multi-modal context.

### 3. Local Computer Companion & Hardened Execution
- **Scoped Filesystem Operations**: Read, write, search (`grep`), inspect, precision patch, and delete code files strictly within user-approved directory roots with canonical symlink resolution and path traversal protection (`..`).
- **Clean Install Zero-Workspace Lockdown**: A fresh installation starts with an empty workspace list `[]`. Out-of-workspace operations are strictly forbidden immediately without prompting for approvals.
- **Write Approval by Default**: All file modifications and deletions inside approved workspaces require explicit user approval with diff previews.
- **Sensitive File Protection**: Credential files (`.env`, `id_rsa`, `*.pem`, `*.key`) trigger high-risk security approval alerts and are protected from unintended exposure.
- **Shell-Free Desktop App Launching**: Applications (`code`, `notepad`, `calc`, `git`) are launched via shell-free `child_process.spawn`. Arguments are strictly validated:
  - `calc`: accepts 0 arguments.
  - `notepad`: accepts at most 1 path inside an approved workspace; flags/switches are forbidden.
  - `code`: accepts only verified safe flags (`-r`, `-n`, `-g`) or paths inside approved workspaces.
  - `git`: allows only non-destructive inspection subcommands (`status`, `log`, `diff`, `branch`, `show`).
  - Metacharacters, quotes, command separators, null bytes, and control characters are rejected.
- **Safe Clipboard Operations**: Writing to the clipboard streams raw UTF-8 bytes directly into standard input (`[Console]::In.ReadToEnd()`), completely eliminating PowerShell string interpolation and code execution vulnerabilities. Clipboard reads require explicit user authorization.

### 4. User-Controlled Security & Emergency Stop
- **Action Approvals**: Sensitive actions (terminal commands, file writes, file deletion, clipboard reads) prompt you in the **Approvals Tab** with risk ratings (Low/Medium/High).
- **Instant Emergency Stop**: A prominent red glowing **STOP** button immediately:
  - Halts all active child processes tracked by the emergency coordinator.
  - Aborts ongoing model inference and orchestration ReAct loops.
  - Cancels pending browser automation actions.
  - Blocks subsequent tool execution until explicitly reset.
- **Complete Audit Trail**: Every action is saved to an append-only JSONL log (`logs/audit.jsonl`) with automated secret redaction for API keys, tokens, and passwords, large payload truncation, and bounded file size retention (5MB).
- **Loopback Enforcement & CORS**: The engine is strictly bound to loopback `127.0.0.1` and restricts CORS origins to authorized extensions.

### 5. Advanced Hybrid AI Router & Policy Engine
The application transparently routes between local and cloud providers based on your selected policy:

- **Routing Policies**:
  - **Balanced (Default)**: Ordinary tasks (file listing, reading local code, system diagnostics, DOM inspection, and tab actions) stay strictly local on the Autonomous Engine or Ollama. Cloud escalation (Gemini -> Claude -> GPT-4o) occurs only when tasks require complex cognitive reasoning and cloud API keys are configured.
  - **Privacy-First**: Strict local isolation. Local files, private code, and terminal outputs are strictly processed locally and are never transmitted to cloud providers. If local content is accessed during execution, the agent enforces a privacy boundary and switches execution to the local Autonomous Engine.
  - **Cloud-Preferred**: Uses configured cloud models for general queries, falling back to local processing if cloud services are unavailable.
  - **Manual**: Strictly adheres to your selected provider. If credentials are not configured, execution is blocked with a clear diagnostic message unless fallback is explicitly enabled.
- **Supported Providers**:
  - **Google Gemini 2.0 Flash** (`geminiApiKey`)
  - **Anthropic Claude 3.5 Sonnet** (`anthropicApiKey`)
  - **OpenAI GPT-4o** (`openaiApiKey`)
  - **Ollama / Local LLM** (`ollamaUrl`, default: `http://localhost:11434`)
  - **Autonomous Engine**: Deterministic zero-config offline reasoning engine requiring no external API keys (described accurately as rule-based, not a general-purpose LLM).

---

## 🚀 Quickstart Guide

### System Prerequisites
- **OS**: Windows 10/11, macOS (12+), or Linux (Ubuntu 20.04+).
- **Node.js**: v18.0.0 or higher (recommended: LTS v20+).
- **Browser**: Brave, Google Chrome, or Chromium-based browsers with Manifest V3 Side Panel API support.

### Step 1: Run Setup and Install Dependencies
From the root workspace directory, run:
```bash
npm run setup
```
This installs the `local-engine` dependencies, initializes the secure Credential Vault with an encrypted security token, strips any secrets from `config.json`, and ensures assets are in place.

### Step 2: Start the Local Agent Engine
On Windows:
```cmd
scripts\start-engine.bat
```
Or via npm:
```bash
npm run start:engine
```
The engine starts on `127.0.0.1:3721` with health checks available at `http://127.0.0.1:3721/health`.
Upon startup, an ephemeral **8-character Pairing Code** is displayed in the engine console banner (e.g. `Pairing Code: 4F8A2C1E`). The code expires in 5 minutes and is strictly single-use.

### Step 3: Load the Extension into Brave or Chrome
1. Open your browser and navigate to:
   - **Brave**: `brave://extensions`
   - **Chrome**: `chrome://extensions`
2. Enable the **"Developer mode"** toggle in the top-right corner.
3. Click **"Load unpacked"**.
4. Select the **`extension`** folder inside this project directory (`extension/`).
5. Pin the **Antigravity AI Agent** icon to your browser toolbar!

### Step 4: First-Run Pairing & Configuration
1. Open the Antigravity Side Panel (`Alt+Shift+A`).
2. Go to the **Settings Tab**.
3. Under **Security Authentication Token**, enter the 8-character **Pairing Code** shown in your engine console and click **Pair Engine**.
4. The extension securely retrieves the session token, handshakes over WebSocket without placing tokens in the URL, and displays `ONLINE :3721`.
5. Enter your API keys and click **Save Settings** to synchronize them directly with the Local Engine's Credential Vault.
6. Under **Approved Workspaces**, click **+ Add Workspace** to approve your project folder.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| **`Alt + Shift + A`** | Open or focus the **Antigravity Side Panel** |
| **`Enter`** | Dispatch instruction to the agent |
| **`Shift + Enter`** | Insert new line in prompt box |

---

## 🛠️ Testing & Verification

Run the verification suite to execute automated unit, security, privacy, and WebSocket integration tests:

```bash
# Run all automated test suites (95 checks across unit, autonomous, E2E, and privacy)
npm test

# Run unit & security sandbox tests (57 tests)
npm run test:engine

# Run autonomous ReAct architecture, vault rotation, broker, and permission tests (12 tests)
npm run test:autonomous

# Run End-to-End WebSocket, Pairing, CORS, and Settings test suite (7 tests)
npm run test:e2e

# Run Privacy-First Sentinel Leak Prevention tests (19 tests)
npm run test:privacy

# Run complete diagnostic verification (checks syntax, manifest, secrets, and all test suites)
npm run verify
```

---

## 🔒 Security Architecture & Secret Isolation

- **Authoritative Encrypted Credential Vault**: API keys and authentication tokens are strictly stored in an encrypted persistent vault backed by Windows DPAPI (with inputs streamed via STDIN to prevent command-line secret leakage) and an AES-256-GCM hardware-entropy fallback. The vault supports master key rotation (`vault.rotateKey()`), detects tampered authentication tags, and performs idempotent, safe discovery and scrubbing of legacy plaintext credentials from `.env`, `.secrets.json`, and `config.json`.
- **Genuine Credential Broker Verification**: The Credential Broker verifies credentials via genuine service APIs (e.g. GitHub REST API `/user` check) rather than superficial format or length checks. It strictly distinguishes API token verification from browser web session login (reporting `requiresUserAction` for browser sessions), enforces domain binding to reject lookalike/phishing domains, and ensures read-only grants cannot authorize write operations.
- **Structured Permission Enforcement & Negative Restrictions**: Supports structured grants (action, resource, scope, lifetime, risk level, issuer, revocation state) with natural language grant parsing. Supports explicit negative restrictions (e.g. "Do not allow file deletion") that take strict precedence over grants, grant revocation ("Revoke permissions"), and inspection of chained shell commands (`&&`, `||`, `;`, `|`).
- **Empirical Task Verification**: Validates actual outcomes beyond tool return values, verifying file existence/size, file deletion (`!fs.existsSync`), file move/copy integrity, terminal command exit codes, and browser navigation states.
- **Model Isolation**: Raw API keys, tokens, and passwords never enter LLM prompt contexts, logs, or extension messages. Provider adapters attach credentials internally at the network boundary.
- **Atomic File Persistence**: Secrets and configuration files are written using atomic `.tmp` file creation, `fsync`, and atomic rename (with fallback collision handling on Windows) to prevent configuration corruption or half-written states.
- **Loopback Enforcement & CORS**: The engine validates the raw physical socket address (`req.socket.remoteAddress`) for IPv4 `127.0.0.1`, IPv6 `::1`, and IPv4-mapped IPv6 `::ffff:127.0.0.1`, rejecting spoofed Host or proxy headers (`X-Forwarded-For`). Cross-origin requests from arbitrary web pages (`https://...`) are blocked.
- **Pairing Lifecycle & Recovery**: Pairing codes are ephemeral (5-minute TTL), single-use (consumed upon successful handshake), and protected against brute-force (locked after 5 failed attempts). If a code expires or is locked out:
  - Restart the engine (`npm run start:engine`) to generate a new pairing code.
- **HTTP & WebSocket Authentication**: All state-changing REST endpoints require `Authorization: Bearer <token>`. WebSocket connections authenticate via an immediate `AUTH_HANDSHAKE` message over the socket; tokens in URL query strings are rejected.
- **Approval Verification & Single-Use**: Action approvals are single-use, expire after a 3-minute TTL, and verify a SHA-256 parameter digest (`paramHash`) at execution time to prevent parameter-tampering attacks.
- **Privacy-First Sentinel Boundary**: Outbound requests to cloud providers are verified via dedicated sentinel testing (`test:privacy`). Prohibited local filesystem contents, clipboard contents, terminal outputs, and `.env` credentials are blocked from transmission to cloud models. When local tasks execute under Privacy-First, the engine automatically routes to the local Autonomous Engine or Ollama.

---

## 🚨 Common Errors & Troubleshooting

| Error / Symptom | Root Cause | Solution |
| :--- | :--- | :--- |
| **`Connection Refused :3721`** | Local engine is not running | Run `npm run start:engine` in your terminal. |
| **`403 Forbidden` on `/pair`** | Invalid or spoofed Host header, or non-loopback connection | Connect directly via `http://127.0.0.1:3721` from the local browser. |
| **`Pairing code expired or max attempts exceeded`** | Code timed out (5 min) or failed 5 times | Restart the engine (`npm run start:engine`) to generate a fresh pairing code. |
| **`Action Rejected: Path is outside approved workspace(s)`** | File operation attempted outside approved root | In **Settings**, click **+ Add Workspace** and enter your workspace path. |
| **`Emergency Stop Triggered`** | Stop button was pressed | Tool execution is locked. Restart or reset the task before dispatching new instructions. |
| **`Provider not ready / unconfigured`** | Missing cloud API key in Manual mode | Configure your API key in **Settings**, switch to **Autonomous Engine**, or use **Balanced** mode. |

---

## 📋 Limitations & Notes

- **Emergency Stop Limitations**: The Emergency Stop terminates managed child processes (via PID tree termination on Windows / SIGTERM on POSIX) and aborts active orchestration loops. External processes spawned outside the engine's supervision cannot be terminated automatically.
- **External Providers**: Cloud providers (Gemini, Claude, OpenAI) require active API keys. If keys are not configured, the engine operates via the offline Autonomous Engine or local Ollama.
- **Voice Dictation**: Requires browser microphone permissions and an internet connection for the browser's built-in Web Speech API service.
- **Browser-Internal Pages**: Chromium prevents extensions from automating `chrome://`, `brave://`, or web store pages due to browser security policies.

