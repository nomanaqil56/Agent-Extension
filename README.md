# ⚡ Antigravity Browser & Desktop AI Agent Suite

A unified AI side panel and computer-capable agent system built with a **Brave/Chrome Manifest V3 Extension** and an authenticated, loopback-restricted **Local Agent Engine**.

```
┌─────────────────────────────────────────────────────────────┐
│                   BRAVE / CHROME EXTENSION                  │
│                                                             │
│   • Single Primary Interface: Persistent Side Panel         │
│   • Quick Summon: Alt+Shift+A or Toolbar Action Icon        │
│   • Multi-Session Conversation History (Persistent)         │
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
│   • Scoped Filesystem Access (Whitelisted Directories)      │
│   • Write Approval & Delete Approval by Default             │
│   • Sensitive File Protection (.env, id_rsa, keys)          │
│   • Controlled Terminal (PowerShell / Bash with Process Kill)│
│   • Desktop Integration (App Launcher, Telemetry, Clipboard)│
│   • Security Approval Engine & Redacting Audit Logger       │
│   • Instant Emergency Stop Coordinator                      │
│   • Local Models (Ollama) & Cloud (Gemini, Claude, GPT-4o)  │
│   • Zero-Config Autonomous Engine (Deterministic Offline)   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🌟 Key Capabilities

### 1. Unified Side Panel Command Interface
- **Primary Experience**: The persistent **Side Panel** (`Alt+Shift+A` or browser toolbar icon) serves as the single primary command center for chat, tool execution, approvals, audit logs, and settings. Floating HUDs have been completely eliminated.
- **Persistent Conversation History**: Multi-session management with "New Task", conversation switching, and auto-restoration across panel open/close cycles via `chrome.storage.local`.
- **Cinematic Dark Aesthetics**: Glassmorphic dark obsidian UI (`#07090E`), neon cyan accents (`#00F2FE`), glowing micro-animations, and live step execution badges.
- **Real-Time Streaming**: Live streaming of agent reasoning thoughts, tool execution parameters, and markdown response generation.
- **Hands-Free Voice Commands**: Built-in voice dictation using the Web Speech API with microphone soundwave animation and optional Speech Synthesis audio feedback.

### 2. Autonomous Browser Automation
- **Deep Page Awareness**: Automatically distills active webpages into structured, numbered element trees (`[1]`, `[2]`, `[3]`) capturing interactive buttons, links, inputs, and forms.
- **Visual Highlighting**: Places glowing cyan target boxes and action badges (`CLICKING...`, `TYPING...`) directly on the webpage as the agent operates.
- **Multi-Tab Control**: Autonomous tab opening, closing, switching, search queries, and navigation across workflows.
- **Navigation Safety**: Strictly blocks dangerous URL schemes (`javascript:`, `file:`, `data:`) and browser-internal pages (`chrome://`, `brave://`).
- **Visual Viewport Screenshots**: Instant capture of visible tabs for multi-modal context.

### 3. Local Computer Companion
- **Scoped Filesystem Operations**: Read, write, search (`grep`), inspect, precision patch, and delete code files strictly within user-approved directory roots with canonical symlink resolution and path traversal protection.
- **Write Approval by Default**: All file modifications and deletions require user approval by default with diff previews before execution.
- **Sensitive File Protection**: Credential files (`.env`, `id_rsa`, `*.pem`, `*.key`) trigger high-risk security approval alerts and are protected from unintended exposure.
- **Controlled Terminal Runner**: Executes PowerShell / shell scripts, runs unit tests, and captures output with automatic timeouts and full process tree tracking. Terminated cleanly on task abort or Emergency Stop.
- **Desktop Actions**: Launches approved developer applications (`code`, `notepad`, `calc`, `git`), queries system telemetry (CPU, RAM, OS uptime), and reads/writes clipboard under user authorization.

### 4. User-Controlled Security & Emergency Stop
- **Action Approvals**: Sensitive actions (terminal commands, file writes, file deletion, clipboard reads, launching external apps) prompt you in the **Approvals Tab** with risk ratings (Low/Medium/High).
- **Instant Emergency Stop**: A prominent red glowing **STOP** button halts all active child terminal processes, cancels browser action loops, rejects pending requests, and blocks further tool execution within milliseconds.
- **Complete Audit Trail**: Every action is saved to an append-only JSONL log (`logs/audit.jsonl`) with automated secret redaction for API keys, tokens, and passwords. Viewable and refreshable in the **Audit Log Tab**.
- **Loopback Enforcement & CORS**: The engine is strictly bound to loopback `127.0.0.1` and restricts CORS origins to authorized extensions.

### 5. Advanced Hybrid AI Router & Policy Engine
The application transparently routes between local and cloud providers based on your selected policy:

