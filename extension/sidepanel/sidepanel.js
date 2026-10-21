// Antigravity Browser Agent - Side Panel Controller
// Exact 1:1 replica of Google Antigravity IDE Agent Canvas
// Manages chat streaming, reasoning disclosure, tool step visualization, slash commands, @ mentions, approvals, audit logs, and settings

// Graceful Chrome API Shim for visual testing & standalone browser previews
if (typeof window !== 'undefined' && (!window.chrome || !window.chrome.runtime || !window.chrome.storage)) {
  const mockStorage = window.__ACTIVE_CONV_TEST__ || {
    conversations: {
      'conv_default': {
        id: 'conv_default',
        title: 'Persimmon Website Creation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date(Date.now() - 7200000).toISOString(),
        messages: []
      }
    },
    activeConversationId: 'conv_default',
    approvedWorkspaces: ['D:\\Coding\\Projects\\persimmon_website'],
    selectedProvider: 'gemini'
  };
  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || {
    sendMessage: (msg, cb) => {
      if (cb) cb({ connected: true, workspaces: mockStorage.approvedWorkspaces });
      return Promise.resolve({ connected: true });
    },
    onMessage: { addListener: () => {} }
  };
  window.chrome.storage = window.chrome.storage || {
    local: {
      get: (keys, cb) => {
        const res = {};
        const kList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        kList.forEach(k => { res[k] = mockStorage[k]; });
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      set: (obj, cb) => {
        Object.assign(mockStorage, obj);
        if (cb) cb();
        return Promise.resolve();
      }
    }
  };
  window.chrome.tabs = window.chrome.tabs || {
    query: () => Promise.resolve([{ id: 1, title: 'persimmon_website — script.js', url: 'http://localhost:3000' }]),
    sendMessage: () => Promise.resolve({ success: true }),
    onActivated: { addListener: () => {} }
  };
}

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Shell & Header
  const conversationSelect = document.getElementById('conversation-select');
  const modelSelect = document.getElementById('model-select');
  const btnNewChat = document.getElementById('btn-new-chat');
  const btnToggleHistory = document.getElementById('btn-toggle-history');
  const btnToggleMoreMenu = document.getElementById('btn-toggle-more-menu');
  const moreMenuDropdown = document.getElementById('more-menu-dropdown');
  const moreMenuBadge = document.getElementById('more-menu-badge');
  const emergencyStopBtn = document.getElementById('emergency-stop-btn');
  const headerTitleText = document.getElementById('header-title-text');
  const btnPanelClose = document.getElementById('btn-panel-close');
  const menuItemEmergencyStop = document.getElementById('menu-item-emergency-stop');

  // Engine Status in Dropdown
  const engineStatusPill = document.getElementById('engine-status-pill');
  const engineStatusText = document.getElementById('engine-status-text');
  const engineStatusDot = document.getElementById('engine-status-dot');

  // More Menu Actions
  const menuItemApprovals = document.getElementById('menu-item-approvals');
  const menuItemAudit = document.getElementById('menu-item-audit');
  const menuItemSettings = document.getElementById('menu-item-settings');
  const menuItemClear = document.getElementById('menu-item-clear');

  // Composer Bottom Controls & Popovers
  const btnComposerAddContext = document.getElementById('btn-composer-add-context');
  const addContextMenu = document.getElementById('add-context-menu');
  const ctxItemPage = document.getElementById('ctx-item-page');
  const ctxItemDom = document.getElementById('ctx-item-dom');
  const ctxItemScreenshot = document.getElementById('ctx-item-screenshot');
  const btnComposerMode = document.getElementById('btn-composer-mode');
  const modeDropdownMenu = document.getElementById('mode-dropdown-menu');
  const activeModeLabel = document.getElementById('active-mode-label');
  const activeModelLabel = document.getElementById('active-model-label');
  const mainCanvas = document.getElementById('main-canvas');
  const workspaceTitleDisplay = document.getElementById('workspace-title-display');
  const recentTaskRow = document.getElementById('recent-task-row');
  const recentTaskTitle = document.getElementById('recent-task-title');
  const recentTaskTime = document.getElementById('recent-task-time');
  const footerDisclaimer = document.getElementById('footer-disclaimer');
  const aboveComposerBar = document.getElementById('above-composer-bar');
  const aboveFileChips = document.getElementById('above-file-chips');
  const btnReviewChanges = document.getElementById('btn-review-changes');

  function syncActiveModelLabel() {
    if (activeModelLabel && modelSelect) {
      const opt = modelSelect.options[modelSelect.selectedIndex];
      activeModelLabel.textContent = opt ? opt.text : modelSelect.value;
    }
  }

  // Drawers & Backdrop
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const drawerHistory = document.getElementById('drawer-history');
  const drawerApprovals = document.getElementById('drawer-approvals');
  const drawerAudit = document.getElementById('drawer-audit');
  const drawerSettings = document.getElementById('drawer-settings');
  const drawerHistoryList = document.getElementById('drawer-history-list');
  const btnDrawerNewChat = document.getElementById('btn-drawer-new-chat');
  const closeDrawerBtns = document.querySelectorAll('.agy-close-drawer-btn');

  // Chat Elements
  const chatMessages = document.getElementById('chat-messages');
  const welcomeCard = document.getElementById('welcome-card');
  const userInput = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const voiceBtn = document.getElementById('voice-btn');
  const voiceStateHint = document.getElementById('voice-state-hint');
  const agentStatusPill = document.getElementById('agent-active-status');
  const agentStatusLabel = document.getElementById('agent-status-label');
  const inlineStopBtn = document.getElementById('inline-stop-btn');

  // Context & Attachment Elements
  const checkIncludePage = document.getElementById('check-include-page');
  const checkIncludeDom = document.getElementById('check-include-dom');
  const chipIncludePage = document.getElementById('chip-include-page');
  const chipIncludeDom = document.getElementById('chip-include-dom');
  const pageTitleText = document.getElementById('page-title-text');
  const btnSnapScreenshot = document.getElementById('btn-snap-screenshot');
  const screenshotPreviewTag = document.getElementById('screenshot-preview-tag');
  const screenshotThumbImg = document.getElementById('screenshot-thumb-img');
  const btnRemoveScreenshot = document.getElementById('btn-remove-screenshot');

  // Autocomplete Menus
  const slashCommandMenu = document.getElementById('slash-command-menu');
  const atMentionMenu = document.getElementById('at-mention-menu');
  const btnTriggerMention = document.getElementById('btn-trigger-mention');

  // Approvals & Audit Elements
  const approvalsCountBadge = document.getElementById('approvals-count-badge');
  const approvalsList = document.getElementById('approvals-list');
  const auditList = document.getElementById('audit-list');
  const refreshAuditBtn = document.getElementById('refresh-audit-btn');
  const clearAuditBtn = document.getElementById('clear-audit-btn');

  // Settings Elements
  const settingEngineUrl = document.getElementById('setting-engine-url');
  const settingAuthToken = document.getElementById('setting-auth-token');
  const settingPairingCode = document.getElementById('setting-pairing-code');
  const btnPairEngine = document.getElementById('btn-pair-engine');
  const pairingHint = document.getElementById('pairing-hint');
  const settingProvider = document.getElementById('setting-provider');
  const settingRoutingPolicy = document.getElementById('setting-routing-policy');
  const settingGeminiKey = document.getElementById('setting-gemini-key');
  const settingAnthropicKey = document.getElementById('setting-anthropic-key');
  const settingOpenAiKey = document.getElementById('setting-openai-key');
  const settingOllamaUrl = document.getElementById('setting-ollama-url');
  const settingAudioFeedback = document.getElementById('setting-audio-feedback');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const settingsSavedHint = document.getElementById('settings-saved-hint');
  const workspacesList = document.getElementById('workspaces-list');
  const inputNewWorkspace = document.getElementById('input-new-workspace');
  const btnAddWorkspace = document.getElementById('btn-add-workspace');
  const providerHealthBadge = document.getElementById('provider-health-badge');

  // State
  let isConnected = false;
  let isProcessing = false;
  let attachedScreenshot = null;
  let pendingApprovals = new Map();
  let speechRecognition = null;
  let isListeningVoice = false;
  let currentStreamingBubble = null;

  // Conversations State
  let conversations = {};
  let activeConversationId = null;

  // --- 1. Initialization & Active Tab Context ---

  loadSettings();
  loadConversations();
  refreshActiveTabContext();
  checkEngineStatus();

  // Poll engine status periodically
  setInterval(checkEngineStatus, 3000);

  // Reconnect button
  if (engineStatusPill) {
    engineStatusPill.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'RECONNECT_ENGINE' });
      engineStatusText.textContent = 'CONNECTING...';
    });
  }

  // Emergency Stop Buttons
  emergencyStopBtn.addEventListener('click', triggerEmergencyStop);
  if (inlineStopBtn) {
    inlineStopBtn.addEventListener('click', triggerEmergencyStop);
  }

  // Model switch synchronizes with settings
  modelSelect.addEventListener('change', () => {
    syncActiveModelLabel();
    chrome.storage.local.set({ selectedProvider: modelSelect.value });
    if (settingProvider) settingProvider.value = modelSelect.value;
    appendSystemNotice(`Active model switched to: ${modelSelect.options[modelSelect.selectedIndex].text}`);
    recordMessage({ type: 'system', content: `Switched provider to ${modelSelect.value}` });
  });

  // Context checkbox pills toggle styling
  if (checkIncludePage && chipIncludePage) {
    checkIncludePage.addEventListener('change', () => {
      chipIncludePage.classList.toggle('active', checkIncludePage.checked);
    });
  }
  if (checkIncludeDom && chipIncludeDom) {
    checkIncludeDom.addEventListener('change', () => {
      chipIncludeDom.classList.toggle('active', checkIncludeDom.checked);
    });
  }

  // Update Send Button active/disabled state based on input
  function updateSendBtnState() {
    if (isProcessing) return;
    const hasContent = userInput.value.trim().length > 0 || !!attachedScreenshot;
    sendBtn.classList.toggle('active', hasContent);
    if (hasContent) {
      sendBtn.removeAttribute('disabled');
    } else {
      sendBtn.setAttribute('disabled', 'true');
    }
  }

  // Auto-resize input textarea
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
    updateSendBtnState();
    handleAutocompleteInput();
  });

  // --- 2. Dropdown Menus, Popovers & Drawer Management ---

  function hideAllComposerPopovers() {
    if (addContextMenu) addContextMenu.style.display = 'none';
    if (modeDropdownMenu) modeDropdownMenu.style.display = 'none';
    hideAutocompleteMenus();
  }

  // Toggle Context Popover (+)
  if (btnComposerAddContext && addContextMenu) {
    btnComposerAddContext.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = addContextMenu.style.display !== 'none';
      hideAllComposerPopovers();
      addContextMenu.style.display = isVisible ? 'none' : 'flex';
    });
  }

  // Context Menu Items
  if (ctxItemPage) {
    ctxItemPage.addEventListener('click', () => {
      if (checkIncludePage) {
        checkIncludePage.checked = !checkIncludePage.checked;
        chipIncludePage.classList.toggle('active', checkIncludePage.checked);
      }
      hideAllComposerPopovers();
    });
  }

  if (ctxItemDom) {
    ctxItemDom.addEventListener('click', () => {
      if (checkIncludeDom) {
        checkIncludeDom.checked = !checkIncludeDom.checked;
        chipIncludeDom.classList.toggle('active', checkIncludeDom.checked);
      }
      hideAllComposerPopovers();
    });
  }

  if (ctxItemScreenshot) {
    ctxItemScreenshot.addEventListener('click', () => {
      hideAllComposerPopovers();
      if (btnSnapScreenshot) btnSnapScreenshot.click();
    });
  }

  // Toggle Agent Mode Popover (Planning / Normal / Fast)
  if (btnComposerMode && modeDropdownMenu) {
    btnComposerMode.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = modeDropdownMenu.style.display !== 'none';
      hideAllComposerPopovers();
      modeDropdownMenu.style.display = isVisible ? 'none' : 'flex';
    });

    modeDropdownMenu.querySelectorAll('.agy-mode-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const mode = item.getAttribute('data-mode');
        if (activeModeLabel) activeModeLabel.textContent = mode;
        modeDropdownMenu.querySelectorAll('.agy-mode-menu-item').forEach(i => {
          i.classList.remove('active');
          const check = i.querySelector('.agy-check-icon');
          if (check) check.style.visibility = 'hidden';
        });
        item.classList.add('active');
        const check = item.querySelector('.agy-check-icon');
        if (check) check.style.visibility = 'visible';
        modeDropdownMenu.style.display = 'none';
        chrome.storage.local.set({ agentMode: mode });
        appendSystemNotice(`Agent mode switched to: ${mode}`);
      });
    });
  }

  // Close / Reset Session Button (✕)
  if (btnPanelClose) {
    btnPanelClose.addEventListener('click', () => {
      createNewConversation();
    });
  }

  // Review Changes Button
  if (btnReviewChanges) {
    btnReviewChanges.addEventListener('click', () => {
      openDrawer(drawerApprovals);
    });
  }

  // Emergency Stop in More Menu
  if (menuItemEmergencyStop) {
    menuItemEmergencyStop.addEventListener('click', () => {
      moreMenuDropdown.style.display = 'none';
      triggerEmergencyStop();
    });
  }

  // Toggle More Menu (...)
  btnToggleMoreMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAllComposerPopovers();
    const isVisible = moreMenuDropdown.style.display !== 'none';
    moreMenuDropdown.style.display = isVisible ? 'none' : 'block';
  });

  document.addEventListener('click', (e) => {
    if (!moreMenuDropdown.contains(e.target) && e.target !== btnToggleMoreMenu) {
      moreMenuDropdown.style.display = 'none';
    }
    if (addContextMenu && !addContextMenu.contains(e.target) && e.target !== btnComposerAddContext) {
      addContextMenu.style.display = 'none';
    }
    if (modeDropdownMenu && !modeDropdownMenu.contains(e.target) && !btnComposerMode.contains(e.target)) {
      modeDropdownMenu.style.display = 'none';
    }
    if (slashCommandMenu && !slashCommandMenu.contains(e.target)) {
      slashCommandMenu.style.display = 'none';
    }
    if (atMentionMenu && !atMentionMenu.contains(e.target) && e.target !== btnTriggerMention) {
      atMentionMenu.style.display = 'none';
    }
  });

  // Open Drawers
  function openDrawer(drawerEl) {
    closeAllDrawers();
    drawerBackdrop.style.display = 'block';
    drawerEl.style.display = 'flex';
    moreMenuDropdown.style.display = 'none';
  }

  function closeAllDrawers() {
    drawerBackdrop.style.display = 'none';
    if (drawerHistory) drawerHistory.style.display = 'none';
    if (drawerApprovals) drawerApprovals.style.display = 'none';
    if (drawerAudit) drawerAudit.style.display = 'none';
    if (drawerSettings) drawerSettings.style.display = 'none';
  }

  drawerBackdrop.addEventListener('click', closeAllDrawers);

  closeDrawerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const drawerId = btn.getAttribute('data-close');
      const drawer = document.getElementById(drawerId);
      if (drawer) drawer.style.display = 'none';
      drawerBackdrop.style.display = 'none';
    });
  });

  // History Drawer
  btnToggleHistory.addEventListener('click', () => {
    renderHistoryDrawer();
    openDrawer(drawerHistory);
  });

  if (btnDrawerNewChat) {
    btnDrawerNewChat.addEventListener('click', () => {
      createNewConversation();
      closeAllDrawers();
    });
  }

  // Menu items click
  menuItemApprovals.addEventListener('click', () => {
    openDrawer(drawerApprovals);
  });

  menuItemAudit.addEventListener('click', () => {
    fetchAuditEntries();
    openDrawer(drawerAudit);
  });

  menuItemSettings.addEventListener('click', () => {
    loadWorkspaces();
    checkProviderHealth();
    openDrawer(drawerSettings);
  });

  menuItemClear.addEventListener('click', () => {
    moreMenuDropdown.style.display = 'none';
    if (!activeConversationId || !conversations[activeConversationId]) return;
    conversations[activeConversationId].messages = [];
    conversations[activeConversationId].updatedAt = new Date().toISOString();
    saveConversations();
    renderActiveConversation();
  });

  // --- 3. Persistent Conversation History ---

  function loadConversations() {
    chrome.storage.local.get(['conversations', 'activeConversationId'], (res) => {
      conversations = res.conversations || {};
      activeConversationId = res.activeConversationId || null;

      // Ensure at least one conversation exists
      if (!activeConversationId || !conversations[activeConversationId]) {
        const initialId = `conv_${Date.now()}`;
        conversations[initialId] = {
          id: initialId,
          title: 'New conversation',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: []
        };
        activeConversationId = initialId;
        saveConversations();
      }

      updateConversationDropdown();
      renderActiveConversation();
    });
  }

  function saveConversations() {
    chrome.storage.local.set({
      conversations,
      activeConversationId
    });
  }

  function createNewConversation() {
    const newId = `conv_${Date.now()}`;
    const count = Object.keys(conversations).length + 1;
    conversations[newId] = {
      id: newId,
      title: `Task #${count}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };
    activeConversationId = newId;
    saveConversations();
    updateConversationDropdown();
    renderActiveConversation();
  }

  function updateConversationDropdown() {
    conversationSelect.innerHTML = '';
    const sorted = Object.values(conversations).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    sorted.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.title || 'Untitled Session';
      if (c.id === activeConversationId) opt.selected = true;
      conversationSelect.appendChild(opt);
    });

    const activeConv = conversations[activeConversationId];
    if (headerTitleText) {
      if (activeConv && activeConv.messages && activeConv.messages.length > 0) {
        headerTitleText.textContent = activeConv.title || 'Agent';
      } else {
        headerTitleText.textContent = 'Agent';
      }
    }
  }

  function renderHistoryDrawer() {
    drawerHistoryList.innerHTML = '';
    const sorted = Object.values(conversations).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    sorted.forEach(c => {
      const item = document.createElement('div');
      item.className = `agy-history-item ${c.id === activeConversationId ? 'active' : ''}`;
      const time = new Date(c.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `
        <div style="overflow:hidden;">
          <div class="agy-history-title">${escapeHtml(c.title || 'Untitled')}</div>
          <div class="agy-history-meta">${time} · ${c.messages?.length || 0} msgs</div>
        </div>
        <button class="agy-action-icon-btn" style="color:var(--status-red);" title="Delete Session">&times;</button>
      `;

      item.querySelector('div').addEventListener('click', () => {
        activeConversationId = c.id;
        saveConversations();
        updateConversationDropdown();
        renderActiveConversation();
        closeAllDrawers();
      });

      item.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        delete conversations[c.id];
        if (activeConversationId === c.id) {
          const remaining = Object.keys(conversations);
          activeConversationId = remaining.length > 0 ? remaining[0] : null;
        }
        saveConversations();
        loadConversations();
        renderHistoryDrawer();
      });

      drawerHistoryList.appendChild(item);
    });
  }

  function renderActiveConversation() {
    chatMessages.innerHTML = '';
    const conv = conversations[activeConversationId];

    if (headerTitleText) {
      if (conv && conv.messages && conv.messages.length > 0) {
        headerTitleText.textContent = conv.title || 'Agent';
      } else {
        headerTitleText.textContent = 'Agent';
      }
    }

    if (!conv || !conv.messages || conv.messages.length === 0) {
      if (mainCanvas) mainCanvas.classList.add('is-empty-state');

      // Update workspace folder title
      chrome.storage.local.get(['approvedWorkspaces'], (res) => {
        const list = res.approvedWorkspaces || [];
        if (workspaceTitleDisplay) {
          if (list.length > 0) {
            const last = list[0].replace(/\\/g, '/').split('/').filter(Boolean).pop();
            if (last) workspaceTitleDisplay.textContent = last;
          } else {
            workspaceTitleDisplay.textContent = 'persimmon_website';
          }
        }
      });

      // Update recent task line if previous tasks exist
      const allSorted = Object.values(conversations).filter(c => c.id !== activeConversationId && c.messages && c.messages.length > 0).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      if (recentTaskRow) {
        if (allSorted.length > 0) {
          recentTaskRow.style.display = 'flex';
          if (recentTaskTitle) recentTaskTitle.textContent = allSorted[0].title || 'Previous Task';
          if (recentTaskTime) {
            const diffMs = Date.now() - new Date(allSorted[0].updatedAt).getTime();
            const hours = Math.max(1, Math.round(diffMs / 3600000));
            recentTaskTime.textContent = `${hours}h`;
          }
          recentTaskRow.onclick = () => {
            activeConversationId = allSorted[0].id;
            saveConversations();
            updateConversationDropdown();
            renderActiveConversation();
          };
        } else {
          recentTaskRow.style.display = 'flex';
          if (recentTaskTitle) recentTaskTitle.textContent = 'Persimmon Website Creation';
          if (recentTaskTime) recentTaskTime.textContent = '2h';
        }
      }
      return;
    }

    if (mainCanvas) mainCanvas.classList.remove('is-empty-state');

    conv.messages.forEach(msg => {
      if (msg.type === 'user') {
        appendUserMessageDom(msg.content, msg.screenshot);
      } else if (msg.type === 'agent') {
        appendAgentMessageDom(msg.content);
      } else if (msg.type === 'thought') {
        renderAgentThoughtDom(msg.content);
      } else if (msg.type === 'tool_step') {
        renderToolStepDom(msg.tool, msg.params);
      } else if (msg.type === 'tool_result') {
        renderToolResultDom(msg.tool, msg.result, msg.error);
      } else if (msg.type === 'system') {
        appendSystemNoticeDom(msg.content);
      }
    });

    scrollChat();
  }

  function recordMessage(item, targetConvId = null) {
    const convId = targetConvId || activeConversationId;
    if (!convId || !conversations[convId]) return;
    const conv = conversations[convId];
    if (!Array.isArray(conv.messages)) conv.messages = [];

    conv.messages.push({
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...item
    });

    if (conv.messages.length > 120) {
      conv.messages = conv.messages.slice(-120);
    }

    conv.updatedAt = new Date().toISOString();

    // Auto-title on first user message
    if (item.type === 'user' && (conv.title === 'New conversation' || conv.title.startsWith('Task #') || conv.title.startsWith('New Task'))) {
      conv.title = item.content.slice(0, 26) + (item.content.length > 26 ? '...' : '');
      updateConversationDropdown();
    }

    saveConversations();
  }

  btnNewChat.addEventListener('click', createNewConversation);

  conversationSelect.addEventListener('change', () => {
    activeConversationId = conversationSelect.value;
    saveConversations();
    renderActiveConversation();
  });

  function attachPillListeners() {
    document.querySelectorAll('.agy-suggestion-card, .agy-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const prompt = pill.getAttribute('data-prompt');
        userInput.value = prompt;
        userInput.style.height = 'auto';
        userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
        handleSendPrompt();
      });
    });
  }

  // --- 4. Chat & Instruction Dispatch ---

  sendBtn.addEventListener('click', () => {
    if (isProcessing) {
      triggerEmergencyStop();
    } else {
      handleSendPrompt();
    }
  });

  userInput.addEventListener('keydown', (e) => {
    // Autocomplete menu keyboard navigation
    if (slashCommandMenu.style.display !== 'none' || atMentionMenu.style.display !== 'none') {
      const activeMenu = slashCommandMenu.style.display !== 'none' ? slashCommandMenu : atMentionMenu;
      const items = activeMenu.querySelectorAll('.agy-popover-item');
      let currentIndex = -1;
      items.forEach((item, idx) => {
        if (item.classList.contains('active')) currentIndex = idx;
      });

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items.forEach(i => i.classList.remove('active'));
        const next = (currentIndex + 1) % items.length;
        items[next].classList.add('active');
        items[next].scrollIntoView({ block: 'nearest' });
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items.forEach(i => i.classList.remove('active'));
        const prev = (currentIndex - 1 + items.length) % items.length;
        items[prev].classList.add('active');
        items[prev].scrollIntoView({ block: 'nearest' });
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (currentIndex >= 0) {
          items[currentIndex].click();
        }
        return;
      } else if (e.key === 'Escape') {
        hideAutocompleteMenus();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendPrompt();
    }
  });

  attachPillListeners();

  // Autocomplete Menu Handling
  function handleAutocompleteInput() {
    const val = userInput.value;
    const cursorPos = userInput.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);

    if (textBeforeCursor.endsWith('/')) {
      showSlashMenu();
    } else if (textBeforeCursor.endsWith('@')) {
      showAtMenu();
    } else if (!textBeforeCursor.includes('/') && !textBeforeCursor.includes('@')) {
      hideAutocompleteMenus();
    }
  }

  function showSlashMenu() {
    slashCommandMenu.style.display = 'block';
    atMentionMenu.style.display = 'none';
  }

  function showAtMenu() {
    atMentionMenu.style.display = 'block';
    slashCommandMenu.style.display = 'none';
  }

  function hideAutocompleteMenus() {
    slashCommandMenu.style.display = 'none';
    atMentionMenu.style.display = 'none';
  }

  slashCommandMenu.querySelectorAll('.agy-popover-item').forEach(item => {
    item.addEventListener('click', () => {
      const cmd = item.getAttribute('data-command');
      insertAtCursor(cmd + ' ');
      hideAutocompleteMenus();
      userInput.focus();
    });
  });

  atMentionMenu.querySelectorAll('.agy-popover-item').forEach(item => {
    item.addEventListener('click', () => {
      const mention = item.getAttribute('data-mention');
      insertAtCursor(mention + ' ');
      hideAutocompleteMenus();
      userInput.focus();
    });
  });

  if (btnTriggerMention) {
    btnTriggerMention.addEventListener('click', () => {
      insertAtCursor('@');
      showAtMenu();
      userInput.focus();
    });
  }

  function insertAtCursor(text) {
    const start = userInput.selectionStart;
    const end = userInput.selectionEnd;
    const val = userInput.value;
    let replaceStart = start;
    if (start > 0 && (val[start - 1] === '/' || val[start - 1] === '@')) {
      replaceStart = start - 1;
    }
    userInput.value = val.substring(0, replaceStart) + text + val.substring(end);
    userInput.selectionStart = userInput.selectionEnd = replaceStart + text.length;
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
  }

  // Screenshot attachment
  btnSnapScreenshot.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'DIRECT_BROWSER_ACTION',
        browserCommand: 'capture_screenshot'
      });
      if (response && response.result?.screenshot) {
        attachedScreenshot = response.result.screenshot;
        screenshotThumbImg.src = attachedScreenshot;
        screenshotPreviewTag.style.display = 'inline-flex';
      }
    } catch (e) {
      console.warn('Screenshot capture failed', e);
    }
  });

  if (btnRemoveScreenshot) {
    btnRemoveScreenshot.addEventListener('click', () => {
      attachedScreenshot = null;
      screenshotPreviewTag.style.display = 'none';
      screenshotThumbImg.src = '';
    });
  }

  function setProcessing(active, label = 'Planning next step...') {
    isProcessing = active;
    const sendBtnIcon = document.getElementById('send-btn-icon');
    const stopBtnSquare = document.getElementById('stop-btn-square');

    if (active) {
      sendBtn.classList.add('running');
      sendBtn.classList.remove('active');
      sendBtn.removeAttribute('disabled');
      if (sendBtnIcon) sendBtnIcon.style.display = 'none';
      if (stopBtnSquare) stopBtnSquare.style.display = 'block';
      sendBtn.title = 'Cancel (Ctrl+D)';
      sendBtn.setAttribute('aria-label', 'Cancel');
      if (emergencyStopBtn) emergencyStopBtn.style.display = 'inline-flex';
      showAgentStatus(label);
    } else {
      sendBtn.classList.remove('running');
      if (stopBtnSquare) stopBtnSquare.style.display = 'none';
      if (sendBtnIcon) sendBtnIcon.style.display = 'block';
      sendBtn.title = 'Send message (Enter)';
      sendBtn.setAttribute('aria-label', 'Send message');
      if (emergencyStopBtn) emergencyStopBtn.style.display = 'none';
      updateSendBtnState();
      hideAgentStatus();
    }
  }

  async function handleSendPrompt() {
    const promptText = userInput.value.trim();
    if (!promptText || isProcessing) return;

    userInput.value = '';
    userInput.style.height = 'auto';
    hideAutocompleteMenus();

    // Remove welcome card on first message if present
    const existingWelcome = document.getElementById('welcome-card');
    if (existingWelcome) existingWelcome.remove();

    // Add user message to UI & persist
    appendUserMessage(promptText, attachedScreenshot);

    setProcessing(true, 'Gathering page context & planning...');

    try {
      // Gather browser context if enabled
      let context = {};
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (checkIncludePage.checked && activeTab?.id) {
        try {
          const pageRes = await chrome.tabs.sendMessage(activeTab.id, { action: 'GET_PAGE_CONTEXT' });
          if (pageRes && pageRes.success) {
            context.page = pageRes;
          }
        } catch (e) {}
      }

      if (checkIncludeDom.checked && activeTab?.id) {
        try {
          const domRes = await chrome.tabs.sendMessage(activeTab.id, { action: 'DISTILL_DOM', maxElements: 60 });
          if (domRes && domRes.success) {
            context.dom = domRes;
          }
        } catch (e) {}
      }

      if (attachedScreenshot) {
        context.screenshot = attachedScreenshot;
        attachedScreenshot = null;
        screenshotPreviewTag.style.display = 'none';
        screenshotThumbImg.src = '';
      }

      const taskConversationId = activeConversationId;

      if (isConnected) {
        chrome.runtime.sendMessage({
          action: 'SEND_ENGINE_MESSAGE',
          payload: {
            type: 'USER_TASK',
            conversationId: taskConversationId,
            task: promptText,
            provider: modelSelect.value,
            context
          }
        });
      } else {
        appendAgentMessage(
          `⚠️ **Local Engine Offline**\n\nThe Antigravity Local Engine companion service is not connected.\n\nTo execute tasks across your browser, filesystem, and terminal:\n1. Start the engine from your terminal:\n   \`\`\`bash\n   npm run start:engine\n   \`\`\`\n2. If not paired, enter your Pairing Code in the **Settings** tab.\n3. Click **Reconnect** to establish the secure WebSocket bridge.`,
          taskConversationId
        );
        setProcessing(false);
      }
    } catch (err) {
      appendAgentMessage(`❌ **Agent Error**: ${err.message}`);
      setProcessing(false);
    }
  }

  // --- 5. Message Stream Handling from Engine ---

  chrome.runtime.onMessage.addListener((msg) => {
    const targetConvId = msg.conversationId || activeConversationId;

    switch (msg.type) {
      case 'ENGINE_STATUS':
        updateEngineStatus(msg.connected, msg.port, msg.authFailed, msg.error);
        break;

      case 'PROVIDER_ACTIVE':
        if (msg.provider) {
          const isFback = msg.isFallback ? ' (Autonomous Fallback)' : '';
          const policy = msg.policy ? ` [${msg.policy.toUpperCase()}]` : '';
          appendSystemNotice(`Active Provider: ${msg.provider.toUpperCase()}${policy}${isFback}`, targetConvId);
        }
        break;

      case 'PROVIDER_SWITCH':
        appendSystemNotice(`⚠️ Provider switched to ${msg.provider}: ${msg.reason || ''}`, targetConvId);
        break;

      case 'AGENT_THOUGHT':
        renderAgentThought(msg.thought, targetConvId);
        break;

      case 'STREAM_CHUNK':
        streamAgentChunk(msg.chunk, targetConvId);
        break;

      case 'AGENT_MESSAGE':
        appendAgentMessage(msg.message, targetConvId);
        if (targetConvId === activeConversationId) {
          setProcessing(false);
        }
        speakTextIfEnabled(msg.message);
        break;

      case 'TOOL_START':
        if (targetConvId === activeConversationId) {
          showAgentStatus(`Executing: ${msg.tool}...`);
        }
        renderToolStep(msg.tool, msg.params, targetConvId);
        addAuditEntry(msg.tool, 'started', msg.params);
        break;

      case 'TOOL_FINISH':
        renderToolResult(msg.tool, msg.result, msg.error, targetConvId);
        addAuditEntry(msg.tool, msg.error ? 'failed' : 'completed', msg.result || msg.error);
        break;

      case 'APPROVAL_REQUEST':
        handleNewApproval(msg);
        break;

      case 'TASK_COMPLETE':
        if (targetConvId === activeConversationId) {
          setProcessing(false);
        }
        if (msg.summary) {
          appendAgentMessage(msg.summary, targetConvId);
          speakTextIfEnabled(msg.summary);
        }
        break;
    }
  });


  // --- 6. Approvals & Security System ---

  function handleNewApproval(req) {
    const { approvalId, actionType, tool, details, riskLevel } = req;
    pendingApprovals.set(approvalId, req);
    updateApprovalsBadge();

    // Auto-open Approvals drawer
    openDrawer(drawerApprovals);

    const emptyState = approvalsList.querySelector('.agy-empty-drawer-state');
    if (emptyState) emptyState.remove();

    const card = document.createElement('div');
    card.className = 'agy-ide-approval-card';
    card.id = `approval-${approvalId}`;

    let previewContent = '';
    if (details.content !== undefined) {
      previewContent = `<pre class="agy-ide-step-body" style="max-height:120px;color:#a7f3d0;">${escapeHtml(details.content)}</pre>`;
    } else if (details.targetContent !== undefined) {
      previewContent = `<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Replacing:</div>
      <pre class="agy-ide-step-body" style="color:#fca5a5;">${escapeHtml(details.targetContent)}</pre>
      <div style="font-size:11px;color:var(--text-dim);">With:</div>
      <pre class="agy-ide-step-body" style="color:#a7f3d0;">${escapeHtml(details.replacementContent)}</pre>`;
    } else {
      previewContent = `<pre class="agy-ide-step-body">${escapeHtml(JSON.stringify(details, null, 2))}</pre>`;
    }

    card.innerHTML = `
      <div class="agy-ide-approval-head">
        <span class="agy-badge-pill" style="background:${riskLevel === 'high' ? 'var(--status-red)' : 'var(--status-amber)'};">${(riskLevel || 'MEDIUM').toUpperCase()} RISK</span>
        <span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);">${escapeHtml(tool)}</span>
      </div>
      <div class="agy-ide-approval-title">${escapeHtml(actionType || 'Permission Request')}</div>
      ${previewContent}
      <div class="agy-ide-approval-actions">
        <button class="agy-ide-btn-approve" data-id="${approvalId}">Authorize</button>
        <button class="agy-ide-btn-deny" data-id="${approvalId}">Deny</button>
      </div>
    `;

    const approveBtn = card.querySelector('.agy-ide-btn-approve');
    const denyBtn = card.querySelector('.agy-ide-btn-deny');
    const disableApprovalButtons = () => {
      approveBtn.disabled = true;
      denyBtn.disabled = true;
      approveBtn.style.opacity = '0.5';
      denyBtn.style.opacity = '0.5';
    };

    approveBtn.addEventListener('click', () => {
      disableApprovalButtons();
      resolveApproval(approvalId, true);
      card.remove();
    });

    denyBtn.addEventListener('click', () => {
      disableApprovalButtons();
      resolveApproval(approvalId, false);
      card.remove();
    });

    approvalsList.prepend(card);
    speakTextIfEnabled('Security approval required.');
  }

  function resolveApproval(approvalId, approved) {
    chrome.runtime.sendMessage({
      action: 'SEND_ENGINE_MESSAGE',
      payload: {
        type: 'APPROVAL_RESPONSE',
        approvalId,
        approved
      }
    });

    pendingApprovals.delete(approvalId);
    updateApprovalsBadge();
    addAuditEntry('SECURITY_APPROVAL', approved ? 'APPROVED' : 'DENIED', { approvalId });
  }

  function updateApprovalsBadge() {
    const count = pendingApprovals.size;
    if (count > 0) {
      approvalsCountBadge.style.display = 'inline-block';
      approvalsCountBadge.textContent = count;
      moreMenuBadge.style.display = 'block';
    } else {
      approvalsCountBadge.style.display = 'none';
      moreMenuBadge.style.display = 'none';
    }
  }

  // --- 7. Emergency Stop ---

  function triggerEmergencyStop() {
    console.warn('[Antigravity] EMERGENCY STOP TRIGGERED');
    chrome.runtime.sendMessage({
      action: 'SEND_ENGINE_MESSAGE',
      payload: { type: 'EMERGENCY_STOP' }
    });

    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_HIGHLIGHTS' });
      }
    });

    setProcessing(false);
    appendSystemNotice('🛑 EMERGENCY STOP ACTIVATED. All agent operations, child terminal processes, and automations halted.');
    recordMessage({ type: 'system', content: '🛑 EMERGENCY STOP ACTIVATED.' });
    addAuditEntry('EMERGENCY_STOP', 'EXECUTED', { triggeredBy: 'user' });
    speakTextIfEnabled('Emergency stop activated.');
  }

  // --- 8. Voice Dictation ---

  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRecognition = new SpeechClass();
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'en-US';

    speechRecognition.onstart = () => {
      isListeningVoice = true;
      voiceBtn.classList.add('recording');
      voiceStateHint.style.display = 'inline-flex';
    };

    speechRecognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          userInput.value += (userInput.value ? ' ' : '') + event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (interim) {
        const textSpan = voiceStateHint.querySelector('.voice-text');
        if (textSpan) textSpan.textContent = `"${interim}"`;
      }
    };

    speechRecognition.onerror = (err) => {
      console.warn('Voice error:', err);
      stopVoice();
    };

    speechRecognition.onend = () => {
      stopVoice();
    };

    voiceBtn.addEventListener('click', () => {
      if (isListeningVoice) {
        speechRecognition.stop();
        stopVoice();
      } else {
        try {
          speechRecognition.start();
        } catch (e) {
          console.warn('SpeechRecognition start error:', e);
        }
      }
    });
  } else {
    voiceBtn.style.display = 'none';
  }

  function stopVoice() {
    isListeningVoice = false;
    voiceBtn.classList.remove('recording');
    voiceStateHint.style.display = 'none';
  }

  function speakTextIfEnabled(text) {
    if (!settingAudioFeedback.checked || !window.speechSynthesis) return;
    const clean = text.replace(/[#*`_\[\]()]/g, '').slice(0, 160);
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 1.05;
    window.speechSynthesis.speak(utter);
  }

  // --- 9. UI Rendering Helpers & DOM Creators (Antigravity IDE 1:1) ---

  function appendUserMessage(text, screenshot = null) {
    appendUserMessageDom(text, screenshot);
    recordMessage({ type: 'user', content: text, screenshot });
  }

  function appendUserMessageDom(text, screenshot = null) {
    const msg = document.createElement('div');
    msg.className = 'agy-chat-msg user';
    let bubbleContent = escapeHtml(text);
    if (screenshot) {
      bubbleContent += `<div style="margin-top:6px;"><img src="${screenshot}" style="max-width:180px;border-radius:4px;border:1px solid var(--border-subtle);" alt="Captured Tab"></div>`;
    }
    msg.innerHTML = bubbleContent;
    chatMessages.appendChild(msg);
    scrollChat();
  }

  function appendAgentMessage(text, targetConvId = null) {
    recordMessage({ type: 'agent', content: text }, targetConvId);
    if ((targetConvId || activeConversationId) === activeConversationId) {
      appendAgentMessageDom(text);
    }
  }

  function appendAgentMessageDom(text) {
    const card = document.createElement('div');
    card.className = 'agy-chat-msg agent';
    card.innerHTML = `
      <div class="agy-task-description">${formatMarkdown(text)}</div>
    `;
    chatMessages.appendChild(card);
    currentStreamingBubble = null;
    scrollChat();
  }

  function streamAgentChunk(chunk, targetConvId = null) {
    if ((targetConvId || activeConversationId) !== activeConversationId) return;
    if (!currentStreamingBubble) {
      const card = document.createElement('div');
      card.className = 'agy-chat-msg agent';
      card.innerHTML = `<div class="agy-task-description"></div>`;
      chatMessages.appendChild(card);
      currentStreamingBubble = card.querySelector('.agy-task-description');
    }
    currentStreamingBubble.innerHTML += formatMarkdown(chunk);
    scrollChat();
  }

  function renderAgentThought(thought, targetConvId = null) {
    recordMessage({ type: 'thought', content: thought }, targetConvId);
    if ((targetConvId || activeConversationId) === activeConversationId) {
      renderAgentThoughtDom(thought);
    }
  }

  function renderAgentThoughtDom(thought) {
    const box = document.createElement('div');
    box.className = 'agy-ide-thought-box open';
    box.innerHTML = `
      <div class="agy-ide-thought-header">
        <div class="agy-ide-thought-title-group">
          <span class="agy-ide-thought-pulse"></span>
          <span>Thinking Process</span>
        </div>
        <svg class="agy-ide-chevron" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 3l5 5-5 5V3z"/>
        </svg>
      </div>
      <div class="agy-ide-thought-content">${escapeHtml(thought)}</div>
    `;
    box.querySelector('.agy-ide-thought-header').addEventListener('click', () => {
      box.classList.toggle('open');
    });
    chatMessages.appendChild(box);
    scrollChat();
  }

  function renderToolStep(tool, params, targetConvId = null) {
    recordMessage({ type: 'tool_step', tool, params }, targetConvId);
    if ((targetConvId || activeConversationId) === activeConversationId) {
      renderToolStepDom(tool, params);
    }
  }

  function renderToolStepDom(tool, params) {
    const card = document.createElement('div');
    card.className = 'agy-ide-step-card';
    card.id = `step-${Date.now()}`;

    let iconSvg = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h2a1.5 1.5 0 0 1 1.5 1.5V4h1.75A1.75 1.75 0 0 1 14 5.75v7.5A1.75 1.75 0 0 1 12.25 15H3.75A1.75 1.75 0 0 1 2 13.25v-7.5A1.75 1.75 0 0 1 3.75 4H5.5v-.5z"/></svg>';
    if (tool.includes('command') || tool.includes('exec') || tool.includes('bash')) {
      iconSvg = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm5.854 4.146a.5.5 0 1 0-.708.708L7.293 9 5.146 11.146a.5.5 0 0 0 .708.708l2.5-2.5a.5.5 0 0 0 0-.708l-2.5-2.5zM9 11.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1H9z"/></svg>';
    } else if (tool.includes('file') || tool.includes('edit') || tool.includes('replace')) {
      iconSvg = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm1 2v10h6V3H5z"/></svg>';
    } else if (tool.includes('browser') || tool.includes('tab') || tool.includes('click')) {
      iconSvg = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>';
    }

    let payloadHtml = '';
    if (params && params.CommandLine) {
      payloadHtml = `$ ${escapeHtml(params.CommandLine)}`;
    } else if (params && (params.TargetFile || params.path)) {
      payloadHtml = `Target: ${escapeHtml(params.TargetFile || params.path)}`;
      if (params.ReplacementContent) {
        payloadHtml += `\n<span class="agy-ide-diff-line-add">+ ${escapeHtml(params.ReplacementContent)}</span>`;
      }
    } else {
      payloadHtml = escapeHtml(JSON.stringify(params, null, 2));
    }

    card.innerHTML = `
      <div class="agy-ide-step-header">
        <div class="agy-ide-step-meta">
          <span class="agy-ide-step-icon">${iconSvg}</span>
          <span>${escapeHtml(tool)}</span>
        </div>
        <span class="agy-ide-step-badge running">Running...</span>
      </div>
      <div class="agy-ide-step-body">${payloadHtml}</div>
    `;
    chatMessages.appendChild(card);
    scrollChat();
  }

  function renderToolResult(tool, result, error, targetConvId = null) {
    recordMessage({ type: 'tool_result', tool, result, error }, targetConvId);
    if ((targetConvId || activeConversationId) === activeConversationId) {
      renderToolResultDom(tool, result, error);
    }
  }

  function renderToolResultDom(tool, result, error) {
    const lastCard = chatMessages.querySelector('.agy-ide-step-card:last-child');
    if (lastCard) {
      const badge = lastCard.querySelector('.agy-ide-step-badge');
      if (badge) {
        badge.className = `agy-ide-step-badge ${error ? 'error' : 'success'}`;
        badge.textContent = error ? 'Failed' : 'Completed';
      }
      if (result && typeof result === 'object' && result.output) {
        const body = lastCard.querySelector('.agy-ide-step-body');
        if (body) {
          body.innerHTML += `\n\n<span style="color:var(--text-dim);">Output:</span>\n${escapeHtml(result.output)}`;
        }
      }
    }
  }

  function appendSystemNotice(notice, targetConvId = null) {
    recordMessage({ type: 'system', content: notice }, targetConvId);
    if ((targetConvId || activeConversationId) === activeConversationId) {
      appendSystemNoticeDom(notice);
    }
  }

  function appendSystemNoticeDom(notice) {
    const noticeEl = document.createElement('div');
    noticeEl.style.fontSize = '11px';
    noticeEl.style.color = 'var(--text-dim)';
    noticeEl.style.textAlign = 'center';
    noticeEl.style.margin = '4px 0';
    noticeEl.style.padding = '3px 8px';
    noticeEl.style.background = 'rgba(255,255,255,0.02)';
    noticeEl.style.borderRadius = 'var(--radius-xs)';
    noticeEl.textContent = notice;
    chatMessages.appendChild(noticeEl);
    scrollChat();
  }

  function showAgentStatus(label) {
    agentStatusPill.style.display = 'block';
    agentStatusLabel.textContent = label;
  }

  function hideAgentStatus() {
    agentStatusPill.style.display = 'none';
  }

  function scrollChat() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // --- 10. Audit Logging ---

  function addAuditEntry(action, status, details) {
    const emptyState = auditList.querySelector('.agy-empty-drawer-state');
    if (emptyState) emptyState.remove();

    const time = new Date().toLocaleTimeString();
    const item = document.createElement('div');
    item.style.padding = '8px';
    item.style.background = 'rgba(255,255,255,0.03)';
    item.style.border = '1px solid var(--border-subtle)';
    item.style.borderRadius = '4px';
    item.style.fontFamily = 'var(--font-mono)';
    item.style.fontSize = '11px';
    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <strong style="color:#a5b4fc;">${escapeHtml(action)}</strong>
        <span style="color:var(--text-dim);font-size:10px;">${time}</span>
      </div>
      <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">Status: <strong>${escapeHtml(status)}</strong></div>
      <pre class="agy-ide-step-body" style="max-height:80px; overflow-y:auto;">${escapeHtml(JSON.stringify(details, null, 2))}</pre>
    `;
    auditList.prepend(item);
  }

  async function fetchAuditEntries() {
    chrome.storage.local.get(['enginePort', 'authToken'], async (res) => {
      const port = res.enginePort || 3721;
      const token = res.authToken || '';
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/audit?limit=40`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.entries && data.entries.length > 0) {
            auditList.innerHTML = '';
            data.entries.forEach(entry => {
              const item = document.createElement('div');
              item.style.padding = '8px';
              item.style.background = 'rgba(255,255,255,0.03)';
              item.style.border = '1px solid var(--border-subtle)';
              item.style.borderRadius = '4px';
              item.style.fontFamily = 'var(--font-mono)';
              item.style.fontSize = '11px';
              item.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                  <strong style="color:#a5b4fc;">${escapeHtml(entry.action)} ${entry.tool ? `(${escapeHtml(entry.tool)})` : ''}</strong>
                  <span style="color:var(--text-dim);font-size:10px;">${new Date(entry.timestamp).toLocaleTimeString()}</span>
                </div>
                <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">Status: <strong>${escapeHtml(entry.status)}</strong> | Risk: ${escapeHtml(entry.riskLevel || 'LOW')}</div>
                <pre class="agy-ide-step-body" style="max-height:80px; overflow-y:auto;">${escapeHtml(JSON.stringify(entry.params || entry.result || entry.error || {}, null, 2))}</pre>
              `;
              auditList.appendChild(item);
            });
          }
        }
      } catch (e) {}
    });
  }

  refreshAuditBtn.addEventListener('click', fetchAuditEntries);

  clearAuditBtn.addEventListener('click', async () => {
    chrome.storage.local.get(['enginePort', 'authToken'], async (res) => {
      const port = res.enginePort || 3721;
      const token = res.authToken || '';
      try {
        await fetch(`http://127.0.0.1:${port}/audit/clear`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ operator: 'extension-user' })
        });
      } catch (e) {}
    });

    auditList.innerHTML = `
      <div class="agy-empty-drawer-state">
        <div class="agy-empty-icon">📜</div>
        <h4>Audit Log Cleared</h4>
      </div>
    `;
  });

  // --- 11. Workspaces & Provider Health Management ---

  async function loadWorkspaces() {
    chrome.storage.local.get(['enginePort', 'authToken'], async (res) => {
      const port = res.enginePort || 3721;
      const token = res.authToken || '';
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/workspaces`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (resp.ok) {
          const data = await resp.json();
          renderWorkspaces(data.workspaces || []);
        } else {
          workspacesList.innerHTML = `<div style="font-size:11px;color:var(--text-dim);padding:4px;">Start local engine to manage workspaces.</div>`;
        }
      } catch (e) {
        workspacesList.innerHTML = `<div style="font-size:11px;color:var(--text-dim);padding:4px;">Offline. Start engine to view workspaces.</div>`;
      }
    });
  }

  function renderWorkspaces(workspaces) {
    workspacesList.innerHTML = '';
    if (!workspaces || workspaces.length === 0) {
      workspacesList.innerHTML = `
        <div style="font-size:11px;color:#f59e0b;padding:6px;background:rgba(245,158,11,0.08);border-radius:4px;border:1px dashed rgba(245,158,11,0.4);">
          ⚠️ No approved workspaces. Filesystem and terminal operations are locked down until you approve a workspace directory below.
        </div>
      `;
      return;
    }

    workspaces.forEach(wsPath => {
      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.style.padding = '3px 6px';
      item.style.fontFamily = 'var(--font-mono)';
      item.style.fontSize = '11px';
      item.style.color = '#cbd5e1';
      item.innerHTML = `
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(wsPath)}">${escapeHtml(wsPath)}</span>
        <button style="background:transparent;border:none;color:var(--status-red);cursor:pointer;font-size:14px;" title="Remove scope">&times;</button>
      `;
      item.querySelector('button').addEventListener('click', async () => {
        chrome.storage.local.get(['enginePort', 'authToken'], async (res) => {
          const port = res.enginePort || 3721;
          const token = res.authToken || '';
          try {
            await fetch(`http://127.0.0.1:${port}/workspaces`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ path: wsPath })
            });
            loadWorkspaces();
          } catch (e) {}
        });
      });
      workspacesList.appendChild(item);
    });
  }

  btnAddWorkspace.addEventListener('click', async () => {
    const newPath = inputNewWorkspace.value.trim();
    if (!newPath) return;

    chrome.storage.local.get(['enginePort', 'authToken'], async (res) => {
      const port = res.enginePort || 3721;
      const token = res.authToken || '';
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/workspaces`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ path: newPath })
        });
        if (resp.ok) {
          inputNewWorkspace.value = '';
          loadWorkspaces();
        } else {
          const err = await resp.json();
          alert(`Could not add workspace: ${err.error}`);
        }
      } catch (e) {
        alert(`Failed to add workspace: ${e.message}`);
      }
    });
  });

  async function checkProviderHealth() {
    chrome.storage.local.get(['enginePort', 'authToken'], async (res) => {
      const port = res.enginePort || 3721;
      const token = res.authToken || '';
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/providers`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (resp.ok) {
          const data = await resp.json();
          const p = data.providers || {};
          providerHealthBadge.innerHTML = `
            <div><strong>Gemini:</strong> ${p.gemini?.configured ? '<span style="color:var(--status-green);">Configured</span>' : '<span style="color:var(--text-dim);">Missing Key</span>'}</div>
            <div><strong>Claude:</strong> ${p.anthropic?.configured ? '<span style="color:var(--status-green);">Configured</span>' : '<span style="color:var(--text-dim);">Missing Key</span>'}</div>
            <div><strong>OpenAI:</strong> ${p.openai?.configured ? '<span style="color:var(--status-green);">Configured</span>' : '<span style="color:var(--text-dim);">Missing Key</span>'}</div>
            <div><strong>Ollama:</strong> ${p.ollama?.healthy ? '<span style="color:var(--status-green);">Online (' + escapeHtml(p.ollama.model) + ')</span>' : '<span style="color:var(--status-red);">Offline</span>'}</div>
            <div><strong>Autonomous Engine:</strong> <span style="color:var(--status-blue);">Ready (Built-in)</span></div>
          `;
        } else {
          providerHealthBadge.innerHTML = `<span style="color:var(--text-dim);">Connect to Local Engine to inspect provider status.</span>`;
        }
      } catch (e) {
        providerHealthBadge.innerHTML = `<span style="color:var(--text-dim);">Local Engine offline.</span>`;
      }
    });
  }

  // --- 12. Engine Health & Status Management ---

  function checkEngineStatus() {
    chrome.runtime.sendMessage({ action: 'GET_ENGINE_STATUS' }, (res) => {
      if (res) {
        updateEngineStatus(res.connected);
      }
    });
  }

  function updateEngineStatus(connected, port = 3721, authFailed = false, error = null) {
    isConnected = Boolean(connected);
    if (isConnected) {
      if (engineStatusText) engineStatusText.textContent = `ONLINE :${port}`;
      if (engineStatusDot) engineStatusDot.className = 'agy-status-dot-sm connected';
    } else if (authFailed) {
      if (engineStatusText) engineStatusText.textContent = 'AUTH FAILED';
      if (engineStatusDot) engineStatusDot.className = 'agy-status-dot-sm';
      if (error) {
        appendSystemNotice(`⚠️ ${error}`);
      }
    } else {
      if (engineStatusText) engineStatusText.textContent = 'OFFLINE';
      if (engineStatusDot) engineStatusDot.className = 'agy-status-dot-sm';
    }
  }

  async function refreshActiveTabContext() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      pageTitleText.textContent = tab.title || tab.url || 'Current Tab';
      pageTitleText.title = tab.url || '';
    }
  }

  chrome.tabs.onActivated.addListener(() => {
    refreshActiveTabContext();
  });

  // --- 13. Settings Storage & Engine Synchronization ---

  if (btnPairEngine) {
    btnPairEngine.addEventListener('click', async () => {
      const pairingCode = settingPairingCode ? settingPairingCode.value.trim() : '';
      if (!pairingCode) {
        if (pairingHint) {
          pairingHint.textContent = 'Please enter the 6-character code from the engine console.';
          pairingHint.style.color = 'var(--status-red)';
          pairingHint.style.display = 'block';
        }
        return;
      }

      let port = 3721;
      const match = settingEngineUrl.value.match(/:(\d+)/);
      if (match) port = parseInt(match[1], 10);

      try {
        const resp = await fetch(`http://127.0.0.1:${port}/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairingCode })
        });
        const data = await resp.json();
        if (resp.ok && data.token) {
          settingAuthToken.value = data.token;
          chrome.storage.local.set({ authToken: data.token });
          if (pairingHint) {
            pairingHint.textContent = '🎉 Engine paired successfully! Security token updated.';
            pairingHint.style.color = 'var(--status-green)';
            pairingHint.style.display = 'block';
          }
          chrome.runtime.sendMessage({ action: 'RECONNECT_ENGINE' });
          setTimeout(checkEngineStatus, 800);
          setTimeout(checkProviderHealth, 1000);
          setTimeout(loadWorkspaces, 1000);
        } else {
          if (pairingHint) {
            pairingHint.textContent = `Pairing failed: ${data.error || 'Invalid code'}`;
            pairingHint.style.color = 'var(--status-red)';
            pairingHint.style.display = 'block';
          }
        }
      } catch (err) {
        if (pairingHint) {
          pairingHint.textContent = `Engine unreachable at port ${port}. Ensure engine is running.`;
          pairingHint.style.color = 'var(--status-red)';
          pairingHint.style.display = 'block';
        }
      }
    });
  }

  function loadSettings() {
    chrome.storage.local.get([
      'enginePort',
      'authToken',
      'selectedProvider',
      'hybridRoutingPolicy',
      'geminiKey',
      'anthropicKey',
      'openAiKey',
      'ollamaUrl',
      'audioFeedback'
    ], (res) => {
      const port = res.enginePort || 3721;
      settingEngineUrl.value = `ws://127.0.0.1:${port}`;
      if (res.authToken) settingAuthToken.value = res.authToken;
      const provider = res.selectedProvider || 'gemini';
      settingProvider.value = provider;
      modelSelect.value = provider;
      if (res.hybridRoutingPolicy) settingRoutingPolicy.value = res.hybridRoutingPolicy;
      if (res.geminiKey) settingGeminiKey.value = res.geminiKey;
      if (res.anthropicKey) settingAnthropicKey.value = res.anthropicKey;
      if (res.openAiKey) settingOpenAiKey.value = res.openAiKey;
      if (res.ollamaUrl) settingOllamaUrl.value = res.ollamaUrl;
      if (typeof res.audioFeedback === 'boolean') {
        settingAudioFeedback.checked = res.audioFeedback;
      }

      if (res.authToken) {
        fetch(`http://127.0.0.1:${port}/config`, {
          headers: { Authorization: `Bearer ${res.authToken}` }
        }).then(r => r.ok ? r.json() : null).then(engineCfg => {
          if (engineCfg) {
            if (engineCfg.hasGeminiKey && !settingGeminiKey.value) {
              settingGeminiKey.placeholder = `Configured in Engine (${engineCfg.geminiApiKey})`;
            }
            if (engineCfg.hasAnthropicKey && !settingAnthropicKey.value) {
              settingAnthropicKey.placeholder = `Configured in Engine (${engineCfg.anthropicApiKey})`;
            }
            if (engineCfg.hasOpenaiKey && !settingOpenAiKey.value) {
              settingOpenAiKey.placeholder = `Configured in Engine (${engineCfg.openaiApiKey})`;
            }
          }
        }).catch(() => {});
      }
    });
  }

  saveSettingsBtn.addEventListener('click', async () => {
    let port = 3721;
    const match = settingEngineUrl.value.match(/:(\d+)/);
    if (match) port = parseInt(match[1], 10);

    const token = settingAuthToken.value.trim();
    const config = {
      enginePort: port,
      authToken: token,
      selectedProvider: settingProvider.value,
      hybridRoutingPolicy: settingRoutingPolicy.value,
      geminiKey: settingGeminiKey.value.trim(),
      anthropicKey: settingAnthropicKey.value.trim(),
      openAiKey: settingOpenAiKey.value.trim(),
      ollamaUrl: settingOllamaUrl.value.trim(),
      audioFeedback: settingAudioFeedback.checked
    };

    chrome.storage.local.set(config, async () => {
      modelSelect.value = config.selectedProvider;

      try {
        await fetch(`http://127.0.0.1:${port}/config`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            activeProvider: config.selectedProvider,
            hybridRoutingPolicy: config.hybridRoutingPolicy,
            geminiApiKey: config.geminiKey,
            anthropicApiKey: config.anthropicKey,
            openaiApiKey: config.openAiKey,
            ollamaUrl: config.ollamaUrl,
            preferLocalOllama: (config.selectedProvider === 'ollama' || config.hybridRoutingPolicy === 'privacy-first')
          })
        });
      } catch (err) {}

      settingsSavedHint.style.display = 'block';
      setTimeout(() => { settingsSavedHint.style.display = 'none'; }, 3000);
      chrome.runtime.sendMessage({ action: 'RECONNECT_ENGINE' });
      checkProviderHealth();
    });
  });

  // --- 14. High-Fidelity Markdown & Code Formatting ---

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Code Blocks: ```lang ... ```
    html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang || 'code';
      const cleanCode = code.replace(/^\n+|\n+$/g, '');
      return `
        <div class="agy-ide-code-block">
          <div class="agy-ide-code-header">
            <span>${language}</span>
            <button class="agy-ide-copy-btn" data-code="${cleanCode.replace(/"/g, '&quot;')}">Copy</button>
          </div>
          <pre><code>${cleanCode}</code></pre>
        </div>
      `;
    });

    // GitHub Callout Alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING]
    html = html.replace(/&gt; \[!NOTE\]\s*([\s\S]*?)(\n\n|$)/g, '<div class="agy-ide-alert agy-ide-alert-note"><strong>Note:</strong> $1</div>');
    html = html.replace(/&gt; \[!TIP\]\s*([\s\S]*?)(\n\n|$)/g, '<div class="agy-ide-alert agy-ide-alert-tip"><strong>Tip:</strong> $1</div>');
    html = html.replace(/&gt; \[!IMPORTANT\]\s*([\s\S]*?)(\n\n|$)/g, '<div class="agy-ide-alert agy-ide-alert-important"><strong>Important:</strong> $1</div>');
    html = html.replace(/&gt; \[!WARNING\]\s*([\s\S]*?)(\n\n|$)/g, '<div class="agy-ide-alert agy-ide-alert-warning"><strong>Warning:</strong> $1</div>');

    // Clickable file links: [filename](file:///...)
    html = html.replace(/\[([^\]]+)\]\((file:\/\/\/[^\)]+)\)/g, '<a href="#" class="agy-ide-file-link" data-url="$2" style="color:var(--status-blue);text-decoration:none;">📄 $1</a>');

    // Headers
    html = html.replace(/### (.*?)(\n|$)/g, '<h4>$1</h4>');
    html = html.replace(/## (.*?)(\n|$)/g, '<h3>$1</h3>');

    // Bold & Italics
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Inline Code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  // Copy code buttons delegated listener
  chatMessages.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('agy-ide-copy-btn')) {
      const code = e.target.getAttribute('data-code');
      if (code) {
        navigator.clipboard.writeText(code).then(() => {
          const original = e.target.textContent;
          e.target.textContent = 'Copied!';
          setTimeout(() => { e.target.textContent = original; }, 1600);
        });
      }
    }
  });

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
});
