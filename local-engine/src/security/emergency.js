// Antigravity Local Agent Engine - Emergency Stop Coordinator

const { exec } = require('child_process');

class EmergencyCoordinator {
  constructor(permissionManager, auditLogger) {
    this.permissionManager = permissionManager;
    this.auditLogger = auditLogger;
    this.activeChildProcesses = new Map(); // pid -> { process, command, startTime }
    this.activeAbortControllers = new Set();
    this.isHalted = false;
  }

  isEmergencyHalted() {
    return this.isHalted;
  }

  resetHalt() {
    this.isHalted = false;
  }

  // Register an active child process
  registerProcess(proc, command) {
    const pid = proc.pid;
    this.activeChildProcesses.set(pid, {
      process: proc,
      command,
      startTime: Date.now()
    });

    proc.on('exit', () => {
      this.activeChildProcesses.delete(pid);
    });

    return pid;
  }

  // Unregister process
  unregisterProcess(pid) {
    this.activeChildProcesses.delete(pid);
  }

  // Register an AbortController for a running agent loop
  createAbortController() {
    const controller = new AbortController();
    this.activeAbortControllers.add(controller);
    return controller;
  }

  removeAbortController(controller) {
    this.activeAbortControllers.delete(controller);
  }

  // Execute full Emergency Stop
  async emergencyStop() {
    console.warn('\n🚨 [Antigravity Emergency] EMERGENCY STOP INITIATED 🚨');
    this.isHalted = true;
    const stoppedProcesses = [];

    // 1. Abort all agent task loops
    for (const controller of this.activeAbortControllers) {
      try {
        controller.abort();
      } catch (e) {}
    }
    this.activeAbortControllers.clear();

    // 2. Reject all pending permissions
    if (this.permissionManager) {
      this.permissionManager.rejectAllPending('Emergency Stop triggered by user');
    }

    // 3. Kill all tracked child processes
    for (const [pid, record] of this.activeChildProcesses.entries()) {
      stoppedProcesses.push({ pid, command: record.command });
      this.killProcessTree(pid);
    }
    this.activeChildProcesses.clear();

    // 4. Log emergency audit event
    if (this.auditLogger) {
      this.auditLogger.log({
        action: 'EMERGENCY_STOP',
        status: 'HALTED',
        riskLevel: 'high',
        params: { stoppedCount: stoppedProcesses.length, stoppedProcesses }
      });
    }

    return {
      status: 'HALTED',
      stoppedProcessCount: stoppedProcesses.length,
      processes: stoppedProcesses
    };
  }

  killProcessTree(pid) {
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${pid} /T /F`, (err) => {
        if (err) console.warn(`[Emergency] Could not kill PID ${pid}:`, err.message);
      });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (e) {
        try { process.kill(pid, 'SIGKILL'); } catch (err) {}
      }
    }
  }
}

module.exports = EmergencyCoordinator;
