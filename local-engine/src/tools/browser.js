// Antigravity Local Agent Engine - Browser Automation Bridge Tool
// Communicates over WebSocket to the connected Brave/Chrome extension

class BrowserTool {
  constructor(serverContext) {
    this.serverContext = serverContext;
    this.pendingBrowserActions = new Map();
  }

  // Receive response from extension WebSocket client
  handleActionResponse(responseMsg) {
    const { actionId, success, result, error } = responseMsg;
    const pending = this.pendingBrowserActions.get(actionId);
    if (!pending) return;

    this.pendingBrowserActions.delete(actionId);
    if (success) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(error || 'Browser action failed'));
    }
  }

  // Dispatch action to connected extension
  async execute(actionName, params = {}) {
    const extensionClient = this.serverContext.getExtensionClient();
    if (!extensionClient || extensionClient.readyState !== 1) { // 1 = OPEN
      throw new Error('Browser Extension is not connected to Local Engine. Please open the Antigravity side panel in Brave/Chrome.');
    }

    const actionId = `bact_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingBrowserActions.has(actionId)) {
          this.pendingBrowserActions.delete(actionId);
          reject(new Error(`Browser action "${actionName}" timed out after 30 seconds.`));
        }
      }, 30000);

      this.pendingBrowserActions.set(actionId, {
        actionName,
        resolve: (val) => { clearTimeout(timeout); resolve(val); },
        reject: (err) => { clearTimeout(timeout); reject(err); }
      });

      // Map tool name to extension action
      const cleanAction = actionName.replace(/^browser_/, '');

      extensionClient.send(JSON.stringify({
        type: 'BROWSER_ACTION_REQUEST',
        actionId,
        action: cleanAction,
        params
      }));
    });
  }

  // Individual convenience methods
  async openTab({ url, active = true }) {
    return this.execute('open_tab', { url, active });
  }

  async closeTab({ tabId }) {
    return this.execute('close_tab', { tabId });
  }

  async switchTab({ tabId }) {
    return this.execute('switch_tab', { tabId });
  }

  async listTabs() {
    return this.execute('list_tabs', {});
  }

  async navigate({ url, tabId = null }) {
    return this.execute('navigate', { url, tabId });
  }

  async clickElement({ target, options = {} }) {
    return this.execute('click_element', { target, options });
  }

  async fillElement({ target, value, pressEnter = false }) {
    return this.execute('fill_element', { target, value, options: { pressEnter } });
  }

  async scrollPage({ direction = 'down', amount = 500, target = null }) {
    return this.execute('scroll_page', { direction, amount, target });
  }

  async distillDom({ maxElements = 60 }) {
    return this.execute('distill_dom', { maxElements });
  }

  async extractText() {
    return this.execute('extract_text', {});
  }

  async captureScreenshot() {
    return this.execute('capture_screenshot', {});
  }

  async highlightElement({ target, label = 'AGENT' }) {
    return this.execute('highlight_element', { target, label });
  }
}

module.exports = BrowserTool;
