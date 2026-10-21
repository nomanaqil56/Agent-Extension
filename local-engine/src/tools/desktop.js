// Antigravity Local Agent Engine - Desktop Integration & System Telemetry
// Hardened against argument and clipboard injection attacks

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

class DesktopTool {
  constructor(permissionManager) {
    this.permissionManager = permissionManager;
  }

  // Map approved application names to platform-specific executables
  resolveApplicationBinary(appName) {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    const binaryMap = {
      calc: isWin ? 'calc.exe' : (isMac ? 'open' : 'gnome-calculator'),
      notepad: isWin ? 'notepad.exe' : (isMac ? 'open' : 'gedit'),
      code: isWin ? 'code.cmd' : 'code',
      git: isWin ? 'git.exe' : 'git'
    };

    return binaryMap[appName] || null;
  }

  // Validate arguments against application-specific security policy
  validateApplicationArgs(cleanApp, args) {
    if (!Array.isArray(args)) {
      throw new Error(`Application arguments must be an array of strings, received: ${typeof args}`);
    }

    // Common defense: Reject dangerous characters, null bytes, and excessive length
    for (const arg of args) {
      if (typeof arg !== 'string') {
        throw new Error('All application arguments must be strings.');
      }
      if (arg.includes('\0')) {
        throw new Error('Arguments containing null bytes are strictly forbidden.');
      }
      if (/[\x00-\x1F\x7F]/.test(arg)) {
        throw new Error('Arguments containing unprintable control characters are forbidden.');
      }
      if (arg.length > 2048) {
        throw new Error('Argument exceeds maximum length limit (2048 chars).');
      }
    }

    // App-specific argument validation
    switch (cleanApp) {
      case 'calc':
        if (args.length > 0) {
          throw new Error('Calculator application takes no command-line arguments.');
        }
        return [];

      case 'notepad': {
        if (args.length > 1) {
          throw new Error('Notepad accepts at most one file path argument.');
        }
        if (args.length === 1) {
          const target = args[0];
          // Block option switches like /p
          if (target.startsWith('/') || target.startsWith('-')) {
            throw new Error(`Invalid argument "${target}" for notepad. Switch flags are not permitted.`);
          }
          // Enforce workspace containment: clean install with zero workspaces MUST block opening files
          if (this.permissionManager) {
            const hasWorkspaces = typeof this.permissionManager.isWorkspaceConfigured === 'function'
              ? this.permissionManager.isWorkspaceConfigured()
              : (this.permissionManager.approvedDirectories && this.permissionManager.approvedDirectories.size > 0);
            if (!hasWorkspaces) {
              throw new Error(`Cannot open file "${target}": No approved workspaces configured.`);
            }
            const resolved = path.resolve(target);
            if (!this.permissionManager.isPathApproved(resolved)) {
              throw new Error(`File path "${target}" is outside approved workspaces.`);
            }
          }
        }
        return args;
      }

      case 'code': {
        const allowedFlags = new Set(['-r', '-n', '-g', '--reuse-window', '--new-window', '--goto']);
        const sanitized = [];
        for (const arg of args) {
          if (arg.startsWith('-')) {
            if (!allowedFlags.has(arg)) {
              throw new Error(`Unsupported or dangerous flag "${arg}" for code editor.`);
            }
            sanitized.push(arg);
          } else {
            // Path argument: clean install with zero workspaces MUST block opening files
            if (this.permissionManager) {
              const hasWorkspaces = typeof this.permissionManager.isWorkspaceConfigured === 'function'
                ? this.permissionManager.isWorkspaceConfigured()
                : (this.permissionManager.approvedDirectories && this.permissionManager.approvedDirectories.size > 0);
              if (!hasWorkspaces) {
                throw new Error(`Cannot open target path "${arg}": No approved workspaces configured.`);
              }
              const resolved = path.resolve(arg);
              if (!this.permissionManager.isPathApproved(resolved)) {
                throw new Error(`Target path "${arg}" is outside approved workspaces.`);
              }
            }
            sanitized.push(arg);
          }
        }
        return sanitized;
      }

      case 'git': {
        if (args.length === 0) {
          throw new Error('Git requires a subcommand (e.g. status, log, diff, branch).');
        }
        const allowedSubcommands = new Set(['status', 'log', 'diff', 'branch', 'show', '--version', 'tag']);
        const sub = args[0].toLowerCase();
        if (!allowedSubcommands.has(sub)) {
          throw new Error(`Git subcommand "${args[0]}" is not permitted via desktop launcher.`);
        }
        return args;
      }

      default:
        return args;
    }
  }

