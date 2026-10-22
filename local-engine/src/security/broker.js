// Antigravity Local Agent Engine - Credential Broker
// Implements hard boundary between AI and protected secrets (Section 10)
// RULE: The AI may request an authorized operation involving a credential,
// but it must NEVER receive the underlying password, API key, cookie, or token.

const https = require('https');

class CredentialBroker {
  constructor(credentialVault, permissionManager, auditLogger, options = {}) {
    this.vault = credentialVault;
    this.permissionManager = permissionManager;
    this.auditLogger = auditLogger;
    this.httpTransport = options.httpTransport || null;
    this.adapters = new Map();

    // Register built-in authentication adapters for supported services (Section 8)
    this.registerBuiltInAdapters();
  }

  // Set transport for test injection or offline simulation
  setHttpTransport(transport) {
    this.httpTransport = transport;
  }

  // Register domain-specific authentication adapter
  registerAdapter(domainPattern, adapterFn) {
    this.adapters.set(domainPattern.toLowerCase(), adapterFn);
  }

  // Built-in adapters for supported domain flows
  registerBuiltInAdapters() {
    // GitHub API / Token Authentication Adapter (Genuine Verification per Part 3)
    this.registerAdapter('github.com', async ({ secret, metadata, targetDomain, operation, abortSignal }) => {
      // 1. Distinguish browser web session vs API token authentication
      if (operation === 'web_login' || operation === 'browser_login') {
        return {
          authenticated: false,
          verified: false,
          requiresUserAction: true,
          reason: 'GitHub web browser login cannot be performed using an API token. Web session authentication requires interactive browser login or OAuth session.'
        };
      }

      // 2. Structural sanity check
      if (!secret || typeof secret !== 'string' || secret.trim().length < 8) {
        return {
          authenticated: false,
          verified: false,
          reason: 'Invalid or structurally malformed GitHub credential.'
        };
      }

      // 3. Optional injected transport for deterministic unit/offline testing
      if (this.httpTransport) {
        return await this.httpTransport({ secret, metadata, targetDomain, operation, abortSignal });
      }

      // 4. Genuine verification via official GitHub REST API (GET https://api.github.com/user)
      return new Promise((resolve) => {
        if (abortSignal?.aborted) {
          return resolve({ authenticated: false, verified: false, reason: 'Verification aborted.' });
        }

        const options = {
          hostname: 'api.github.com',
          port: 443,
          path: '/user',
          method: 'GET',
          headers: {
            'User-Agent': 'Antigravity-Agent/1.0',
            'Authorization': `Bearer ${secret.trim()}`,
            'Accept': 'application/vnd.github.v3+json'
          },
          timeout: 8000
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const user = JSON.parse(data);
                resolve({
                  authenticated: true,
                  verified: true,
                  username: user.login || metadata.username,
                  accountType: user.type || 'User',
                  scopes: res.headers['x-oauth-scopes'] || 'default',
                  sessionState: 'authorized'
                });
              } catch (parseErr) {
                resolve({ authenticated: false, verified: false, reason: 'Malformed JSON response from GitHub API.' });
              }
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              resolve({
                authenticated: false,
                verified: false,
                reason: `GitHub authentication rejected with HTTP ${res.statusCode} (Invalid token or insufficient permissions).`
              });
            } else {
              resolve({
                authenticated: false,
                verified: false,
                reason: `GitHub verification returned unexpected status ${res.statusCode}.`
              });
            }
          });
        });

        if (abortSignal) {
          abortSignal.addEventListener('abort', () => {
            req.destroy(new Error('Verification cancelled'));
            resolve({ authenticated: false, verified: false, reason: 'Verification aborted.' });
          });
        }

        req.on('timeout', () => {
          req.destroy();
          resolve({ authenticated: false, verified: false, reason: 'Verification timed out connecting to GitHub API.' });
        });

        req.on('error', (err) => {
          resolve({ authenticated: false, verified: false, reason: `Network error during GitHub verification: ${err.message}` });
        });

