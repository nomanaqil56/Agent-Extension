// Antigravity Browser Agent - Background Service Worker (Manifest V3)
// Coordinates tabs, command shortcuts, local engine WebSocket bridge, and side panel

const DEFAULT_ENGINE_PORT = 3721;
let localEngineWs = null;
let isConnectedToEngine = false;
let authToken = '';

// Initialize extension settings & side panel behavior
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Antigravity Background] Extension installed.');
  
  // Enable sidepanel on action icon click
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // Set default stored configurations
  chrome.storage.local.get(['enginePort', 'authToken', 'selectedProvider'], (res) => {
    if (!res.enginePort) chrome.storage.local.set({ enginePort: DEFAULT_ENGINE_PORT });
    if (!res.selectedProvider) chrome.storage.local.set({ selectedProvider: 'hybrid' });
  });

  // Attempt initial connection to local engine
  connectToLocalEngine();
});

// Re-enable side panel behavior on startup
chrome.runtime.onStartup.addListener(async () => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
  connectToLocalEngine();
});

// --- Local Agent Engine WebSocket Bridge ---

function connectToLocalEngine() {
  chrome.storage.local.get(['enginePort', 'authToken'], (res) => {
    const port = res.enginePort || DEFAULT_ENGINE_PORT;
    const token = res.authToken || authToken || '';
    const wsUrl = `ws://127.0.0.1:${port}?token=${encodeURIComponent(token)}`;

    if (localEngineWs) {
      try {
        localEngineWs.close();
      } catch (e) {}
    }

    try {
      console.log(`[Antigravity] Connecting to Local Engine at ${wsUrl}...`);
      localEngineWs = new WebSocket(wsUrl);

      localEngineWs.onopen = () => {
        console.log('[Antigravity] Connected to Local Agent Engine!');
        isConnectedToEngine = true;
        broadcastToExtensionViews({
          type: 'ENGINE_STATUS',
          connected: true,
          port
        });

        // Register client as browser extension
        localEngineWs.send(JSON.stringify({
          type: 'CLIENT_REGISTER',
          role: 'browser_extension',
          version: '1.0.0',
          capabilities: ['dom_extract', 'click', 'fill', 'scroll', 'tabs', 'screenshot']
        }));
      };

      localEngineWs.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          handleEngineMessage(message);
        } catch (err) {
          console.error('[Antigravity] Failed to parse engine message:', err);
        }
      };

      localEngineWs.onclose = () => {
        if (isConnectedToEngine) {
          console.log('[Antigravity] Disconnected from Local Agent Engine. Retrying in 4s...');
        }
        isConnectedToEngine = false;
        broadcastToExtensionViews({
          type: 'ENGINE_STATUS',
          connected: false,
          port
        });
        setTimeout(connectToLocalEngine, 4000);
      };

      localEngineWs.onerror = () => {
        isConnectedToEngine = false;
      };
    } catch (err) {
      console.warn('[Antigravity] WS connection attempt failed:', err);
      isConnectedToEngine = false;
      setTimeout(connectToLocalEngine, 4000);
    }
  });
}

// Route incoming commands from Local Engine (e.g. click, scroll, tabs, DOM extract)
async function handleEngineMessage(msg) {
  // If the engine sends agent progress/stream to be rendered in UI
  if (['AGENT_THOUGHT', 'AGENT_MESSAGE', 'STREAM_CHUNK', 'TOOL_START', 'TOOL_FINISH', 'APPROVAL_REQUEST', 'TASK_COMPLETE'].includes(msg.type)) {
    broadcastToExtensionViews(msg);
    return;
  }

  // If the engine asks browser to perform an action
  if (msg.type === 'BROWSER_ACTION_REQUEST') {
    const { actionId, action, params } = msg;
    try {
      const result = await executeBrowserAction(action, params);
      sendEngineResponse(actionId, true, result);
    } catch (err) {
      console.error(`[Antigravity] Browser action "${action}" failed:`, err);
      sendEngineResponse(actionId, false, null, err.message || String(err));
    }
  }
}

