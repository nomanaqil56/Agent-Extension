// Antigravity Local Agent Engine - Permission & Access Control Manager

const path = require('path');
const fs = require('fs');

class PermissionManager {
  constructor(config = {}) {
    this.config = config;
    this.approvedDirectories = (config.approvedDirectories || [process.cwd()]).map(d => path.resolve(d));
    this.approvedApplications = new Set(config.approvedApplications || ['code', 'notepad', 'calc', 'git']);
    this.pendingApprovals = new Map();
    this.sessionAuthorizations = new Set();
  }

  // Add a user-approved folder scope
  addApprovedDirectory(dirPath) {
    const resolved = path.resolve(dirPath);
    if (!this.approvedDirectories.includes(resolved)) {
      this.approvedDirectories.push(resolved);
    }
  }

  // Validate if a path falls within approved directories
  isPathApproved(targetPath) {
    const resolved = path.resolve(targetPath);
    return this.approvedDirectories.some(approved => {
      const relative = path.relative(approved, resolved);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }

  // Analyze risk level for any requested tool action
  analyzeActionRisk(tool, params = {}) {
    switch (tool) {
      // Safe Browser Operations
      case 'browser_distill_dom':
      case 'browser_extract_text':
      case 'browser_get_page_context':
      case 'browser_list_tabs':
      case 'browser_screenshot':
      case 'get_system_info':
      case 'clipboard_read':
      case 'list_files':
      case 'read_file':
      case 'search_files':
      case 'file_info':
        // Path checks for file reads
        if (params.path && !this.isPathApproved(params.path)) {
          return {
            allowed: false,
            needsApproval: true,
            riskLevel: 'high',
            reason: `Path "${params.path}" is outside approved workspace directories.`
          };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'low' };

      // Medium Risk: File Writes inside whitelisted directories
      case 'write_file':
      case 'patch_file': {
        const filePath = params.path || params.targetFile;
        if (!filePath) {
          return { allowed: false, needsApproval: false, riskLevel: 'high', reason: 'Missing file path parameter' };
        }
        if (!this.isPathApproved(filePath)) {
          return {
            allowed: false,
            needsApproval: true,
            riskLevel: 'high',
            reason: `Attempting to write file outside approved directories: "${filePath}"`
          };
        }
        if (this.config.security?.requireApprovalForFileWrite) {
          return {
            allowed: false,
            needsApproval: true,
            riskLevel: 'medium',
            reason: `Modifying file: "${path.basename(filePath)}"`
          };
        }
        return { allowed: true, needsApproval: false, riskLevel: 'medium' };
      }

      // High Risk: File deletion
      case 'delete_file': {
        return {
          allowed: false,
          needsApproval: true,
          riskLevel: 'high',
          reason: `Attempting to delete file: "${params.path}"`
        };
      }

      // High Risk: Terminal & Shell Command Execution
      case 'execute_command': {
        const cmd = (params.command || '').trim();
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

        // Shell executions require confirmation if configured
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