        req.end();
      });
    });
  }

  // Find adapter matching target domain
  findAdapter(domain) {
    if (!domain) return null;
    const clean = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    for (const [pattern, adapter] of this.adapters.entries()) {
      if (clean === pattern || clean.endsWith(`.${pattern}`)) {
        return adapter;
      }
    }
    return null;
  }

  // List available credentials for model to reference by opaque ID (NO SECRETS)
  listAvailableCredentials() {
    return this.vault.listSecrets().map(c => ({
      credentialId: c.id,
      category: c.category,
      domain: c.domain,
      provider: c.provider,
      username: c.username,
      status: 'available'
    }));
  }

  // Authorize and perform an authentication request without exposing secret to model (Section 8 & 10)
  async brokerAuthentication({
    credentialId,
    targetDomain,
    operation = 'web_login',
    onApprovalNeeded = null,
    abortSignal = null
  }) {
    if (abortSignal?.aborted) {
      throw new Error('Authentication aborted: task cancelled.');
    }

    if (!credentialId || !targetDomain) {
      throw new Error('Credential Broker requires both credentialId and targetDomain.');
    }

    // 1. Verify credential exists in vault
    if (!this.vault.hasSecret(credentialId)) {
      throw new Error(`Credential "${credentialId}" not found in local vault.`);
    }

    const metadata = this.vault.getMetadata(credentialId);

    // 2. Domain binding verification: Prevent using credential for malicious phishing domains
    if (metadata.domain) {
      const cleanTarget = targetDomain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
      const cleanAllowed = metadata.domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
      const isExact = cleanTarget === cleanAllowed;
      const isSubdomain = cleanTarget.endsWith(`.${cleanAllowed}`) && cleanAllowed.includes('.');
      if (!isExact && !isSubdomain) {
        this.auditLogger.log({
          action: 'CREDENTIAL_BROKER_BLOCKED',
          credentialId,
          targetDomain,
          allowedDomain: metadata.domain,
          reason: 'Domain mismatch: credential is bound to a different domain.'
        });
        throw new Error(`Security Violation: Credential "${credentialId}" is bound to "${metadata.domain}", cannot be used on "${targetDomain}".`);
      }
    }

    // 3. User approval check (Enforce scope: read-only authorization cannot authorize a write)
    const requiredScope = (operation === 'read' || operation === 'verify') ? 'read_only' : 'write';
    const isDomainAuthorized = this.permissionManager.isDomainAuthorized(targetDomain, requiredScope);
    if (!isDomainAuthorized) {
      if (!onApprovalNeeded) {
        this.auditLogger.log({
          action: 'CREDENTIAL_BROKER_APPROVAL_MISSING',
          credentialId,
          targetDomain,
          reason: 'Approval required for domain sign-in but no approval handler provided.'
        });
        throw new Error(`Approval required to authenticate to "${targetDomain}", but no approval callback was provided.`);
      }
      const risk = {
        allowed: false,
        needsApproval: true,
        riskLevel: 'high',
        reason: `Authenticate to "${targetDomain}" using stored credential for account "${metadata.username || metadata.provider || credentialId}"`
      };

      const { record, promise } = this.permissionManager.createApprovalRequest('broker_authenticate', {
        credentialId,
        targetDomain,
        operation
      }, risk);

      onApprovalNeeded({
        approvalId: record.approvalId,
        tool: 'broker_authenticate',
        riskLevel: 'high',
        actionType: `Authorize sign-in to ${targetDomain}`,
        details: {
          credentialId,
          targetDomain,
          account: metadata.username || metadata.provider || 'default'
        }
      });

      // Wait for user approval
      await promise;
    }

    // 4. Retrieve secret strictly inside protected broker
    const secret = this.vault.getSecret(credentialId);
    if (!secret) {
      throw new Error(`Failed to decrypt credential "${credentialId}".`);
    }

    // 5. Look up real authentication adapter for the target domain (Section 8)
    const adapter = this.findAdapter(targetDomain);
    if (!adapter) {
      this.auditLogger.log({
        action: 'CREDENTIAL_BROKER_UNSUPPORTED',
        credentialId,
        targetDomain,
        status: 'UNSUPPORTED_ADAPTER',
        operation
      });

      // The broker must NOT return authenticated: true when no adapter exists!
      return {
        success: false,
        authenticated: false,
        verified: false,
        requiresUserAction: true,
        credentialId,
        domain: targetDomain,
        reason: `No automated authentication adapter available for "${targetDomain}". The user must authenticate manually.`
      };
    }

    // 6. Execute supported authentication flow & verify resulting authentication state
    const authOutcome = await adapter({
      secret,
      metadata,
      targetDomain,
      operation,
      abortSignal
    });

    if (!authOutcome || !authOutcome.authenticated || !authOutcome.verified) {
      this.auditLogger.log({
        action: 'CREDENTIAL_BROKER_AUTH_FAILED',
        credentialId,
        targetDomain,
        status: 'VERIFICATION_FAILED',
        operation
      });
      return {
        success: false,
        authenticated: false,
        verified: false,
        requiresUserAction: Boolean(authOutcome?.requiresUserAction),
        credentialId,
        domain: targetDomain,
        reason: authOutcome?.reason || `Authentication verification failed on "${targetDomain}".`
      };
    }

    // Log brokered action without exposing secret
    this.auditLogger.log({
      action: 'CREDENTIAL_BROKERED_AUTH',
      credentialId,
      targetDomain,
      status: 'AUTHENTICATED_AND_VERIFIED',
      operation
    });

    // 7. Return MINIMAL verified status result to LLM - NEVER the raw secret or password!
    return {
      success: true,
      authenticated: true,
      verified: true,
      credentialId,
      domain: targetDomain,
      message: `Authentication broker successfully executed and verified login for ${targetDomain}. Account session active.`
    };
  }

  // Sanitize any model observation text against all stored vault secrets
  sanitizeText(text) {
    if (!text || typeof text !== 'string') return text;
    let sanitized = text;

    for (const item of this.vault.listSecrets()) {
      const secret = this.vault.getSecret(item.id);
      if (secret && secret.length >= 6) {
        // Redact exact secret occurrences
        const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        sanitized = sanitized.replace(new RegExp(escaped, 'g'), `[REDACTED_SECRET_${item.id.toUpperCase()}]`);
      }
    }
    return sanitized;
  }
}

module.exports = CredentialBroker;
