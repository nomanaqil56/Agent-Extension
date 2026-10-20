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

  // Canonicalize a path and resolve symlinks defensively
  canonicalizePath(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') return null;
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

    const canonicalTarget = this.canonicalizePath(targetPath);
    if (!canonicalTarget) return false;

    const isWindows = process.platform === 'win32';
    const normTarget = isWindows ? canonicalTarget.toLowerCase() : canonicalTarget;

    return this.approvedDirectories.some(approved => {
      const canonicalApproved = this.canonicalizePath(approved) || approved;
      const normApproved = isWindows ? canonicalApproved.toLowerCase() : canonicalApproved;

      const relative = path.relative(normApproved, normTarget);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }

  // Analyze risk level for any requested tool action
  analyzeActionRisk(tool, params = {}) {
    // If tool accesses local filesystem or workspace, enforce that at least one workspace is configured
    const workspaceTools = [
      'list_files', 'search_files', 'read_file', 'file_info',
      'write_file', 'patch_file', 'delete_file', 'execute_command'
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
        return { allowed: true, needsApproval: false, riskLevel: 'low' };

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
          if (new RegExp(pattern, 'i').test(cmd)) {
            return {
              allowed: false,
              needsApproval: false,
              blocked: true,
              riskLevel: 'forbidden',
              reason: `Command violates security policy (matched pattern: ${pattern})`
            };
          }
        }

        // Check if command is already session-authorized
        if (this.sessionAuthorizations.has(`cmd:${cmd}`)) {
          return { allowed: true, needsApproval: false, riskLevel: 'medium' };
        }

        // Shell executions require confirmation by default
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

      // Browser active clicks & forms
      case 'browser_click':
      case 'browser_fill':
      case 'browser_navigate':
      case 'browser_open_tab':
      case 'browser_close_tab':
      case 'browser_switch_tab':
        return { allowed: true, needsApproval: false, riskLevel: 'low' };

      default:
        return { allowed: true, needsApproval: false, riskLevel: 'low' };
    }
  }

  // Request interactive approval from user
  createApprovalRequest(tool, params, riskAssessment) {
    const approvalId = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let resolveFn, rejectFn;
    const promise = new Promise((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const timeout = setTimeout(() => {
      if (this.pendingApprovals.has(approvalId)) {
        this.pendingApprovals.delete(approvalId);
        rejectFn(new Error(`Approval request ${approvalId} timed out after 3 minutes.`));
      }
    }, 180000);

    const record = {
      approvalId,
      tool,
      params,
      riskLevel: riskAssessment.riskLevel,
      actionType: riskAssessment.reason || `Authorize ${tool}`,
      createdAt: new Date().toISOString(),
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

    this.pendingApprovals.delete(approvalId);
    if (isApproved) {
      record.resolve({ approved: true });
    } else {
      record.reject(new Error(`Action ${record.tool} was denied by the user.`));
    }
    return { resolved: true, approvalId, approved: isApproved };
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
