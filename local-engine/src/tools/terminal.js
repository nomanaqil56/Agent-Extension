// Antigravity Local Agent Engine - Controlled Terminal & Shell Execution Tool

const { spawn } = require('child_process');
const path = require('path');

class TerminalTool {
  constructor(permissionManager, emergencyCoordinator, defaultTimeoutMs = 45000) {
    this.permissionManager = permissionManager;
    this.emergencyCoordinator = emergencyCoordinator;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async executeCommand({ command, cwd = null, timeoutMs = null }) {
    if (!command || typeof command !== 'string') {
      throw new Error('Command string is required');
    }

    const workingDir = cwd ? path.resolve(cwd) : this.permissionManager.approvedDirectories[0] || process.cwd();
    if (!this.permissionManager.isPathApproved(workingDir)) {
      throw new Error(`Working directory "${workingDir}" is outside approved directories.`);
    }

    const timeout = timeoutMs || this.defaultTimeoutMs;
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : '/bin/bash';
    const shellArgs = isWin ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(shell, shellArgs, {
        cwd: workingDir,
        env: { ...process.env, CI: 'true', PAGER: 'cat' },
        windowsHide: true
      });

      // Register with Emergency Coordinator
      const pid = this.emergencyCoordinator.registerProcess(child, command);

      const timer = setTimeout(() => {
        timedOut = true;
        this.emergencyCoordinator.killProcessTree(pid);
        reject(new Error(`Command timed out after ${timeout / 1000} seconds: "${command}"`));
      }, timeout);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (stdout.length > 50000) { // Limit buffer
          stdout = stdout.slice(-50000);
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > 20000) {
          stderr = stderr.slice(-20000);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.emergencyCoordinator.unregisterProcess(pid);
        reject(new Error(`Failed to spawn command: ${err.message}`));
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        this.emergencyCoordinator.unregisterProcess(pid);

        if (!timedOut) {
          resolve({
            command,
            cwd: workingDir,
            exitCode,
            success: exitCode === 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            durationMs: Date.now() - startTime
          });
        }
      });
    });
  }
}

module.exports = TerminalTool;
