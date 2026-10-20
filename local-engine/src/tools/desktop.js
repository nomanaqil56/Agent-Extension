// Antigravity Local Agent Engine - Desktop Integration & System Telemetry

const { exec, spawn } = require('child_process');
const os = require('os');

class DesktopTool {
  constructor(permissionManager) {
    this.permissionManager = permissionManager;
  }

  // Launch approved desktop application
  async launchApplication({ appName, args = [] }) {
    const cleanApp = appName.toLowerCase().trim();
    if (!this.permissionManager.approvedApplications.has(cleanApp)) {
      throw new Error(`Application "${appName}" is not in the approved desktop applications list.`);
    }

    return new Promise((resolve, reject) => {
      let command = cleanApp;
      if (args && args.length > 0) {
        command += ` ${args.join(' ')}`;
      }

      exec(command, { detached: true, stdio: 'ignore' }, (err) => {
        if (err && !err.killed) {
          return reject(new Error(`Failed to launch "${appName}": ${err.message}`));
        }
        resolve({
          launched: true,
          application: cleanApp,
          timestamp: new Date().toISOString()
        });
      });
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

  // Read system clipboard
  async clipboardRead() {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        exec('powershell.exe -NoProfile -Command "Get-Clipboard"', (err, stdout) => {
          if (err) return reject(new Error(`Clipboard read error: ${err.message}`));
          resolve({ text: stdout.trim() });
        });
      } else {
        // macOS or Linux
        const cmd = process.platform === 'darwin' ? 'pbpaste' : 'xclip -selection clipboard -o';
        exec(cmd, (err, stdout) => {
          if (err) return reject(new Error(`Clipboard read error: ${err.message}`));
          resolve({ text: stdout.trim() });
        });
      }
    });
  }

  // Set system clipboard
  async clipboardWrite({ text }) {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        const escaped = text.replace(/"/g, '`"');
        exec(`powershell.exe -NoProfile -Command "Set-Clipboard -Value \\"${escaped}\\""`, (err) => {
          if (err) return reject(new Error(`Clipboard write error: ${err.message}`));
          resolve({ success: true, length: text.length });
        });
      } else {
        const cmd = process.platform === 'darwin' ? 'pbcopy' : 'xclip -selection clipboard';
        const proc = exec(cmd, (err) => {
          if (err) return reject(err);
          resolve({ success: true, length: text.length });
        });
        proc.stdin.write(text);
        proc.stdin.end();
      }
    });
  }
}

module.exports = DesktopTool;
