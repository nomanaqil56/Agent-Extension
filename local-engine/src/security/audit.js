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
      this.ensureLogDir();
      // Bound log file size: prune old lines if file exceeds 5MB
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        if (stats.size > 5 * 1024 * 1024) {
          const content = fs.readFileSync(this.logFile, 'utf8');
          const lines = content.trim().split('\n');
          if (lines.length > 1000) {
            fs.writeFileSync(this.logFile, lines.slice(-1000).join('\n') + '\n', 'utf8');
          }
        }
      }
      fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.error('[AuditLogger] Failed to write log entry:', err.message);
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
      .replace(/(?:token|auth_token|authToken)=([a-zA-Z0-9_\-]+)/gi, 'token=***REDACTED***')
      .replace(/(?:key|apiKey|geminiApiKey|anthropicApiKey|openaiApiKey)=([a-zA-Z0-9_\-]+)/gi, 'key=***REDACTED***')
      .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]+/gi, '$1***REDACTED***')
      .replace(/sk-(ant|proj|live|test)?-[a-zA-Z0-9_\-]{16,}/gi, 'sk-***REDACTED***')
      .replace(/AIzaSy[a-zA-Z0-9_\-]{20,}/gi, 'AIzaSy***REDACTED***')
      .replace(/\b[a-f0-9]{32,64}\b/gi, '***REDACTED_HEX_KEY***');
  }

  // Sanitize potentially sensitive data (e.g. passwords/tokens/keys) and truncate large content
  sanitize(obj) {
    if (!obj || typeof obj !== 'object') {
      if (typeof obj === 'string') {
        const redacted = this.redactString(obj);
        if (redacted.length > 256) {
          return redacted.slice(0, 128) + `... [TRUNCATED ${redacted.length} chars]`;
        }
        return redacted;
      }
      return obj;
    }
    try {
      const copy = JSON.parse(JSON.stringify(obj));
      const sensitiveKeys = [
        'apikey', 'password', 'token', 'auth', 'secret', 'authtoken',
        'privatekey', 'bearer', 'credential', 'geminiapikey',
        'anthropicapikey', 'openaiapikey', 'authorization', 'pairingcode'
      ];
      const traverse = (o) => {
        for (const k in o) {
          if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
            o[k] = '***REDACTED***';
          } else if (typeof o[k] === 'string') {
            const redacted = this.redactString(o[k]);
            if (redacted.length > 256) {
              o[k] = redacted.slice(0, 128) + `... [TRUNCATED ${redacted.length} chars]`;
            } else {
              o[k] = redacted;
            }
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
