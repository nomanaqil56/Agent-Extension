const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class PermissionManager {
  constructor(config = {}) {
    this.config = config;
    this.approvedDirectories = (Array.isArray(config.approvedDirectories) ? config.approvedDirectories : []).map(d => path.resolve(d));
    this.approvedApplications = new Set(
      (config.approvedApplications || ['code', 'notepad', 'calc', 'git']).map(a => a.toLowerCase())
    );
    this.pendingApprovals = new Map();
    this.sessionAuthorizations = new Set();
    this.activeGrants = new Map(); // grantId -> { action, resource, scope, expiresAt, riskLevel }
    this.authorizedDomains = new Map(); // domain -> { scope, authorizedAt, expiresAt }

    // Sensitive files patterns that require explicit authorization
    this.sensitiveFilePatterns = [
      /\.env(\..+)?$/i,
      /id_rsa/i,
      /id_ed25519/i,
      /\.pem$/i,
      /\.key$/i,
      /credentials/i,
      /shadow$/i,
      /passwd$/i,
      /\.gitconfig$/i,
      /\.bash_history$/i
    ];
  }

  // Authorize a domain for authenticated web actions (Section 11)
  authorizeDomain(domain, scope = 'read_only', lifetimeMs = 3600000) {
    if (!domain || typeof domain !== 'string') return false;
    const clean = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    this.authorizedDomains.set(clean, {
      domain: clean,
      scope,
      authorizedAt: Date.now(),
      expiresAt: Date.now() + lifetimeMs
    });
    return true;
  }

  isDomainAuthorized(domain, requiredScope = 'read_only') {
    if (!domain || typeof domain !== 'string') return false;
    const clean = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    const auth = this.authorizedDomains.get(clean);
    if (!auth) return false;
    if (Date.now() > auth.expiresAt) {
      this.authorizedDomains.delete(clean);
      return false;
    }
    if (requiredScope === 'write' && auth.scope === 'read_only') return false;
    return true;
  }

  // Helper: extract clean hostname domain from URL
  extractDomain(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      return parsed.hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
      return null;
    }
  }

  // Add a structured permission grant (Section 12)
  addGrant({ action, resource, scope = 'task', lifetimeMs = 3600000, riskLevel = 'medium' }) {
    if (!action) return null;
    const grantId = `grant_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const grant = {
      grantId,
      action: action.toLowerCase(),
      resource: resource ? this.canonicalizePath(resource) || resource : null,
      scope,
      riskLevel,
      createdAt: Date.now(),
      expiresAt: Date.now() + lifetimeMs
    };
    this.activeGrants.set(grantId, grant);
    return grant;
  }

  // Check if an action on a resource is authorized by an active unexpired grant
  isActionCoveredByGrant(action, targetPath = null) {
    if (!action) return false;
    const now = Date.now();
    const actionNorm = action.toLowerCase();
    const targetCanon = targetPath ? (this.canonicalizePath(targetPath) || targetPath) : null;

    for (const [id, grant] of this.activeGrants.entries()) {
      if (now > grant.expiresAt) {
        this.activeGrants.delete(id);
        continue;
      }

      // Check action match
      const actionMatches = grant.action === '*' ||
        grant.action === actionNorm ||
        (grant.action === 'write_file' && (actionNorm === 'patch_file' || actionNorm === 'write_file')) ||
        (grant.action === 'modify_files' && (actionNorm === 'patch_file' || actionNorm === 'write_file'));

      if (!actionMatches) continue;

      // If grant specifies a resource path, target must be inside that resource
      if (grant.resource && targetCanon) {
        const isWin = process.platform === 'win32';
        const normGrant = isWin ? grant.resource.toLowerCase() : grant.resource;
        const normTarget = isWin ? targetCanon.toLowerCase() : targetCanon;
        const rel = path.relative(normGrant, normTarget);
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
          return true;
        }
      } else if (!grant.resource) {
        return true;
      }
    }
    return false;
  }

  // Parse natural language permission requests into structured grants (Section 12)
  parseNaturalLanguageGrant(text, defaultDir = null) {
    if (!text || typeof text !== 'string') return null;
    const lower = text.toLowerCase();

    // Check for explicit grant intent
    const hasGrantIntent = (lower.includes('allow') || lower.includes('grant') || lower.includes('permit') || lower.includes('authorize')) &&
      (lower.includes('without asking') || lower.includes('for this task') || lower.includes('for the whole task') || lower.includes('automatically'));

    if (!hasGrantIntent) return null;

    // Detect target action
    let action = null;
    if (lower.includes('write') || lower.includes('modify') || lower.includes('edit') || lower.includes('create file')) {
      action = 'write_file';
    } else if (lower.includes('terminal') || lower.includes('command') || lower.includes('run test') || lower.includes('execute')) {
      action = 'execute_command';
    }

    if (!action) return null;

    // Detect resource
    let targetResource = null;
    if (this.approvedDirectories.length > 0) {
      targetResource = defaultDir && this.isPathApproved(defaultDir) ? defaultDir : this.approvedDirectories[0];
    }

    if (!targetResource) return null;

    return this.addGrant({
      action,
      resource: targetResource,
      scope: 'task',
      lifetimeMs: 3600000,
      riskLevel: 'medium'
    });
  }

  // Canonicalize a path and resolve symlinks defensively
  canonicalizePath(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') return null;
    if (targetPath.includes('\0')) return null;

    // Defend against UNC network shares (e.g. \\evil.com\share or //evil.com/share)
    if (/^[\\\/]{2}/.test(targetPath.trim())) {
      const isApprovedUnc = this.approvedDirectories.some(d => /^[\\\/]{2}/.test(d));
      if (!isApprovedUnc) return null;
    }

    try {
      const resolved = path.resolve(targetPath);
      if (fs.existsSync(resolved)) {
        return fs.realpathSync(resolved);
      }
      // If path does not exist yet (e.g. creating a new file), resolve the closest existing parent
      let current = resolved;
      const unexistingParts = [];
      while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) break;
        unexistingParts.unshift(path.basename(current));
        current = parent;
      }
      if (fs.existsSync(current)) {
        const realParent = fs.realpathSync(current);
        return path.join(realParent, ...unexistingParts);
      }
      return resolved;
    } catch (e) {
      return path.resolve(targetPath);
    }
  }

  // Check if a target file matches sensitive secret file patterns
  isSensitiveFile(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const base = path.basename(filePath);
    return this.sensitiveFilePatterns.some(pat => pat.test(base) || pat.test(filePath));
  }

  // Normalize path parameter aliases across different tool schemas
  normalizeFilePath(params = {}) {
    if (!params || typeof params !== 'object') return null;
    return params.filePath || params.path || params.targetFile || params.targetPath || params.file || null;
  }

  // Normalize directory parameter aliases
  normalizeDirPath(params = {}) {
    if (!params || typeof params !== 'object') return '.';
    return params.dirPath || params.directory || params.path || params.cwd || '.';
  }

  // Get current list of approved directories
  getApprovedDirectories() {
    return [...this.approvedDirectories];
  }

  // Add a user-approved folder scope
  addApprovedDirectory(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') return null;
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Directory does not exist: "${resolved}"`);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: "${resolved}"`);
    }
    const canonical = this.canonicalizePath(resolved);
    if (!this.approvedDirectories.includes(canonical)) {
      this.approvedDirectories.push(canonical);
    }
    return canonical;
  }

  // Check if at least one approved workspace directory is configured
  isWorkspaceConfigured() {
    return Array.isArray(this.approvedDirectories) && this.approvedDirectories.length > 0;
  }

  // Remove an approved folder scope (allows list to become empty without restoring process.cwd)
  removeApprovedDirectory(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') return false;
    const canonical = this.canonicalizePath(path.resolve(dirPath)) || path.resolve(dirPath);
    const initialLength = this.approvedDirectories.length;
    this.approvedDirectories = this.approvedDirectories.filter(d => {
      const isWin = process.platform === 'win32';
      return isWin ? d.toLowerCase() !== canonical.toLowerCase() : d !== canonical;
    });
    return this.approvedDirectories.length < initialLength;
  }

  // Validate if a path falls within approved directories (including symlink resolution and traversal defense)
  isPathApproved(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') return false;
    if (!this.approvedDirectories || this.approvedDirectories.length === 0) return false;

    // Detect basic null bytes or malformed inputs
    if (targetPath.includes('\0')) return false;

    // Defend against UNC network shares unless explicitly approved
    if (/^[\\\/]{2}/.test(targetPath.trim())) {
      const isApprovedUnc = this.approvedDirectories.some(d => /^[\\\/]{2}/.test(d));
      if (!isApprovedUnc) return false;
    }

    const canonicalTarget = this.canonicalizePath(targetPath);
    if (!canonicalTarget) return false;

    const isWindows = process.platform === 'win32';
    const normTarget = isWindows ? canonicalTarget.toLowerCase() : canonicalTarget;

    return this.approvedDirectories.some(approved => {
      const canonicalApproved = this.canonicalizePath(approved) || approved;
      const normApproved = isWindows ? canonicalApproved.toLowerCase() : canonicalApproved;

      // On Windows, verify drive roots match (prevent cross-drive relative traversal)
      if (isWindows) {
        const rootApproved = path.parse(normApproved).root.toLowerCase();
        const rootTarget = path.parse(normTarget).root.toLowerCase();
        if (rootApproved !== rootTarget) return false;
      }

      const relative = path.relative(normApproved, normTarget);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }

  // Analyze risk level for any requested tool action
  analyzeActionRisk(tool, params = {}) {
    // If tool accesses local filesystem or workspace, enforce that at least one workspace is configured
    const workspaceTools = [
      'list_files', 'search_files', 'read_file', 'file_info',
      'write_file', 'patch_file', 'delete_file', 'execute_command',
      'create_directory', 'copy_file', 'move_file'
    ];
    if (workspaceTools.includes(tool) && !this.isWorkspaceConfigured()) {
      return {
        allowed: false,
        needsApproval: false,
        blocked: true,
        riskLevel: 'forbidden',
        reason: 'No approved workspace directory is configured. Please approve a workspace in Settings before accessing local files or terminal.'
      };
    }

    switch (tool) {
      // Safe Browser Operations & Telemetry
      case 'browser_distill_dom':
      case 'browser_extract_text':
      case 'browser_get_page_context':
      case 'browser_list_tabs':
      case 'browser_screenshot':
      case 'browser_scroll':
      case 'get_system_info':
      case 'clipboard_write':
      case 'list_available_credentials':
        return { allowed: true, needsApproval: false, riskLevel: 'low' };

      case 'create_directory': {
        const dirPath = params.dirPath || params.directory || params.path;
        if (!dirPath || !this.isPathApproved(dirPath)) {
          return { allowed: false, needsApproval: false, blocked: true, riskLevel: 'forbidden', reason: `Directory "${dirPath}" is outside approved workspace directories.` };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'low' };
      }

      case 'copy_file':
      case 'move_file': {
        const src = this.normalizeFilePath({ path: params.source || params.src || params.filePath });
        const dst = this.normalizeFilePath({ path: params.destination || params.dest || params.targetPath });
        if (!src || !dst || !this.isPathApproved(src) || !this.isPathApproved(dst)) {
          return { allowed: false, needsApproval: false, blocked: true, riskLevel: 'forbidden', reason: 'Source or destination path is outside approved workspace directories.' };
        }
        if (tool === 'move_file' && this.config.security?.requireApprovalForFileDelete !== false) {
          return { allowed: false, needsApproval: true, riskLevel: 'medium', reason: `Moving or renaming file "${path.basename(src)}"` };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'low' };
      }

      // Clipboard Read: Sensitive because it may contain passwords or private keys
      case 'clipboard_read': {
        if (this.config.security?.requireApprovalForClipboardRead !== false) {
          return {
            allowed: false,
            needsApproval: true,
            riskLevel: 'medium',
            reason: 'Reading system clipboard text requires user authorization.'
          };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'low' };
      }

      // Filesystem Reads & Exploration
      case 'list_files':
      case 'search_files': {
        const dirPath = this.normalizeDirPath(params);
        if (!this.isPathApproved(dirPath)) {
          return {
            allowed: false,
            needsApproval: false,
            blocked: true,
            riskLevel: 'forbidden',
            reason: `Directory "${dirPath}" is outside approved workspace directories. Action strictly forbidden.`
          };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'low' };
      }

      case 'read_file':
      case 'file_info': {
        const filePath = this.normalizeFilePath(params);
        if (!filePath) {
          return { allowed: false, needsApproval: false, blocked: true, riskLevel: 'high', reason: 'Missing file path parameter' };
        }
        if (!this.isPathApproved(filePath)) {
          return {
            allowed: false,
            needsApproval: false,
            blocked: true,
            riskLevel: 'forbidden',
            reason: `Target path "${filePath}" is outside approved workspace directories. Action strictly forbidden.`
          };
        }
        // Protect secret credentials and private key files
        if (this.isSensitiveFile(filePath)) {
          return {
            allowed: false,
            needsApproval: true,
            riskLevel: 'high',
            reason: `Sensitive credential file "${path.basename(filePath)}" requires explicit user approval to inspect.`
          };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'low' };
      }

      // File Writes inside approved directories - REQUIRED APPROVAL BY DEFAULT
      case 'write_file':
      case 'patch_file': {
        const filePath = this.normalizeFilePath(params);
        if (!filePath) {
          return { allowed: false, needsApproval: false, blocked: true, riskLevel: 'high', reason: 'Missing file path parameter' };
        }
        if (!this.isPathApproved(filePath)) {
          return {
            allowed: false,
            needsApproval: false,
            blocked: true,
            riskLevel: 'forbidden',
            reason: `Attempting to write file outside approved directories: "${filePath}". Action strictly forbidden.`
          };
        }
        // Check if covered by authorized user grant (Section 12)
        if (this.isActionCoveredByGrant('write_file', filePath) && !this.isSensitiveFile(filePath)) {
          return { allowed: true, needsApproval: false, riskLevel: 'medium', grantApplied: true };
        }

        // Default requireApprovalForFileWrite is true per Phase 10.5
        if (this.config.security?.requireApprovalForFileWrite !== false) {
          const isPatch = tool === 'patch_file';
          return {
            allowed: false,
            needsApproval: true,
            riskLevel: this.isSensitiveFile(filePath) ? 'high' : 'medium',
            reason: isPatch
              ? `Modifying content in: "${path.basename(filePath)}"`
              : `Writing or overwriting file: "${path.basename(filePath)}"`
          };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'medium' };
      }

      // High Risk: File deletion - REQUIRED APPROVAL BY DEFAULT
      case 'delete_file': {
        const filePath = this.normalizeFilePath(params);
        if (!filePath) {
          return { allowed: false, needsApproval: false, blocked: true, riskLevel: 'high', reason: 'Missing file path parameter' };
        }
        if (!this.isPathApproved(filePath)) {
          return {
            allowed: false,
            needsApproval: false,
            blocked: true,
            riskLevel: 'forbidden',
            reason: `Attempting to delete file outside approved directories: "${filePath}". Action strictly forbidden.`
          };
        }
        if (this.config.security?.requireApprovalForFileDelete !== false) {
          return {
            allowed: false,
            needsApproval: true,
            riskLevel: 'high',
            reason: `Attempting to delete file: "${path.basename(filePath)}"`
          };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'high' };
      }

      // High Risk: Terminal & Shell Command Execution
      case 'execute_command': {
        const cmd = (params.command || '').trim();
        if (!cmd) {
          return { allowed: false, needsApproval: false, blocked: true, riskLevel: 'high', reason: 'Command string is empty' };
        }

        if (params.cwd && !this.isPathApproved(params.cwd)) {
          return {
            allowed: false,
            needsApproval: false,
            blocked: true,
            riskLevel: 'forbidden',
            reason: `Command working directory "${params.cwd}" is outside approved workspace directories.`
          };
        }

        // Check for blocked malicious patterns
        const blockedPatterns = this.config.security?.blockedShellPatterns || [];
        for (const pattern of blockedPatterns) {
          try {
            if (new RegExp(pattern, 'i').test(cmd)) {
              return {
                allowed: false,
                needsApproval: false,
                blocked: true,
                riskLevel: 'forbidden',
                reason: `Command violates security policy (matched pattern: ${pattern})`
              };
            }
          } catch (e) {
            if (cmd.toLowerCase().includes(String(pattern).toLowerCase())) {
              return {
                allowed: false,
                needsApproval: false,
                blocked: true,
                riskLevel: 'forbidden',
                reason: `Command violates security policy (matched pattern: ${pattern})`
              };
            }
          }
        }

        // Check if covered by user grant (Section 12)
        if (this.isActionCoveredByGrant('execute_command', params.cwd || '.')) {
          return { allowed: true, needsApproval: false, riskLevel: 'medium', grantApplied: true };
        }

        // Shell executions require confirmation by default per Security Policy
        if (this.config.security?.requireApprovalForShell !== false) {
          return {
            allowed: false,
            needsApproval: true,
            riskLevel: 'high',
            reason: `Executing terminal command: \`${cmd}\``
          };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'high' };
      }

      // Website & Application Brokered Authentication (Section 10 & 11)
      case 'broker_authenticate': {
        const domain = params.targetDomain;
        if (domain && this.isDomainAuthorized(domain)) {
          return { allowed: true, needsApproval: false, riskLevel: 'low', domainAuthorized: true };
        }
        return {
          allowed: false,
          needsApproval: true,
          riskLevel: 'high',
          reason: `Authorize website sign-in to "${domain || 'target domain'}"`
        };
      }

      // Desktop App Launching
      case 'launch_application': {
        const app = (params.appName || '').toLowerCase();
        if (!this.approvedApplications.has(app)) {
          return {
            allowed: false,
            needsApproval: true,
            riskLevel: 'high',
            reason: `Application "${app}" is not in the pre-approved applications whitelist.`
          };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'medium' };
      }

      // Browser active clicks & forms (Section 9: Website and Browser Security)
      case 'browser_click': {
        const target = (params.target || '').toLowerCase();
        const sensitiveClickPatterns = [
          'submit', 'pay', 'purchase', 'buy', 'checkout', 'confirm order',
          'transfer', 'delete account', 'send message', 'post comment', 'withdraw'
        ];
        const isSensitiveClick = sensitiveClickPatterns.some(p => target.includes(p));
        const domain = params.domain || (params.url ? this.extractDomain(params.url) : null);

        if (isSensitiveClick && (!domain || !this.isDomainAuthorized(domain, 'write'))) {
          return {
            allowed: false,
            needsApproval: true,
            riskLevel: 'high',
            reason: `Clicking consequential action element ("${params.target}") requires explicit user authorization.`
          };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'low' };
      }

      case 'browser_fill': {
        const target = (params.target || '').toLowerCase();
        const isSensitiveForm = target.includes('password') || target.includes('credit') || target.includes('card') ||
                                target.includes('cvv') || target.includes('ssn') || target.includes('pin');
        const domain = params.domain || (params.url ? this.extractDomain(params.url) : null);

        if (isSensitiveForm && (!domain || !this.isDomainAuthorized(domain, 'write'))) {
          return {
            allowed: false,
            needsApproval: true,
            riskLevel: 'high',
            reason: `Entering sensitive input into form field ("${params.target}") requires explicit user authorization.`
          };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'low' };
      }

      case 'browser_navigate':
      case 'browser_open_tab': {
        const url = (params.url || '').toLowerCase();
        if (url.startsWith('javascript:') || url.startsWith('data:') || url.startsWith('vbscript:')) {
          return { allowed: false, needsApproval: false, blocked: true, riskLevel: 'forbidden', reason: 'Dangerous URL scheme blocked by security policy.' };
        }
        if (url.startsWith('chrome://') || url.startsWith('brave://') || url.startsWith('edge://')) {
          return { allowed: false, needsApproval: false, blocked: true, riskLevel: 'forbidden', reason: 'Browser management pages are strictly blocked.' };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'low' };
      }

      case 'browser_close_tab':
      case 'browser_switch_tab':
        return { allowed: true, needsApproval: false, riskLevel: 'low' };

      default:
        return { allowed: true, needsApproval: false, riskLevel: 'low' };
    }
  }

  // Request interactive approval from user
  createApprovalRequest(tool, params, riskAssessment) {
    const approvalId = `appr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const paramSnapshot = JSON.parse(JSON.stringify(params || {}));
    const paramHash = crypto.createHash('sha256').update(JSON.stringify(paramSnapshot)).digest('hex');

    let resolveFn, rejectFn;
    const promise = new Promise((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const timeoutMs = 180000; // 3 minutes TTL
    const expiresAt = Date.now() + timeoutMs;

    const timeout = setTimeout(() => {
      if (this.pendingApprovals.has(approvalId)) {
        this.pendingApprovals.delete(approvalId);
        rejectFn(new Error(`Approval request ${approvalId} timed out after 3 minutes.`));
      }
    }, timeoutMs);

    const record = {
      approvalId,
      tool,
      params: paramSnapshot,
      paramHash,
      riskLevel: riskAssessment.riskLevel,
      actionType: riskAssessment.reason || `Authorize ${tool}`,
      createdAt: new Date().toISOString(),
      expiresAt,
      resolve: (val) => { clearTimeout(timeout); resolveFn(val); },
      reject: (err) => { clearTimeout(timeout); rejectFn(err); }
    };

    this.pendingApprovals.set(approvalId, record);
    return { record, promise };
  }

  // Resolve pending approval from user's response in extension UI
  resolveApproval(approvalId, isApproved) {
    const record = this.pendingApprovals.get(approvalId);
    if (!record) {
      throw new Error(`Approval request ${approvalId} not found or expired.`);
    }

    // Immediately remove from pending map to prevent replay attacks
    this.pendingApprovals.delete(approvalId);

    // Enforce expiry
    if (Date.now() > record.expiresAt) {
      const expErr = new Error(`Approval request ${approvalId} has expired.`);
      record.reject(expErr);
      throw expErr;
    }

    if (isApproved) {
      record.resolve({ approved: true, paramHash: record.paramHash, tool: record.tool });
    } else {
      record.reject(new Error(`Action ${record.tool} was denied by the user.`));
    }
    return { resolved: true, approvalId, approved: isApproved, paramHash: record.paramHash };
  }

  // Reject all pending approvals (used during emergency stop)
  rejectAllPending(reason = 'Emergency stop invoked') {
    for (const [id, record] of this.pendingApprovals.entries()) {
      record.reject(new Error(reason));
    }
    this.pendingApprovals.clear();
  }
}

module.exports = PermissionManager;
