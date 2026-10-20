// Antigravity Local Agent Engine - Audit Logging System
// Maintains an append-only JSONL log of every browser automation, filesystem access, and terminal command

const fs = require('fs');
const path = require('path');

class AuditLogger {
  constructor(logDir = null) {
    this.logDir = logDir || path.join(__dirname, '..', '..', 'logs');
    this.logFile = path.join(this.logDir, 'audit.jsonl');
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  log(event) {
    const entry = {
      timestamp: new Date().toISOString(),
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      taskId: event.taskId || null,
      action: event.action || 'UNKNOWN_ACTION',
      tool: event.tool || null,
      status: event.status || 'INFO', // STARTED, COMPLETED, FAILED, APPROVED, DENIED, BLOCKED, HALTED
      riskLevel: event.riskLevel || 'low',
      userApproved: event.userApproved ?? null,
      params: this.sanitize(event.params),
      result: this.sanitize(event.result),
      error: event.error ? this.redactString(String(event.error)) : null,
      durationMs: event.durationMs || 0
    };

    try {
      fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.error('[AuditLogger] Failed to write log entry:', err);
    }

    return entry;
  }

  // Get recent entries
  getRecentEntries(limit = 100) {
    if (!fs.existsSync(this.logFile)) return [];

    try {
      const content = fs.readFileSync(this.logFile, 'utf8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);
      return lines
        .slice(-limit)
        .map(l => {
          try { return JSON.parse(l); } catch (e) { return null; }
        })
        .filter(Boolean)
        .reverse();
    } catch (err) {
      console.error('[AuditLogger] Read error:', err);
      return [];
    }
  }

  // Clear log entries with verified retention record
  clearLog(operator = 'user') {
    try {
      this.ensureLogDir();
      fs.writeFileSync(this.logFile, '', 'utf8');
      return this.log({
        action: 'AUDIT_LOG_CLEARED',
        status: 'COMPLETED',
        riskLevel: 'medium',
        params: { clearedBy: operator, timestamp: new Date().toISOString() }
      });
    } catch (e) {
      console.error('[AuditLogger] Clear error:', e);
      return null;
    }
  }

  // Redact secrets in strings (tokens, API keys, URLs)
  redactString(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/token=([a-zA-Z0-9_\-]+)/gi, 'token=***REDACTED***')
      .replace(/key=([a-zA-Z0-9_\-]+)/gi, 'key=***REDACTED***')
      .replace(/bearer\s+([a-zA-Z0-9_\-\.]+)/gi, 'Bearer ***REDACTED***')
      .replace(/sk-(ant|proj)-[a-zA-Z0-9_\-]+/gi, 'sk-***REDACTED***')
      .replace(/AIzaSy[a-zA-Z0-9_\-]+/gi, 'AIzaSy***REDACTED***');
  }

  // Sanitize potentially sensitive data (e.g. passwords/tokens/keys)
  sanitize(obj) {
    if (!obj || typeof obj !== 'object') {
      if (typeof obj === 'string') return this.redactString(obj);
      return obj;
    }
    try {
      const copy = JSON.parse(JSON.stringify(obj));
      const sensitiveKeys = ['apikey', 'password', 'token', 'auth', 'secret', 'authtoken', 'privatekey'];
      const traverse = (o) => {
        for (const k in o) {
          if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
            o[k] = '***REDACTED***';
          } else if (typeof o[k] === 'string') {
            o[k] = this.redactString(o[k]);
          } else if (typeof o[k] === 'object' && o[k] !== null) {
            traverse(o[k]);
          }
        }
      };
      traverse(copy);
      return copy;
    } catch (e) {
      return '[Unserializable]';
    }
  }
}

module.exports = AuditLogger;
