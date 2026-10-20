// Antigravity Local Agent Engine - Persistent Task Memory & Context Manager

const fs = require('fs');
const path = require('path');

class MemoryManager {
  constructor(storageDir = null) {
    this.storageDir = storageDir || path.join(__dirname, '..', '..', 'data');
    this.dataFile = path.join(this.storageDir, 'sessions.json');
    this.sessions = new Map();
    this.loadSessions();
  }

  loadSessions() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const raw = fs.readFileSync(this.dataFile, 'utf8');
        const parsed = JSON.parse(raw);
        for (const [id, data] of Object.entries(parsed)) {
          this.sessions.set(id, data);
        }
      }
    } catch (e) {
      console.warn('[MemoryManager] Could not load sessions:', e.message);
    }
  }

  saveSessions() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
      const obj = Object.fromEntries(this.sessions);
      fs.writeFileSync(this.dataFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      console.warn('[MemoryManager] Could not save sessions:', e.message);
    }
  }

  getOrCreateSession(sessionId = 'default') {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        createdAt: new Date().toISOString(),
        messages: [],
        taskHistory: [],
        projectContext: {}
      });
      this.saveSessions();
    }
    return this.sessions.get(sessionId);
  }

  addMessage(sessionId, role, content) {
    const session = this.getOrCreateSession(sessionId);
    session.messages.push({
      role,
      content,
      timestamp: new Date().toISOString()
    });
    // Keep max 40 messages per session
    if (session.messages.length > 40) {
      session.messages = session.messages.slice(-40);
    }
    this.saveSessions();
  }

  recordTaskStep(sessionId, step) {
    const session = this.getOrCreateSession(sessionId);
    session.taskHistory.push({
      ...step,
      timestamp: new Date().toISOString()
    });
    this.saveSessions();
  }

  clearSession(sessionId) {
    this.sessions.delete(sessionId);
    this.saveSessions();
  }
}

module.exports = MemoryManager;