  // Launch approved desktop application safely (NO shell interpolation)
  async launchApplication({ appName, args = [] }) {
    if (!appName || typeof appName !== 'string') {
      throw new Error('Valid application name is required.');
    }

    const cleanApp = appName.toLowerCase().trim();
    if (!this.permissionManager.approvedApplications.has(cleanApp)) {
      throw new Error(`Application "${appName}" is not in the approved desktop applications list.`);
    }

    const binary = this.resolveApplicationBinary(cleanApp) || cleanApp;
    const validatedArgs = this.validateApplicationArgs(cleanApp, args);

    return new Promise((resolve, reject) => {
      let settled = false;

      // Platform adaptation for macOS open
      let spawnCmd = binary;
      let spawnArgs = validatedArgs;
      if (process.platform === 'darwin') {
        if (cleanApp === 'calc') {
          spawnCmd = 'open';
          spawnArgs = ['-a', 'Calculator'];
        } else if (cleanApp === 'notepad') {
          spawnCmd = 'open';
          spawnArgs = ['-a', 'TextEdit', ...validatedArgs];
        }
      } else if (process.platform === 'win32' && (binary.endsWith('.cmd') || binary.endsWith('.bat'))) {
        // Node.js throws EINVAL when spawning .cmd/.bat files with shell:false on Windows (CVE-2024-27980)
        // Spawn through cmd.exe with structured arguments while keeping execution shell-free (no interpolation)
        spawnCmd = process.env.ComSpec || 'cmd.exe';
        spawnArgs = ['/d', '/s', '/c', binary, ...validatedArgs];
      }

      // Safe shell-free process launch
      const child = spawn(spawnCmd, spawnArgs, {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: true
      });

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Failed to launch "${cleanApp}": ${err.message}`));
        }
      });

      // Allow brief window to capture immediate ENOENT or spawn errors
      setTimeout(() => {
        if (!settled) {
          settled = true;
          try { child.unref(); } catch (e) {}
          resolve({
            launched: true,
            application: cleanApp,
            pid: child.pid || null,
            timestamp: new Date().toISOString()
          });
        }
      }, 100);
    });
  }

  // Get host system telemetry
  async getSystemInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'Unknown',
      memory: {
        totalGb: (totalMem / (1024 ** 3)).toFixed(2),
        usedGb: (usedMem / (1024 ** 3)).toFixed(2),
        freeGb: (freeMem / (1024 ** 3)).toFixed(2),
        usagePercent: Math.round((usedMem / totalMem) * 100)
      },
      uptimeHours: (os.uptime() / 3600).toFixed(1),
      userInfo: {
        username: os.userInfo().username,
        homedir: os.userInfo().homedir
      }
    };
  }

  // Read system clipboard safely without command string interpolation
  async clipboardRead(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let child;
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          if (child) {
            try { child.kill('SIGKILL'); } catch (e) {}
          }
          reject(new Error(`Clipboard read timed out after ${timeoutMs}ms.`));
        }
      }, timeoutMs);

      if (process.platform === 'win32') {
        child = spawn('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard'
        ], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false
        });
      } else if (process.platform === 'darwin') {
        child = spawn('pbpaste', [], {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false
        });
      } else {
        child = spawn('xclip', ['-selection', 'clipboard', '-o'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false
        });
      }

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Clipboard utility unavailable or failed: ${err.message}`));
        }
      });

      child.on('close', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (code !== 0 && !stdout) {
            return reject(new Error(`Clipboard read failed with exit code ${code}: ${stderr.trim()}`));
          }
          resolve({ text: stdout.replace(/\r\n/g, '\n').trimEnd() });
        }
      });
    });
  }

  // Set system clipboard safely using raw standard input stream (NO string interpolation)
  async clipboardWrite({ text }, timeoutMs = 6000) {
    if (typeof text !== 'string') {
      throw new Error(`Clipboard text must be a string, received ${typeof text}`);
    }

    return new Promise((resolve, reject) => {
      let child;
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          if (child) {
            try { child.kill('SIGKILL'); } catch (e) {}
          }
          reject(new Error(`Clipboard write timed out after ${timeoutMs}ms.`));
        }
      }, timeoutMs);

      if (process.platform === 'win32') {
        // Read raw data from STDIN into Set-Clipboard without executing or parsing as code
        child = spawn('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; $inputData = [Console]::In.ReadToEnd(); Set-Clipboard -Value $inputData'
        ], {
          stdio: ['pipe', 'ignore', 'pipe'],
          windowsHide: true,
          shell: false
        });
      } else if (process.platform === 'darwin') {
        child = spawn('pbcopy', [], {
          stdio: ['pipe', 'ignore', 'pipe'],
          shell: false
        });
      } else {
        child = spawn('xclip', ['-selection', 'clipboard'], {
          stdio: ['pipe', 'ignore', 'pipe'],
          shell: false
        });
      }

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Clipboard utility unavailable or failed: ${err.message}`));
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      child.on('close', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (code !== 0) {
            return reject(new Error(`Clipboard write failed with exit code ${code}: ${stderr.trim()}`));
          }
          resolve({ success: true, length: text.length });
        }
      });

      // Write raw bytes safely to stdin stream
      try {
        child.stdin.write(Buffer.from(text, 'utf8'));
        child.stdin.end();
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Failed to write to clipboard process stdin: ${err.message}`));
        }
      }
    });
  }

  // Helper aliases for direct tool calls
  async launchApp(appName, args = []) {
    return this.launchApplication({ appName, args });
  }

  async writeClipboard(text) {
    return this.clipboardWrite({ text });
  }

  async readClipboard() {
    return this.clipboardRead();
  }
}

module.exports = DesktopTool;
