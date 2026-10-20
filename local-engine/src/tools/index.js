// Antigravity Local Agent Engine - Central Tool Registry & Dispatcher

const FilesTool = require('./files');
const TerminalTool = require('./terminal');
const DesktopTool = require('./desktop');
const BrowserTool = require('./browser');

class ToolRegistry {
  constructor(permissionManager, auditLogger, emergencyCoordinator, serverContext) {
    this.permissionManager = permissionManager;
    this.auditLogger = auditLogger;
    this.emergencyCoordinator = emergencyCoordinator;
    this.serverContext = serverContext;

    this.filesTool = new FilesTool(permissionManager);
    this.terminalTool = new TerminalTool(permissionManager, emergencyCoordinator);
    this.desktopTool = new DesktopTool(permissionManager);
    this.browserTool = new BrowserTool(serverContext);

    this.registerAllTools();
  }

  registerAllTools() {
    this.tools = new Map();

    // 1. Filesystem Tools
    this.addTool('list_files', 'List files and directories in an approved path', {
      type: 'object',
      properties: {
        dirPath: { type: 'string', description: 'Relative or absolute directory path' },
        recursive: { type: 'boolean', description: 'Whether to list subdirectories recursively' },
        maxDepth: { type: 'number', description: 'Maximum depth for recursion' }
      }
    }, (p) => this.filesTool.listFiles(p));

    this.addTool('read_file', 'Read content of a file in an approved directory', {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to file to read' },
        maxLines: { type: 'number', description: 'Maximum lines to return' },
        offset: { type: 'number', description: 'Starting line number' }
      },
      required: ['filePath']
    }, (p) => this.filesTool.readFile(p));

