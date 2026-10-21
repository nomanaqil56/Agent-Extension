// Antigravity Local Agent Engine - Emergency Stop Coordinator
// Tracks active child processes and ensures verified process termination,
// observing actual process exit states (termination_requested, confirmed, unconfirmed, failed).

const { exec } = require('child_process');

class EmergencyCoordinator {
  constructor(permissionManager, auditLogger) {
    this.permissionManager = permissionManager;
    this.auditLogger = auditLogger;
    this.activeChildProcesses = new Map(); // pid -> { process, command, startTime, state, exitCode }
    this.activeAbortControllers = new Set();
    this.isHalted = false;
  }

  isEmergencyHalted() {
    return this.isHalted;
  }

  resetHalt() {
    this.isHalted = false;
  }

  // Check if a process is still alive using signal 0
  isProcessAlive(pid) {
    if (!pid || typeof pid !== 'number') return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      if (err.code === 'ESRCH') return false; // Process does not exist
      if (err.code === 'EPERM') return true;  // Exists but cannot signal
      return false;
    }
  }

  // Register an active child process
  registerProcess(proc, command) {
    const pid = proc.pid;
    const record = {
      process: proc,
      command,
      startTime: Date.now(),
      state: 'running',
      exitCode: null,
      signal: null
    };

    this.activeChildProcesses.set(pid, record);

    proc.once('exit', (code, sig) => {
      record.state = 'confirmed';
      record.exitCode = code;
      record.signal = sig;
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

  // Terminate a child process and verify exit via polling
  async terminateProcessWithObservation(pid, record, maxWaitMs = 1500) {
    record.state = 'termination_requested';
    const isWin = process.platform === 'win32';

    const sendKillSignal = (force = true) => {
      if (isWin) {
        try {
          exec(`taskkill /pid ${pid} /T ${force ? '/F' : ''}`, () => {});
        } catch (e) {}
        try {
          if (record.process && !record.process.killed) {
            record.process.kill(force ? 'SIGKILL' : 'SIGTERM');
          }
        } catch (e) {}
      } else {
        try {
          process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
        } catch (e) {
          try {
            process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
          } catch (err) {}
        }
      }
    };

    // Issue initial termination
    sendKillSignal(true);

    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      if (!this.isProcessAlive(pid)) {
        record.state = 'confirmed';
        return {
          pid,
          command: record.command,
          state: 'confirmed',
          exitCode: record.exitCode
        };
      }
      // Retry aggressive kill after brief delay if process is still running
      if (Date.now() - startTime > 250) {
        sendKillSignal(true);
      }
      await new Promise(r => setTimeout(r, 50));
    }

    // Final check
    if (!this.isProcessAlive(pid)) {
      record.state = 'confirmed';
      return {
        pid,
        command: record.command,
        state: 'confirmed',
        exitCode: record.exitCode
      };
    }

    record.state = 'unconfirmed';
    return {
      pid,
      command: record.command,
      state: 'unconfirmed',
      error: 'Process exit could not be confirmed within observation window.'
    };
  }

  // Execute full Emergency Stop with verified process termination
  async emergencyStop(options = {}) {
    console.warn('\n🚨 [Antigravity Emergency] EMERGENCY STOP INITIATED 🚨');
    this.isHalted = true;

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

    // 3. Terminate all tracked child processes and observe actual exit
    const terminationPromises = [];
    for (const [pid, record] of this.activeChildProcesses.entries()) {
      terminationPromises.push(
        this.terminateProcessWithObservation(pid, record, options.maxWaitMs || 1500)
      );
    }

    const processResults = await Promise.all(terminationPromises);
    this.activeChildProcesses.clear();

    const confirmedCount = processResults.filter(r => r.state === 'confirmed').length;
    const unconfirmedCount = processResults.filter(r => r.state === 'unconfirmed').length;
    const failedCount = processResults.filter(r => r.state === 'failed').length;

    // 4. Log emergency audit event
    if (this.auditLogger) {
      this.auditLogger.log({
        action: 'EMERGENCY_STOP',
        status: 'HALTED',
        riskLevel: 'high',
        params: {
          stoppedProcessCount: confirmedCount,
          unconfirmedCount,
          failedCount,
          processes: processResults
        }
      });
    }

    return {
      status: 'HALTED',
      stoppedProcessCount: confirmedCount,
      unconfirmedCount,
      failedCount,
      processes: processResults
    };
  }

  // Direct process tree kill helper
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