- **Routing Policies**:
  - **Balanced (Default)**: Ordinary tasks (file listing, reading local code, system diagnostics, DOM inspection, and tab actions) stay strictly local on the Autonomous Engine or Ollama. Cloud escalation (Gemini -> Claude -> GPT-4o) occurs only when tasks require complex cognitive reasoning and cloud API keys are configured.
  - **Privacy-First**: Strict local isolation. Local files, private code, and terminal outputs are strictly processed locally and are never transmitted to cloud providers. If local content is accessed during execution, the agent enforces a privacy boundary and switches execution to the local Autonomous Engine.
  - **Cloud-Preferred**: Uses configured cloud models for general queries, falling back to local processing if cloud services are unavailable.
  - **Manual**: Strictly adheres to your selected provider. If credentials are not configured, execution is blocked with a clear diagnostic message unless fallback is explicitly enabled.
- **Supported Providers**:
  - **Google Gemini 2.0 Flash** (`GEMINI_API_KEY`)
  - **Anthropic Claude 3.5 Sonnet** (`ANTHROPIC_API_KEY`)
  - **OpenAI GPT-4o** (`OPENAI_API_KEY`)
  - **Ollama / Local LLM** (`http://localhost:11434`, e.g. `llama3.2`)
  - **Autonomous Engine**: Deterministic zero-config offline reasoning engine requiring no external API keys.

---

## 🚀 Quickstart Guide

### Step 1: Run Setup and Install Dependencies
From the root workspace directory, run:
```bash
npm run setup
```
This installs the `local-engine` dependencies, generates a cryptographically secure token, and builds extension icons.

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
Upon startup, an ephemeral **6-character Pairing Code** is displayed in the engine console banner (e.g. `Pairing Code: A1B2C3`).

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
3. Under **Security Authentication Token**, enter the 6-character **Pairing Code** shown in your engine console and click **Pair Engine**.
4. The extension securely retrieves the session token, handshakes over WebSocket without placing tokens in the URL, and displays `ONLINE :3721`.
5. Enter your API keys and click **Save Settings** to synchronize them directly with the Local Engine.
6. Under **Approved Workspaces**, approve at least one project directory to grant local filesystem and terminal access.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| **`Alt + Shift + A`** | Open or focus the **Antigravity Side Panel** |
| **`Enter`** | Dispatch instruction to the agent |
| **`Shift + Enter`** | Insert new line in prompt box |

---

## 🛠️ Testing & Verification

Run the verification suite to execute the automated unit, security, and WebSocket integration tests:

```bash
# Run unit & security sandbox tests (31 automated tests)
npm run test:engine

# Run End-to-End WebSocket & Authentication test suite (5 tests)
npm run test:e2e

# Run complete diagnostic verification
npm run verify
```

---

## 🔒 Security Configuration

The engine's access policy is configured in `local-engine/config.json`:

```json
{
  "port": 3721,
  "host": "127.0.0.1",
  "authToken": "generated_secure_token",
  "activeProvider": "hybrid",
  "hybridRoutingPolicy": "balanced",
  "approvedDirectories": [
    "."
  ],
  "approvedApplications": [
    "code", "notepad", "calc", "git"
  ],
  "security": {
    "requireApprovalForShell": true,
    "requireApprovalForFileWrite": true,
    "requireApprovalForFileDelete": true,
    "requireApprovalForClipboardRead": true,
    "maxShellExecutionTimeoutMs": 45000,
    "blockedShellPatterns": [
      "format\\s+[a-zA-Z]:",
      "rmdir\\s+/[sS]\\s+/[qQ]\\s+[cC]:\\\\",
      ":\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:",
      "dd\\s+if="
    ]
  }
}
```

---

## 📋 Troubleshooting & FAQ

- **Engine shows OFFLINE or AUTH FAILED in the Side Panel**:
  - Confirm the Local Agent Engine is running (`npm run start:engine`).
  - If `AUTH FAILED` is displayed, open the **Settings Tab**, enter the 6-character **Pairing Code** shown in your engine terminal, and click **Pair Engine**.
  - Verify your port in the Settings tab matches the port shown in your terminal (default: `3721`).
- **No Approved Workspace Configured**:
  - If all workspaces have been removed from the Settings tab, all filesystem and terminal execution tools are strictly locked down by the security sandbox. Enter a project folder path in Settings under **Approved Workspaces** and click **+ Add** to approve it.
- **File Write or Command Execution Blocked**:
  - Check the **Approvals Tab** in the side panel. High-risk operations (such as file modifications or terminal scripts) require you to click **Authorize Action**.
- **Model Key Missing**:
  - Configure your `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` in the **Settings Tab** (which syncs directly to the Local Engine via authenticated `POST /config`) or `local-engine/.env`. Alternatively, use **Ollama** locally or the built-in **Autonomous Engine** for zero-config operation!
