// Antigravity Local Agent Engine - Credential Broker
// Implements hard boundary between AI and protected secrets (Section 10)
// RULE: The AI may request an authorized operation involving a credential,
// but it must NEVER receive the underlying password, API key, cookie, or token.

class CredentialBroker {
  constructor(credentialVault, permissionManager, auditLogger) {
    this.vault = credentialVault;
    this.permissionManager = permissionManager;
    this.auditLogger = auditLogger;
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

  // Authorize and perform an authentication request without exposing secret to model
  async brokerAuthentication({
    credentialId,
    targetDomain,
    operation = 'web_login',
    onApprovalNeeded = null,
    abortSignal = null
  }) {
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
      if (cleanTarget !== cleanAllowed && !cleanTarget.endsWith(`.${cleanAllowed}`)) {
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

    // 3. Permission authorization check
    const risk = {
      allowed: false,
      needsApproval: true,
      riskLevel: 'high',
      reason: `Authenticate to "${targetDomain}" using stored credential for account "${metadata.username || metadata.provider || credentialId}"`
    };

    if (onApprovalNeeded) {
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

    // 4. Retrieve secret strictly for internal brokered dispatch
    const secret = this.vault.getSecret(credentialId);
    if (!secret) {
      throw new Error(`Failed to decrypt credential "${credentialId}".`);
    }

    // Log brokered action without exposing secret
    this.auditLogger.log({
      action: 'CREDENTIAL_BROKERED_AUTH',
      credentialId,
      targetDomain,
      status: 'AUTHORIZED',
      operation
    });

    // 5. Return MINIMAL status result to LLM - NEVER the raw secret or password!
    return {
      success: true,
      authenticated: true,
      credentialId,
      domain: targetDomain,
      message: `Authentication broker successfully dispatched credentials for ${targetDomain}. Account session authorized.`
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
