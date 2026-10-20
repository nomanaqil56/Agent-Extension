# ⚡ Antigravity Browser & Desktop AI Agent Suite

A cinematic AI command center and computer-capable agent system built with a **Brave/Chrome Manifest V3 Extension** and an authenticated **Local Agent Engine**.

```
┌─────────────────────────────────────────────────────────────┐
│                   BRAVE / CHROME EXTENSION                  │
│                                                             │
│   • Persistent Side Panel (Alt+Shift+A)                    │
│   • Floating Command Center HUD (Alt+Space)                 │
│   • Visual Highlights & DOM Distillation                    │
│   • Multi-Tab Management & Visual Screenshot View           │
│   • Voice Dictation (Web Speech API)                        │
└──────────────────────────────▲──────────────────────────────┘
                               │ Authenticated WebSocket Bridge
                               │ (Port 3721 with Secret Token)
┌──────────────────────────────▼──────────────────────────────┐
│                     LOCAL AGENT ENGINE                      │
│                                                             │
│   • Multi-step ReAct Planner & Autonomous Loop              │
│   • Scoped Filesystem Access (Whitelisted Directories)     │
│   • Controlled Terminal (PowerShell / Bash with Process Kill)│
│   • Desktop Integration (App Launcher, Telemetry, Clipboard)│
│   • Security Approval Engine & Audit Logger                 │
│   • Instant Emergency Stop Coordinator                      │
│   • Hybrid Provider (Gemini / Claude / GPT-4o / Ollama /    │
│     Autonomous Zero-Config Engine)                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🌟 Key Capabilities

### 1. Floating AI Command Center & Persistent Side Panel
- **Quick Summon**: Press **`Alt+Space`** to summon the floating spotlight HUD over any webpage, or click the toolbar icon / press **`Alt+Shift+A`** to open the persistent side panel.
- **Cinematic Dark Aesthetics**: Glassmorphic dark obsidian UI (`#07090E`), neon cyan accents (`#00F2FE`), glowing micro-animations, and live step execution badges.
- **Real-Time Streaming**: Live streaming of agent reasoning thoughts, tool execution parameters, and markdown response generation.
- **Hands-Free Voice Commands**: Built-in voice dictation using the Web Speech API with microphone soundwave animation and optional Speech Synthesis audio feedback.

### 2. Autonomous Browser Automation
- **Deep Page Awareness**: Automatically distills active webpages into structured, numbered element trees (`[1]`, `[2]`, `[3]`) capturing interactive buttons, links, inputs, and forms.
- **Visual Highlighting**: Places glowing cyan target boxes and action badges (`CLICKING...`, `TYPING...`) directly on the webpage as the agent operates.
- **Multi-Tab Control**: Autonomous tab opening, closing, switching, search queries, and navigation across workflows.
- **Visual Viewport Screenshots**: Instant capture of visible tabs for multi-modal context.

### 3. Local Computer Companion
- **Scoped Filesystem Operations**: Read, write, search (`grep`), inspect, and precision patch code files strictly within user-approved directory roots with path traversal protection.
- **Controlled Terminal Runner**: Executes PowerShell / shell scripts, runs unit tests, and captures output with automatic timeouts and full process tree tracking.
- **Desktop Actions**: Launches approved developer applications (`code`, `notepad`, `calc`, `git`), queries system telemetry (CPU, RAM, OS uptime), and reads/writes clipboard.

### 4. User-Controlled Security & Emergency Stop
- **Action Approvals**: High-risk actions (terminal commands, file modifications, deleting files, launching external apps) prompt you in the **Approvals Tab** with risk ratings (Low/Medium/High).
- **Instant Emergency Stop**: A prominent red glowing **STOP** button halts all active child terminal processes, cancels browser action loops, and rejects pending requests within milliseconds.
- **Complete Audit Trail**: Every action is saved to an append-only JSONL log (`logs/audit.jsonl`) and viewable in the **Audit Log Tab**.

### 5. Hybrid Model Strategy
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
This installs the `local-engine` dependencies and generates high-resolution extension icons.

### Step 2: Start the Local Agent Engine
On Windows:
```cmd
scripts\start-engine.bat
```
Or via npm:
```bash
npm run start:engine
```
The engine starts on `ws://localhost:3721` with health checks available at `http://localhost:3721/health`.

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
| **`Alt + Space`** | Toggle the **Floating Command Center HUD** over any webpage |
| **`Alt + Shift + A`** | Open the **Persistent Side Panel** assistant |
| **`Enter`** | Dispatch instruction to the agent |
| **`Escape`** | Close the floating HUD |

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
  "authToken": "agy_local_secret_token_default",
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
