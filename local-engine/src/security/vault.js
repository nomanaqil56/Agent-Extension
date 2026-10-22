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

    this.vaultKeyPath = process.env.ENGINE_VAULT_KEY_PATH || `${this.vaultPath}.key`;
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

    // High-entropy 256-bit key for AES-256-GCM fallback (Section 7.2)
    // ALWAYS initialized so that AES-256-GCM fallback is 100% resilient
    if (process.env.ENGINE_VAULT_KEY) {
      this.encryptionKey = crypto.createHash('sha256').update(process.env.ENGINE_VAULT_KEY).digest();
    } else if (fs.existsSync(this.vaultKeyPath)) {
      try {
        const rawKey = fs.readFileSync(this.vaultKeyPath, 'utf8');
        if (rawKey.startsWith('DPAPI:') && this.dpapiAvailable) {
          const decryptedB64 = this.dpapiDecrypt(rawKey.slice(6));
          this.encryptionKey = Buffer.from(decryptedB64, 'base64');
        } else {
          const rawBuffer = fs.readFileSync(this.vaultKeyPath);
          if (rawBuffer.length === 32) {
            this.encryptionKey = rawBuffer;
          } else {
            this.encryptionKey = crypto.createHash('sha256').update(rawBuffer).digest();
          }
        }
      } catch (e) {
        this.encryptionKey = crypto.randomBytes(32);
      }
    } else {
      this.encryptionKey = crypto.randomBytes(32);
      try {
        const dir = path.dirname(this.vaultKeyPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (this.dpapiAvailable) {
          try {
            const wrapped = 'DPAPI:' + this.dpapiEncrypt(this.encryptionKey.toString('base64'));
            fs.writeFileSync(this.vaultKeyPath, wrapped, { mode: 0o600 });
          } catch (dpapiErr) {
            fs.writeFileSync(this.vaultKeyPath, this.encryptionKey, { mode: 0o600 });
          }
        } else {
          fs.writeFileSync(this.vaultKeyPath, this.encryptionKey, { mode: 0o600 });
        }
      } catch (e) {}
    }
  }

  // Windows DPAPI ProtectedData.Protect using PowerShell via STDIN (Zero secrets in command-line arguments)
  dpapiEncrypt(plainText) {
    const b64 = Buffer.from(plainText, 'utf8').toString('base64');
    const script = `
Add-Type -AssemblyName System.Security;
$in = [System.Console]::In.ReadToEnd().Trim();
$plain = [System.Convert]::FromBase64String($in);
$enc = [System.Security.Cryptography.ProtectedData]::Protect($plain, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);
[System.Convert]::ToBase64String($enc)
`.trim();

    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input: b64,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    });
    return output.trim();
  }

  // Windows DPAPI ProtectedData.Unprotect using PowerShell via STDIN (Zero secrets in command-line arguments)
  dpapiDecrypt(base64Cipher) {
    const script = `
Add-Type -AssemblyName System.Security;
$in = [System.Console]::In.ReadToEnd().Trim();
$bytes = [System.Convert]::FromBase64String($in);
$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);
[System.Text.Encoding]::UTF8.GetString($dec)
`.trim();

    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input: base64Cipher.trim(),
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
      try {
        const iv = Buffer.from(record.iv, 'base64');
        const tag = Buffer.from(record.tag, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(record.data, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
      } catch (gcmErr) {
        // Attempt backward-compatible migration decrypt if previously encrypted before vault key generation
        try {
          const machineEntropy = [
            process.env.USER || process.env.USERNAME || 'antigravity_user',
            process.arch,
            process.platform,
            process.env.COMPUTERNAME || process.env.HOSTNAME || 'localhost',
            'antigravity_agent_vault_v1'
          ].join(':');
          const legacyKey = crypto.scryptSync(machineEntropy, 'antigravity_salt_9921', 32);
          const iv = Buffer.from(record.iv, 'base64');
          const tag = Buffer.from(record.tag, 'base64');
          const decipher = crypto.createDecipheriv('aes-256-gcm', legacyKey, iv);
          decipher.setAuthTag(tag);
          let decrypted = decipher.update(record.data, 'base64', 'utf8');
          decrypted += decipher.final('utf8');
          return decrypted;
        } catch (legacyErr) {
          throw new Error(`Decryption failed: ${gcmErr.message}`);
        }
      }
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
    try {
      return this.decryptValue(record.encrypted);
    } catch (e) {
      return null;
    }
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

  // Helper: Retrieve system auth token
  getAuthToken() {
    return this.getSecret('auth_token') || null;
  }

  // Helper: Store system auth token
  setAuthToken(token) {
    if (!token) return false;
    return this.storeSecret('auth_token', token, {
      category: 'system_token',
      provider: 'system'
    });
  }

  // Migrate any existing unencrypted .secrets.json entries into vault (Section 7.3)
  migrateLegacySecrets() {
    try {
      if (!fs.existsSync(this.legacySecretsPath)) return;
      const raw = fs.readFileSync(this.legacySecretsPath, 'utf8');
      const legacy = JSON.parse(raw);
      let migratedCount = 0;

      const mapping = {
        geminiApiKey: { id: 'gemini', provider: 'gemini', category: 'provider_key' },
        anthropicApiKey: { id: 'anthropic', provider: 'anthropic', category: 'provider_key' },
        openaiApiKey: { id: 'openai', provider: 'openai', category: 'provider_key' },
        authToken: { id: 'auth_token', provider: 'system', category: 'system_token' }
      };

      const keysToMigrate = Object.entries(mapping).filter(([key]) => Boolean(legacy[key]));
      if (keysToMigrate.length === 0) {
        // Nothing to migrate; safely remove empty or invalid legacy file
        try { fs.unlinkSync(this.legacySecretsPath); } catch (e) {}
        return;
      }

      let allVerified = true;

      for (const [key, info] of keysToMigrate) {
        const secretVal = legacy[key];
        if (!this.hasSecret(info.id)) {
          this.storeSecret(info.id, secretVal, info);
        }

        // Verify retrieval without logging the secret
        const retrieved = this.getSecret(info.id);
        if (retrieved === secretVal) {
          migratedCount++;
        } else {
          allVerified = false;
        }
      }

      // Safely retire the plaintext legacy secrets file ONLY when all credentials are verified
      if (allVerified && migratedCount > 0) {
        try {
          fs.unlinkSync(this.legacySecretsPath);
          console.log('[CredentialVault] Successfully migrated and verified all legacy secrets. Plaintext .secrets.json retired.');
        } catch (unlinkErr) {
          console.warn('[CredentialVault] Legacy secrets migrated but could not remove plaintext file:', unlinkErr.message);
        }
      }
    } catch (e) {
      // Non-fatal legacy migration failure: do NOT delete legacy file if parsing or migration fails
      console.warn('[CredentialVault] Migration notice:', e.message);
    }

    // Also migrate and scrub any legacy secrets from .env files
    try {
      this.migrateLegacyEnvFile();
    } catch (envMigrateErr) {
      console.warn('[CredentialVault] .env migration notice:', envMigrateErr.message);
    }
  }

  // Key rotation: Re-encrypt all credentials under a newly generated or provided master key
  rotateKey(newKey = null) {
    const candidateKey = newKey || crypto.randomBytes(32);
    if (!Buffer.isBuffer(candidateKey) || candidateKey.length !== 32) {
      throw new Error('Rotation key must be a 32-byte Buffer.');
    }

    // Step 1: Decrypt and extract all existing secrets into memory
    const decryptedItems = [];
    for (const [id, record] of this.credentials.entries()) {
      try {
        const plain = this.decryptValue(record.encrypted);
        if (plain === null || plain === undefined) {
          throw new Error(`Failed to decrypt credential "${id}" during rotation.`);
        }
        decryptedItems.push({ id, plain, metadata: record });
      } catch (err) {
        throw new Error(`Rotation aborted: cannot decrypt credential "${id}": ${err.message}`);
      }
    }

    // Backup state in case of failure
    const originalKey = this.encryptionKey;
    const originalCredentials = new Map(this.credentials);

    try {
      // Step 2: Switch active encryption key
      this.encryptionKey = candidateKey;

      // Step 3: Re-encrypt all items under the new key
      for (const item of decryptedItems) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let encrypted = cipher.update(item.plain, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const authTag = cipher.getAuthTag().toString('base64');

        const updatedRecord = {
          ...item.metadata,
          encrypted: {
            method: 'aes-256-gcm',
            data: encrypted,
            iv: iv.toString('base64'),
            tag: authTag
          },
          updatedAt: new Date().toISOString()
        };
        this.credentials.set(item.id, updatedRecord);
      }

      // Step 4: Persist the new key to disk wrapped by DPAPI if available
      if (this.dpapiAvailable) {
        try {
          const wrapped = 'DPAPI:' + this.dpapiEncrypt(this.encryptionKey.toString('base64'));
          fs.writeFileSync(this.vaultKeyPath, wrapped, { mode: 0o600 });
        } catch (dpErr) {
          fs.writeFileSync(this.vaultKeyPath, this.encryptionKey, { mode: 0o600 });
        }
      } else {
        fs.writeFileSync(this.vaultKeyPath, this.encryptionKey, { mode: 0o600 });
      }

      // Step 5: Save updated vault
      this.saveVault();

      // Step 6: Verify all items can be decrypted with the new key
      for (const item of decryptedItems) {
        const verifyPlain = this.getSecret(item.id);
        if (verifyPlain !== item.plain) {
          throw new Error(`Verification failed for credential "${item.id}" after key rotation.`);
        }
      }

      return {
        success: true,
        rotatedItems: decryptedItems.length,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      // Rollback on any failure
      this.encryptionKey = originalKey;
      this.credentials = originalCredentials;
      this.saveVault();
      throw new Error(`Key rotation failed and was rolled back: ${err.message}`);
    }
  }

  // Safe migration and scrubbing of plaintext secrets from .env files
  migrateLegacyEnvFile(envFilePath = null) {
    const candidatePaths = envFilePath 
      ? [envFilePath] 
      : [
          path.join(__dirname, '..', '..', '.env'),
          path.join(__dirname, '..', '.env')
        ];

    const results = { discovered: 0, migrated: 0, scrubbed: false };

    for (const p of candidatePaths) {
      if (!fs.existsSync(p)) continue;
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const lines = raw.split(/\r?\n/);
        const secretKeys = ['ENGINE_AUTH_TOKEN', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
        const extracted = {};

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^([A-Za-z0-9_]+)=(.*)$/);
          if (match) {
            const key = match[1];
            let val = match[2].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (secretKeys.includes(key) && val && val !== 'agy_local_secret_token_default') {
              extracted[key] = val;
            }
          }
        }

        const entries = Object.entries(extracted);
        if (entries.length === 0) continue;

        results.discovered += entries.length;
        let allVerified = true;

        for (const [key, val] of entries) {
          let id = 'auth_token';
          let category = 'system_token';
          let provider = 'system';

          if (key === 'GEMINI_API_KEY') { id = 'gemini'; category = 'provider_key'; provider = 'gemini'; }
          else if (key === 'OPENAI_API_KEY') { id = 'openai'; category = 'provider_key'; provider = 'openai'; }
          else if (key === 'ANTHROPIC_API_KEY') { id = 'anthropic'; category = 'provider_key'; provider = 'anthropic'; }

          if (!this.hasSecret(id)) {
            this.storeSecret(id, val, { category, provider });
          }

          const check = this.getSecret(id);
          if (check === val) {
            results.migrated++;
          } else {
            allVerified = false;
          }
        }

        // Scrub secrets from .env ONLY if all secrets are verified in vault
        if (allVerified && results.migrated > 0) {
          const scrubbedLines = lines.map(line => {
            const match = line.trim().match(/^([A-Za-z0-9_]+)=(.*)$/);
            if (match && secretKeys.includes(match[1])) {
              return `# ${match[1]}=[MIGRATED_TO_SECURE_VAULT]`;
            }
            return line;
          });

          const tmpEnv = `${p}.tmp.${Date.now()}`;
          fs.writeFileSync(tmpEnv, scrubbedLines.join('\n'), { mode: 0o600 });
          try {
            fs.renameSync(tmpEnv, p);
          } catch (rErr) {
            fs.copyFileSync(tmpEnv, p);
            fs.unlinkSync(tmpEnv);
          }
          results.scrubbed = true;
          console.log(`[CredentialVault] Successfully migrated and scrubbed secrets from "${p}".`);
        }
      } catch (err) {
        console.warn(`[CredentialVault] Note during .env migration on "${p}":`, err.message);
      }
    }

    return results;
  }
}

module.exports = CredentialVault;
