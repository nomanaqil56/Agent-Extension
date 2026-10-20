# ⚡ Antigravity Browser & Desktop AI Agent Suite

A unified AI side panel and computer-capable agent system built with a **Brave/Chrome Manifest V3 Extension** and an authenticated, loopback-restricted **Local Agent Engine**.

```
┌─────────────────────────────────────────────────────────────┐
│                   BRAVE / CHROME EXTENSION                  │
│                                                             │
│   • Single Primary Interface: Persistent Side Panel         │
│   • Quick Summon: Alt+Shift+A or Toolbar Action Icon        │
│   • Visual Highlights & DOM Distillation                    │
│   • Multi-Tab Management & Visual Screenshot View           │
│   • Hands-free Voice Dictation (Web Speech API)             │
│   • Approvals, Audit Logs & Model Selector (Hybrid AI)      │
└──────────────────────────────▲──────────────────────────────┘
                               │ Authenticated Loopback Bridge
                               │ (127.0.0.1:3721 with Secret Token)
┌──────────────────────────────▼──────────────────────────────┐
│                     LOCAL AGENT ENGINE                      │
│                                                             │
│   • Multi-step ReAct Planner & Autonomous Loop              │
│   • Scoped Filesystem Access (Whitelisted Directories)     │
│   • Controlled Terminal (PowerShell / Bash with Process Kill)│
│   • Desktop Integration (App Launcher, Telemetry, Clipboard)│
│   • Security Approval Engine & Audit Logger                 │
│   • Instant Emergency Stop Coordinator                      │
│   • Hybrid AI Provider (Gemini / Claude / GPT-4o / Ollama / │
│     Autonomous Zero-Config Engine)                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🌟 Key Capabilities

### 1. Unified Side Panel Command Interface
- **Primary Experience**: The persistent **Side Panel** (`Alt+Shift+A` or browser toolbar icon) serves as the single primary command center for chat, tool execution, approvals, audit logs, and settings.
- **Cinematic Dark Aesthetics**: Glassmorphic dark obsidian UI (`#07090E`), neon cyan accents (`#00F2FE`), glowing micro-animations, and live step execution badges.
- **Real-Time Streaming**: Live streaming of agent reasoning thoughts, tool execution parameters, and markdown response generation.
- **Hands-Free Voice Commands**: Built-in voice dictation using the Web Speech API with microphone soundwave animation and optional Speech Synthesis audio feedback.

### 2. Autonomous Browser Automation
- **Deep Page Awareness**: Automatically distills active webpages into structured, numbered element trees (`[1]`, `[2]`, `[3]`) capturing interactive buttons, links, inputs, and forms.
- **Visual Highlighting**: Places glowing cyan target boxes and action badges (`CLICKING...`, `TYPING...`) directly on the webpage as the agent operates.
- **Multi-Tab Control**: Autonomous tab opening, closing, switching, search queries, and navigation across workflows.
- **Visual Viewport Screenshots**: Instant capture of visible tabs for multi-modal context.

### 3. Local Computer Companion
- **Scoped Filesystem Operations**: Read, write, search (`grep`), inspect, precision patch, and delete code files strictly within user-approved directory roots with symlink resolution and path traversal protection.
- **Controlled Terminal Runner**: Executes PowerShell / shell scripts, runs unit tests, and captures output with automatic timeouts and full process tree tracking.
- **Desktop Actions**: Launches approved developer applications (`code`, `notepad`, `calc`, `git`), queries system telemetry (CPU, RAM, OS uptime), and reads/writes clipboard.

### 4. User-Controlled Security & Emergency Stop
- **Action Approvals**: Sensitive actions (terminal commands, file writes, file deletion, launching external apps) prompt you in the **Approvals Tab** with risk ratings (Low/Medium/High).
- **Instant Emergency Stop**: A prominent red glowing **STOP** button halts all active child terminal processes, cancels browser action loops, rejects pending requests, and blocks further tool execution within milliseconds.
- **Complete Audit Trail**: Every action is saved to an append-only JSONL log (`logs/audit.jsonl`) and viewable in the **Audit Log Tab**.
- **Loopback Enforcement & CORS**: The engine is strictly bound to loopback `127.0.0.1` and restricts CORS origins to authorized extensions.

### 5. Hybrid Model Strategy
- **Hybrid AI Auto-Routing**: Automatically selects the best available provider (Gemini -> Claude -> GPT-4o -> Ollama -> Autonomous Engine) and seamlessly reports provider switches.
- **Cloud Models**: Native support for **Google Gemini 2.0 Flash**, **Anthropic Claude 3.5 Sonnet**, and **OpenAI GPT-4o**.
- **Local Models**: Connect directly to **Ollama** or **LM Studio** (`http://localhost:11434`) for 100% offline private execution.
- **Zero-Config Autonomous Fallback**: If no API keys or local models are active, the built-in heuristic reasoning engine executes multi-step web and desktop tasks right out of the box!

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
The engine starts on `ws://127.0.0.1:3721` with health checks available at `http://127.0.0.1:3721/health`.

### Step 3: Load the Extension into Brave or Chrome
1. Open your browser and navigate to:
   - **Brave**: `brave://extensions`
   - **Chrome**: `chrome://extensions`
2. Enable the **"Developer mode"** toggle in the top-right corner.
3. Click **"Load unpacked"**.
4. Select the **`extension`** folder inside this project directory (`d:\Coding\Projects\Personal Projects\Agent-Extension\extension`).
5. Pin the **Antigravity AI Agent** icon to your browser toolbar!

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| **`Alt + Shift + A`** | Open the **Antigravity Side Panel** |
| **`Enter`** | Dispatch instruction to the agent |
| **`Shift + Enter`** | Insert new line in prompt box |

---

## 🛠️ Testing & Verification

Run the full diagnostic suite to verify that all extension components, security sandboxes, and execution tools are operating with 100% health:

```bash
# Run unit & security sandbox tests
npm run test:engine

# Run End-to-End WebSocket simulation test
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
  "approvedDirectories": [
    "D:\\Coding\\Projects\\Personal Projects\\Agent-Extension"
  ],
  "approvedApplications": [
    "code", "notepad", "calc", "git"
  ],
  "security": {
    "requireApprovalForShell": true,
    "requireApprovalForFileWrite": false,
    "requireApprovalForFileDelete": true,
    "blockedShellPatterns": [
      "format\\s+[a-zA-Z]:",
      "rmdir\\s+/[sS]\\s+/[qQ]\\s+[cC]:\\\\"
    ]
  }
}
```

To configure cloud API keys, either set them in `local-engine/.env` or enter them directly inside the **Settings Tab** of the extension side panel.