    this.addTool('write_file', 'Write or overwrite content to a file in an approved directory', {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Target file path' },
        content: { type: 'string', description: 'Text content to write' }
      },
      required: ['filePath', 'content']
    }, (p) => this.filesTool.writeFile(p));

    this.addTool('patch_file', 'Replace a specific block of text in a file with new content', {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Target file path' },
        targetContent: { type: 'string', description: 'Exact string to be replaced' },
        replacementContent: { type: 'string', description: 'Replacement string' }
      },
      required: ['filePath', 'targetContent', 'replacementContent']
    }, (p) => this.filesTool.patchFile(p));

    this.addTool('search_files', 'Search for text query across files in approved directories (grep)', {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search string or regex' },
        dirPath: { type: 'string', description: 'Directory to search within' },
        filePattern: { type: 'string', description: 'Optional filename filter' }
      },
      required: ['query']
    }, (p) => this.filesTool.searchFiles(p));

    this.addTool('file_info', 'Get file or directory metadata and stats', {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to inspect' }
      },
      required: ['filePath']
    }, (p) => this.filesTool.fileInfo(p));

    this.addTool('delete_file', 'Delete a file within an approved directory (requires approval)', {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to file to delete' }
      },
      required: ['filePath']
    }, (p) => this.filesTool.deleteFile(p));

    // 2. Terminal & Developer Tools
    this.addTool('execute_command', 'Execute a command in PowerShell/Terminal within an approved directory', {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command line string to execute' },
        cwd: { type: 'string', description: 'Working directory path' },
        timeoutMs: { type: 'number', description: 'Timeout in milliseconds' }
      },
      required: ['command']
    }, (p, abortSignal) => this.terminalTool.executeCommand(p, abortSignal));

    // 3. Desktop Tools
    this.addTool('launch_application', 'Launch a pre-approved desktop application (e.g. code, calc, notepad, git)', {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Name of approved executable' },
        args: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments' }
      },
      required: ['appName']
    }, (p) => this.desktopTool.launchApplication(p));

    this.addTool('get_system_info', 'Get host system telemetry, CPU, memory, platform, uptime', {
      type: 'object',
      properties: {}
    }, () => this.desktopTool.getSystemInfo());

    this.addTool('clipboard_read', 'Read text from system clipboard', {
      type: 'object',
      properties: {}
    }, () => this.desktopTool.clipboardRead());

    this.addTool('clipboard_write', 'Write text to system clipboard', {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to copy to clipboard' }
      },
      required: ['text']
    }, (p) => this.desktopTool.clipboardWrite(p));

    // 4. Browser Automation Tools
    this.addTool('browser_open_tab', 'Open a new browser tab with specified URL', {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open' },
        active: { type: 'boolean', description: 'Focus newly opened tab' }
      },
      required: ['url']
    }, (p) => this.browserTool.openTab(p));

    this.addTool('browser_close_tab', 'Close a browser tab by ID or current active tab', {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID to close' }
      }
    }, (p) => this.browserTool.closeTab(p));

    this.addTool('browser_switch_tab', 'Switch active browser tab to specified tab ID', {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID to switch to' }
      },
      required: ['tabId']
    }, (p) => this.browserTool.switchTab(p));

    this.addTool('browser_list_tabs', 'List all open browser tabs in the window', {
      type: 'object',
      properties: {}
    }, () => this.browserTool.listTabs());

    this.addTool('browser_navigate', 'Navigate active browser tab to a new URL', {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target destination URL' }
      },
      required: ['url']
    }, (p) => this.browserTool.navigate(p));

    this.addTool('browser_click', 'Click an element on the active webpage by CSS selector, text, or index', {
      type: 'object',
      properties: {
        target: { description: 'CSS selector, visible text, or element index ID' }
      },
      required: ['target']
    }, (p) => this.browserTool.clickElement(p));

    this.addTool('browser_fill', 'Type text into an input field or textarea on the active webpage', {
      type: 'object',
      properties: {
        target: { description: 'CSS selector or text identifying input' },
        value: { type: 'string', description: 'Text to type into input' },
        pressEnter: { type: 'boolean', description: 'Press Enter key after filling' }
      },
      required: ['target', 'value']
    }, (p) => this.browserTool.fillElement(p));

    this.addTool('browser_scroll', 'Scroll the active webpage up, down, top, bottom, or to element', {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] },
        amount: { type: 'number', description: 'Pixel amount to scroll' },
        target: { description: 'Optional element selector to scroll to' }
      }
    }, (p) => this.browserTool.scrollPage(p));

    this.addTool('browser_distill_dom', 'Extract a clean semantic list of all interactive buttons, links, and forms on the page', {
      type: 'object',
      properties: {
        maxElements: { type: 'number', description: 'Max elements to extract' }
      }
    }, (p) => this.browserTool.distillDom(p));

    this.addTool('browser_extract_text', 'Extract clean structured text and content from the active webpage', {
      type: 'object',
      properties: {}
    }, () => this.browserTool.extractText());

    this.addTool('browser_screenshot', 'Capture visible screenshot of active webpage', {
      type: 'object',
      properties: {}
    }, () => this.browserTool.captureScreenshot());
  }

  addTool(name, description, parameters, handler) {
    this.tools.set(name, {
      name,
      description,
      parameters,
      handler
    });
  }

  getToolDefinitions() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
  }

  // Execute tool with security permission check & audit logging
  async execute(toolName, params = {}, onApprovalNeeded = null, abortSignal = null) {
    if (abortSignal?.aborted || (this.emergencyCoordinator && this.emergencyCoordinator.isEmergencyHalted())) {
      throw new Error('Action cancelled: Emergency Stop is active or task was aborted.');
    }

    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool not found: "${toolName}"`);
    }

    const startTime = Date.now();

    // 1. Check Security Risk & Permissions
    const risk = this.permissionManager.analyzeActionRisk(toolName, params);

    if (risk.blocked) {
      this.auditLogger.log({
        action: 'TOOL_EXECUTION',
        tool: toolName,
        status: 'BLOCKED',
        riskLevel: risk.riskLevel,
        params,
        error: risk.reason
      });
      throw new Error(`Action blocked by security policy: ${risk.reason}`);
    }

    if (risk.needsApproval) {
      if (!onApprovalNeeded) {
        throw new Error(`Action "${toolName}" requires user approval: ${risk.reason}`);
      }

      // Create interactive approval request
      const { record, promise } = this.permissionManager.createApprovalRequest(toolName, params, risk);

      onApprovalNeeded({
        approvalId: record.approvalId,
        tool: toolName,
        riskLevel: risk.riskLevel,
        actionType: risk.reason,
        details: params
      });

      // Handle abort while waiting for approval
      let abortHandler;
      const abortPromise = new Promise((_, reject) => {
        if (abortSignal?.aborted) {
          reject(new Error('Action cancelled by user abort or Emergency Stop.'));
        } else if (abortSignal) {
          abortHandler = () => reject(new Error('Action cancelled by user abort or Emergency Stop.'));
          abortSignal.addEventListener('abort', abortHandler, { once: true });
        }
      });

      try {
        await Promise.race([promise, abortPromise]);
      } finally {
        if (abortSignal && abortHandler) {
          abortSignal.removeEventListener('abort', abortHandler);
        }
      }
    }

    if (abortSignal?.aborted || (this.emergencyCoordinator && this.emergencyCoordinator.isEmergencyHalted())) {
      throw new Error('Action cancelled: Emergency Stop is active or task was aborted.');
    }

    // 2. Execute tool
    this.auditLogger.log({
      action: 'TOOL_EXECUTION',
      tool: toolName,
      status: 'STARTED',
      riskLevel: risk.riskLevel,
      params
    });

    try {
      const result = await tool.handler(params, abortSignal);
      const durationMs = Date.now() - startTime;

      this.auditLogger.log({
        action: 'TOOL_EXECUTION',
        tool: toolName,
        status: 'COMPLETED',
        riskLevel: risk.riskLevel,
        params,
        result,
        durationMs
      });

      return { success: true, result, durationMs };
    } catch (err) {
      const durationMs = Date.now() - startTime;

      this.auditLogger.log({
        action: 'TOOL_EXECUTION',
        tool: toolName,
        status: 'FAILED',
        riskLevel: risk.riskLevel,
        params,
        error: err.message || String(err),
        durationMs
      });

      throw err;
    }
  }
}

module.exports = ToolRegistry;
