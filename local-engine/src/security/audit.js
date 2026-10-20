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
      action: event.action || 'UNKNOWN_ACTION',
      tool: event.tool || null,
      status: event.status || 'INFO', // STARTED, COMPLETED, FAILED, APPROVED, DENIED
      riskLevel: event.riskLevel || 'low',
      userApproved: event.userApproved ?? null,
      params: this.sanitize(event.params),
      result: this.sanitize(event.result),
      error: event.error ? String(event.error) : null,
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

  // Sanitize potentially sensitive data (e.g. passwords/tokens)
  sanitize(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    try {
      const copy = JSON.parse(JSON.stringify(obj));
      const sensitiveKeys = ['apiKey', 'password', 'token', 'auth', 'secret'];
      const traverse = (o) => {
        for (const k in o) {
          if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
            o[k] = '***REDACTED***';
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
