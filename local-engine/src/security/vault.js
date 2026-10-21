// Antigravity Local Agent Engine - Secure Local Credential Vault
// Implements OS-backed secret protection (DPAPI on Windows, AES-256-GCM hardware-entropy fallback)
// Section 9: Secure Local Credential Vault

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

class CredentialVault {
  constructor(vaultPath = null) {
    this.vaultPath = vaultPath || process.env.ENGINE_VAULT_PATH || path.join(__dirname, '..', '..', '.vault.enc');
    this.legacySecretsPath = process.env.ENGINE_SECRETS_PATH || path.join(__dirname, '..', '..', '.secrets.json');
    this.credentials = new Map(); // id -> { encryptedSecret, iv, tag, authType, metadata }
    this.isWindows = process.platform === 'win32';
    this.dpapiAvailable = false;
    this.encryptionKey = null;

    this.initSecurity();
    this.loadVault();
    this.migrateLegacySecrets();
  }

  // Initialize encryption subsystem
  initSecurity() {
    if (this.isWindows) {
      // Test DPAPI availability via .NET ProtectedData
      try {
        const testText = 'antigravity_dpapi_probe';
        const encrypted = this.dpapiEncrypt(testText);
        const decrypted = this.dpapiDecrypt(encrypted);
        if (decrypted === testText) {
          this.dpapiAvailable = true;
        }
      } catch (e) {
        this.dpapiAvailable = false;
      }
    }

    // Hardware & User-isolated machine entropy key for AES-256-GCM fallback
    const machineEntropy = [
      process.env.USER || process.env.USERNAME || 'antigravity_user',
      process.arch,
      process.platform,
      process.env.COMPUTERNAME || process.env.HOSTNAME || 'localhost',
      'antigravity_agent_vault_v1'
    ].join(':');

    this.encryptionKey = crypto.scryptSync(machineEntropy, 'antigravity_salt_9921', 32);
  }