function sendEngineResponse(actionId, success, result, error = null) {
  if (localEngineWs && localEngineWs.readyState === WebSocket.OPEN) {
    localEngineWs.send(JSON.stringify({
      type: 'BROWSER_ACTION_RESPONSE',
      actionId,
      success,
      result,
      error
    }));
  }
}

// Execute browser actions requested by Local Agent Engine or Sidepanel
async function executeBrowserAction(action, params = {}) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  switch (action) {
    case 'open_tab': {
      const newTab = await chrome.tabs.create({ url: params.url || 'https://google.com', active: params.active ?? true });
      return { tabId: newTab.id, url: newTab.url };
    }

    case 'close_tab': {
      const targetId = params.tabId || (activeTab ? activeTab.id : null);
      if (targetId) await chrome.tabs.remove(targetId);
      return { closedTabId: targetId };
    }

    case 'list_tabs': {
      const tabs = await chrome.tabs.query({});
      return tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active }));
    }

    case 'switch_tab': {
      if (!params.tabId) throw new Error('tabId required for switch_tab');
      const updated = await chrome.tabs.update(params.tabId, { active: true });
      return { activeTabId: updated.id, title: updated.title };
    }

    case 'navigate': {
      if (!params.url) throw new Error('URL required for navigate');
      let targetTabId = params.tabId || (activeTab ? activeTab.id : null);
      let targetUrl = params.url;
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
      }
      const updated = await chrome.tabs.update(targetTabId, { url: targetUrl });
      return { navigated: true, tabId: updated.id, url: targetUrl };
    }

    case 'capture_screenshot': {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      return { screenshot: dataUrl };
    }

    case 'distill_dom':
    case 'click_element':
    case 'fill_element':
    case 'scroll_page':
    case 'highlight_element':
    case 'clear_highlights':
    case 'label_interactive':
    case 'extract_text':
    case 'get_page_context': {
      if (!activeTab || !activeTab.id) {
        throw new Error('No active browser tab found to interact with.');
      }
      await ensureContentScript(activeTab.id);

      // Map action name to content script message
      const actionMap = {
        distill_dom: 'DISTILL_DOM',
        click_element: 'CLICK_ELEMENT',
        fill_element: 'FILL_ELEMENT',
        scroll_page: 'SCROLL_PAGE',
        highlight_element: 'HIGHLIGHT_ELEMENT',
        clear_highlights: 'CLEAR_HIGHLIGHTS',
        label_interactive: 'LABEL_INTERACTIVE',
        extract_text: 'EXTRACT_TEXT',
        get_page_context: 'GET_PAGE_CONTEXT'
      };

      const response = await chrome.tabs.sendMessage(activeTab.id, {
        action: actionMap[action],
        ...params
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Content script failed to execute action');
      }
      return response;
    }

    default:
      throw new Error(`Unsupported browser action: ${action}`);
  }
}

// Ensure content script is injected on page before messaging
async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
    if (res && res.status === 'ready') return;
  } catch (e) {
    // Inject if not responding
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content/content.css']
      });
    } catch (injectErr) {
      console.warn('[Antigravity] Could not inject content script:', injectErr);
    }
  }
}

// Broadcast message to side panel views
function broadcastToExtensionViews(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Expected when no extension view is open
  });
}

// Messages from Side Panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_ENGINE_STATUS') {
    sendResponse({ connected: isConnectedToEngine });
    return false;
  }

  if (request.action === 'RECONNECT_ENGINE') {
    connectToLocalEngine();
    sendResponse({ reconnecting: true });
    return false;
  }

  if (request.action === 'SEND_ENGINE_MESSAGE') {
    if (localEngineWs && localEngineWs.readyState === WebSocket.OPEN) {
      localEngineWs.send(JSON.stringify(request.payload));
      sendResponse({ sent: true });
    } else {
      sendResponse({ sent: false, error: 'Local Agent Engine is not connected.' });
    }
    return false;
  }

  if (request.action === 'DIRECT_BROWSER_ACTION') {
    executeBrowserAction(request.browserCommand, request.params)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true; // async
  }
});