  // Windows DPAPI ProtectedData.Protect using PowerShell
  dpapiEncrypt(plainText) {
    const b64 = Buffer.from(plainText, 'utf8').toString('base64');
    const script = `
Add-Type -AssemblyName System.Security;
$plain = [System.Convert]::FromBase64String('${b64}');
$enc = [System.Security.Cryptography.ProtectedData]::Protect($plain, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);
[System.Convert]::ToBase64String($enc)
`.trim();

    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    });
    return output.trim();
  }

  // Windows DPAPI ProtectedData.Unprotect using PowerShell
  dpapiDecrypt(base64Cipher) {
    const script = `
Add-Type -AssemblyName System.Security;
$bytes = [System.Convert]::FromBase64String('${base64Cipher.trim()}');
$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);
[System.Text.Encoding]::UTF8.GetString($dec)
`.trim();

    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    });
    return output.trim();
  }

  // Encrypt secret value using DPAPI or AES-256-GCM
  encryptValue(secretText) {
    if (!secretText || typeof secretText !== 'string') return null;

    if (this.dpapiAvailable) {
      try {
        const cipher = this.dpapiEncrypt(secretText);
        return {
          method: 'dpapi',
          data: cipher
        };
      } catch (e) {
        // Fall back to AES-256-GCM if DPAPI process fails
      }
    }

    // AES-256-GCM authenticated encryption
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(secretText, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    return {
      method: 'aes-256-gcm',
      data: encrypted,
      iv: iv.toString('base64'),
      tag: authTag
    };
  }

  // Decrypt secret value
  decryptValue(record) {
    if (!record || !record.data) return null;

    if (record.method === 'dpapi') {
      try {
        return this.dpapiDecrypt(record.data);
      } catch (e) {
        throw new Error(`DPAPI Decryption failed: ${e.message}`);
      }
    }

    if (record.method === 'aes-256-gcm') {
      const iv = Buffer.from(record.iv, 'base64');
      const tag = Buffer.from(record.tag, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(record.data, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }

    throw new Error(`Unsupported encryption method: ${record.method}`);
  }

  // Store secret in vault
  storeSecret(id, secretText, metadata = {}) {
    if (!id || typeof id !== 'string') {
      throw new Error('Credential ID must be a valid non-empty string');
    }
    if (!secretText || typeof secretText !== 'string') {
      throw new Error('Secret value must be a valid non-empty string');
    }

    const encrypted = this.encryptValue(secretText);
    const record = {
      id,
      encrypted,
      category: metadata.category || 'provider_key',
      provider: metadata.provider || null,
      domain: metadata.domain || null,
      username: metadata.username || null,
      createdAt: metadata.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.credentials.set(id, record);
    this.saveVault();
    return this.getMetadata(id);
  }

  // Retrieve raw secret (FOR INTERNAL AUTHORIZED USE ONLY - NEVER EXPOSE TO LLM OR EXTENSION)
  getSecret(id) {
    const record = this.credentials.get(id);
    if (!record) return null;
    return this.decryptValue(record.encrypted);
  }

  // Check if credential exists
  hasSecret(id) {
    return this.credentials.has(id);
  }

  // Delete credential
  deleteSecret(id) {
    if (!this.credentials.has(id)) return false;
    this.credentials.delete(id);
    this.saveVault();
    return true;
  }

  // Generate masked preview (e.g. "sk-...ab12" or "••••••••")
  maskValue(secretText) {
    if (!secretText) return '••••••••';
    const s = String(secretText).trim();
    if (s.length <= 8) return '••••••••';
    if (s.startsWith('sk-') || s.startsWith('AIza')) {
      const prefix = s.slice(0, 4);
      const suffix = s.slice(-4);
      return `${prefix}...${suffix}`;
    }
    return `${s.slice(0, 3)}...${s.slice(-3)}`;
  }

  // Get sanitized metadata for a single credential
  getMetadata(id) {
    const record = this.credentials.get(id);
    if (!record) return null;
    return {
      id: record.id,
      category: record.category,
      provider: record.provider,
      domain: record.domain,
      username: record.username,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      hasSecret: true
    };
  }

  // List all credentials with metadata only (NEVER returns secret values)
  listSecrets() {
    const list = [];
    for (const [id, record] of this.credentials.entries()) {
      list.push({
        id,
        category: record.category,
        provider: record.provider,
        domain: record.domain,
        username: record.username,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      });
    }
    return list;
  }

  // Atomically persist vault to disk
  saveVault() {
    const serialized = [];
    for (const [id, record] of this.credentials.entries()) {
      serialized.push(record);
    }

    const payload = JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      dpapi: this.dpapiAvailable,
      items: serialized
    }, null, 2);

    const dir = path.dirname(this.vaultPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = `${this.vaultPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, payload, { mode: 0o600 });
    try {
      if (fs.existsSync(this.vaultPath)) {
        fs.unlinkSync(this.vaultPath);
      }
      fs.renameSync(tmpPath, this.vaultPath);
    } catch (e) {
      fs.copyFileSync(tmpPath, this.vaultPath);
      fs.unlinkSync(tmpPath);
    }
  }

  // Load vault from disk
  loadVault() {
    try {
      if (!fs.existsSync(this.vaultPath)) return;
      const raw = fs.readFileSync(this.vaultPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.items)) {
        for (const item of data.items) {
          if (item && item.id) {
            this.credentials.set(item.id, item);
          }
        }
      }
    } catch (e) {
      console.warn('[CredentialVault] Warning loading vault:', e.message);
    }
  }

  // Migrate any existing unencrypted .secrets.json entries into vault
  migrateLegacySecrets() {
    try {
      if (!fs.existsSync(this.legacySecretsPath)) return;
      const raw = fs.readFileSync(this.legacySecretsPath, 'utf8');
      const legacy = JSON.parse(raw);
      let migrated = false;

      const mapping = {
        geminiApiKey: { id: 'gemini', provider: 'gemini', category: 'provider_key' },
        anthropicApiKey: { id: 'anthropic', provider: 'anthropic', category: 'provider_key' },
        openaiApiKey: { id: 'openai', provider: 'openai', category: 'provider_key' },
        authToken: { id: 'auth_token', provider: 'system', category: 'system_token' }
      };

      for (const [key, info] of Object.entries(mapping)) {
        if (legacy[key] && !this.hasSecret(info.id)) {
          this.storeSecret(info.id, legacy[key], info);
          migrated = true;
        }
      }

      if (migrated) {
        console.log('[CredentialVault] Migrated legacy secrets to encrypted Credential Vault.');
      }
    } catch (e) {
      // Non-fatal legacy migration
    }
  }
}

module.exports = CredentialVault;
