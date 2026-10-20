// Antigravity Browser Agent - Side Panel Controller
// Manages chat streaming, conversation history persistence, voice input, approvals, audit logs, and settings

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const tabButtons = document.querySelectorAll('.agy-tab');
  const viewSections = document.querySelectorAll('.agy-view');
  const enginePill = document.getElementById('engine-status-pill');
  const engineStatusText = document.getElementById('engine-status-text');
  const emergencyStopBtn = document.getElementById('emergency-stop-btn');
  const pageTitleText = document.getElementById('page-title-text');
  const modelSelect = document.getElementById('model-select');

  // Conversation Elements
  const btnNewChat = document.getElementById('btn-new-chat');
  const conversationSelect = document.getElementById('conversation-select');
  const btnClearChat = document.getElementById('btn-clear-chat');

  // Chat Elements
  const chatMessages = document.getElementById('chat-messages');
  const welcomeCard = document.getElementById('welcome-card');
  const userInput = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const voiceBtn = document.getElementById('voice-btn');
  const voiceStateHint = document.getElementById('voice-state-hint');
  const agentStatusPill = document.getElementById('agent-active-status');
  const agentStatusLabel = document.getElementById('agent-status-label');
  const checkIncludePage = document.getElementById('check-include-page');
  const checkIncludeDom = document.getElementById('check-include-dom');
  const btnSnapScreenshot = document.getElementById('btn-snap-screenshot');

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

  // Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      tabButtons.forEach(b => b.classList.remove('active'));
      viewSections.forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      const targetView = document.getElementById(targetId);
      if (targetView) targetView.classList.add('active');

      if (targetId === 'settings-view') {
        loadWorkspaces();
        checkProviderHealth();
      } else if (targetId === 'audit-view') {
        fetchAuditEntries();
      }
    });
  });

  // Reconnect button
  enginePill.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'RECONNECT_ENGINE' });
    engineStatusText.textContent = 'CONNECTING...';
  });

  // Emergency Stop Button
  emergencyStopBtn.addEventListener('click', () => {
    triggerEmergencyStop();
  });

  // Model switch synchronizes with settings
  modelSelect.addEventListener('change', () => {
    chrome.storage.local.set({ selectedProvider: modelSelect.value });
    if (settingProvider) settingProvider.value = modelSelect.value;
    appendSystemNotice(`Active provider switched to: ${modelSelect.options[modelSelect.selectedIndex].text}`);
    recordMessage({ type: 'system', content: `Switched provider to ${modelSelect.value}` });
  });

  // --- 2. Persistent Conversation History (Phase Thirteen) ---

  function loadConversations() {
    chrome.storage.local.get(['conversations', 'activeConversationId'], (res) => {
      conversations = res.conversations || {};
      activeConversationId = res.activeConversationId || null;

      // Ensure at least one conversation exists
      if (!activeConversationId || !conversations[activeConversationId]) {
        const initialId = `conv_${Date.now()}`;
        conversations[initialId] = {
          id: initialId,
          title: 'Initial Session',
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
    // Retention limits: cap total stored sessions to prevent unbounded storage growth
    const convKeys = Object.keys(conversations);
    if (convKeys.length > 30) {
      const sorted = Object.values(conversations).sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
      const toDelete = sorted.slice(0, convKeys.length - 30);
      toDelete.forEach(c => {
        if (c.id !== activeConversationId) {
          delete conversations[c.id];
        }
      });
    }

    chrome.storage.local.set({
      conversations,
      activeConversationId
    });
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
  }

  function renderActiveConversation() {
    chatMessages.innerHTML = '';
    const conv = conversations[activeConversationId];
    if (!conv || !conv.messages || conv.messages.length === 0) {
      if (welcomeCard) {
        chatMessages.appendChild(welcomeCard.cloneNode(true));
        attachPillListeners();
      }
      return;
    }

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

    // Bound messages per conversation to 120
    if (conv.messages.length > 120) {
      conv.messages = conv.messages.slice(-120);
    }

    conv.updatedAt = new Date().toISOString();

    // Auto title on first user message
    if (item.type === 'user' && (conv.title === 'Initial Session' || conv.title.startsWith('Task #') || conv.title.startsWith('New Task'))) {
      conv.title = item.content.slice(0, 28) + (item.content.length > 28 ? '...' : '');
      updateConversationDropdown();
    }

    saveConversations();
  }

  btnNewChat.addEventListener('click', () => {
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
  });

  conversationSelect.addEventListener('change', () => {
    activeConversationId = conversationSelect.value;
    saveConversations();
    renderActiveConversation();
  });

  btnClearChat.addEventListener('click', () => {
    if (!activeConversationId || !conversations[activeConversationId]) return;
    conversations[activeConversationId].messages = [];
    conversations[activeConversationId].updatedAt = new Date().toISOString();
    saveConversations();
    renderActiveConversation();
  });

  function attachPillListeners() {
    document.querySelectorAll('.agy-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const prompt = pill.getAttribute('data-prompt');
        userInput.value = prompt;
        handleSendPrompt();
      });
    });
  }

  // --- 3. Chat & Instruction Dispatch ---

  sendBtn.addEventListener('click', handleSendPrompt);

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendPrompt();
    }
  });

  attachPillListeners();

  // Screenshot attachment
  btnSnapScreenshot.addEventListener('click', async () => {
    try {
      btnSnapScreenshot.textContent = '⏳ Capturing...';
      const response = await chrome.runtime.sendMessage({
        action: 'DIRECT_BROWSER_ACTION',
        browserCommand: 'capture_screenshot'
      });
      if (response && response.result?.screenshot) {
        attachedScreenshot = response.result.screenshot;
        btnSnapScreenshot.textContent = '✓ Tab Attached';
        btnSnapScreenshot.classList.add('active');
      } else {
        btnSnapScreenshot.textContent = '❌ Failed';
      }
    } catch (e) {
      console.warn('Screenshot capture failed', e);
      btnSnapScreenshot.textContent = '📸 Capture Tab';
    }
  });

  async function handleSendPrompt() {
    const promptText = userInput.value.trim();
    if (!promptText || isProcessing) return;

    userInput.value = '';
    userInput.style.height = 'auto';

    // Remove welcome card on first message if present
    const existingWelcome = document.getElementById('welcome-card');
    if (existingWelcome) existingWelcome.remove();

    // Add user message to UI & persist
    appendUserMessage(promptText, attachedScreenshot);

    isProcessing = true;
    showAgentStatus('Gathering page context & planning...');

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
        btnSnapScreenshot.textContent = '📸 Capture Tab';
        btnSnapScreenshot.classList.remove('active');
      }

      // Capture the initiating conversation ID so late-arriving responses or background execution
      // stay strictly associated with this conversation even if the user switches views
      const taskConversationId = activeConversationId;

      // Check if Local Engine is connected
      if (isConnected) {
        // Send full task to Local Engine with initiating conversationId
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
        // Run fallback autonomous action directly in extension
        runDirectFallbackAgent(promptText, context, taskConversationId);
      }
    } catch (err) {
      appendAgentMessage(`⚠️ Error executing prompt: ${err.message}`);
      hideAgentStatus();
      isProcessing = false;
    }
  }

  // --- 4. Message Stream Handling from Engine ---

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
          hideAgentStatus();
          isProcessing = false;
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
          hideAgentStatus();
          isProcessing = false;
        }
        if (msg.summary) {
          appendAgentMessage(msg.summary, targetConvId);
          speakTextIfEnabled(msg.summary);
        }
        break;
    }
  });

  // Direct Browser Fallback Agent (for zero-config offline mode)
  async function runDirectFallbackAgent(prompt, context) {
    showAgentStatus('Autonomous Engine: Analyzing browser action...');
    await delay(350);

    const lower = prompt.toLowerCase();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (lower.includes('summarize') || lower.includes('summary')) {
      if (!tab?.id) {
        appendAgentMessage('No active tab found to summarize.');
        hideAgentStatus();
        isProcessing = false;
        return;
      }
      const textRes = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_TEXT' });
      if (textRes && textRes.content) {
        const lines = textRes.content.split('\n').filter(l => l.length > 20).slice(0, 5);
        appendAgentMessage(`### 📑 Page Summary: ${textRes.title}\n\n**URL**: ${textRes.url}\n\n**Key Highlights**:\n` +
          lines.map(l => `- ${l}`).join('\n') +
          `\n\n*(Tip: Connect the Local Engine for full multi-step desktop & multi-tab control)*`);
      } else {
        appendAgentMessage('Could not extract text from this page.');
      }
    } else if (lower.includes('label') || lower.includes('highlight') || lower.includes('buttons')) {
      if (!tab?.id) return;
      const res = await chrome.tabs.sendMessage(tab.id, { action: 'LABEL_INTERACTIVE' });
      appendAgentMessage(`🎯 Labeled **${res.labeledCount || 0}** interactive elements directly on the active webpage.`);
    } else if (lower.includes('click')) {
      const words = lower.replace('click', '').trim();
      const res = await chrome.tabs.sendMessage(tab.id, { action: 'CLICK_ELEMENT', target: words });
      appendAgentMessage(`✓ Clicked element matching "${words}". Tag: ${res.tagName}, Text: "${res.text}"`);
    } else if (lower.includes('screenshot') || lower.includes('capture')) {
      await chrome.runtime.sendMessage({ action: 'DIRECT_BROWSER_ACTION', browserCommand: 'capture_screenshot' });
      appendAgentMessage(`📸 Tab screenshot captured successfully.`);
    } else {
      appendAgentMessage(`💡 **Instruction Received**: "${prompt}"\n\nTo unlock deep multi-step automation (filesystem editing, terminal commands, test runners, and multi-tab workflows), please start the **Local Agent Engine**:\n\`npm run start:engine\``);
    }

    hideAgentStatus();
    isProcessing = false;
  }

  // --- 5. Approvals & Security System (Phase Ten) ---

  function handleNewApproval(req) {
    const { approvalId, actionType, tool, details, riskLevel } = req;
    pendingApprovals.set(approvalId, req);
    updateApprovalsBadge();

    // Auto switch to Approvals tab
    const approvalsTab = document.querySelector('.agy-tab[data-tab="approvals-view"]');
    if (approvalsTab) approvalsTab.click();

    // Remove empty state if present
    const emptyState = approvalsList.querySelector('.agy-empty-state');
    if (emptyState) emptyState.remove();

    const card = document.createElement('div');
    card.className = 'agy-approval-card';
    card.id = `approval-${approvalId}`;

    let previewContent = '';
    if (details.content !== undefined) {
      previewContent = `<pre class="agy-approval-details" style="max-height:120px;color:#A7F3D0;">${escapeHtml(details.content)}</pre>`;
    } else if (details.targetContent !== undefined) {
      previewContent = `<div style="font-size:10.5px;color:#9CA3AF;margin-top:4px;">Replacing:</div>
      <pre class="agy-approval-details" style="color:#FCA5A5;">${escapeHtml(details.targetContent)}</pre>
      <div style="font-size:10.5px;color:#9CA3AF;">With:</div>
      <pre class="agy-approval-details" style="color:#A7F3D0;">${escapeHtml(details.replacementContent)}</pre>`;
    } else {
      previewContent = `<pre class="agy-approval-details">${escapeHtml(JSON.stringify(details, null, 2))}</pre>`;
    }

    card.innerHTML = `
      <div class="agy-approval-header">
        <span class="agy-risk-badge ${riskLevel || 'medium'}">${(riskLevel || 'MEDIUM')} RISK</span>
        <span style="font-size:11px;color:#9CA3AF;">${tool}</span>
      </div>
      <div style="font-size:12px;font-weight:600;color:#FFF;margin-top:2px;">${actionType}</div>
      ${previewContent}
      <div class="agy-approval-actions">
        <button class="agy-btn-approve" data-id="${approvalId}">Authorize Action</button>
        <button class="agy-btn-deny" data-id="${approvalId}">Deny</button>
      </div>
    `;

    card.querySelector('.agy-btn-approve').addEventListener('click', () => {
      resolveApproval(approvalId, true);
      card.remove();
    });

    card.querySelector('.agy-btn-deny').addEventListener('click', () => {
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
    } else {
      approvalsCountBadge.style.display = 'none';
    }
  }

  // --- 6. Emergency Stop (Phase Eleven) ---

  function triggerEmergencyStop() {
    console.warn('[Antigravity] EMERGENCY STOP TRIGGERED BY USER');
    chrome.runtime.sendMessage({
      action: 'SEND_ENGINE_MESSAGE',
      payload: { type: 'EMERGENCY_STOP' }
    });

    // Clear highlights on active tab
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_HIGHLIGHTS' });
      }
    });

    hideAgentStatus();
    isProcessing = false;
    appendSystemNotice('🛑 EMERGENCY STOP ACTIVATED. All agent operations, child terminal processes, and automations halted.');
    recordMessage({ type: 'system', content: '🛑 EMERGENCY STOP ACTIVATED.' });
    addAuditEntry('EMERGENCY_STOP', 'EXECUTED', { triggeredBy: 'user' });
    speakTextIfEnabled('Emergency stop activated.');
  }

  // --- 7. Voice Dictation (Phase Fourteen) ---

  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRecognition = new SpeechClass();
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'en-US';

    speechRecognition.onstart = () => {
      isListeningVoice = true;
      voiceBtn.classList.add('recording');
      voiceStateHint.style.display = 'inline';
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
        voiceStateHint.textContent = `"${interim}"`;
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
      } else {
        speechRecognition.start();
      }
    });
  } else {
    voiceBtn.style.opacity = '0.4';
    voiceBtn.title = 'Web Speech API not supported in this browser';
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

  // --- 8. UI Rendering Helpers & DOM Creators ---

  function appendUserMessage(text, screenshot = null) {
    appendUserMessageDom(text, screenshot);
    recordMessage({ type: 'user', content: text, screenshot });
  }

  function appendUserMessageDom(text, screenshot = null) {
    const msg = document.createElement('div');
    msg.className = 'agy-msg user';
    let content = `<div class="agy-msg-bubble">${escapeHtml(text)}`;
    if (screenshot) {
      content += `<div style="margin-top:6px;"><img src="${screenshot}" style="max-width:100%;border-radius:6px;border:1px solid rgba(255,255,255,0.2);" alt="Captured Tab"></div>`;
    }
    content += `</div>`;
    msg.innerHTML = content;
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
    const msg = document.createElement('div');
    msg.className = 'agy-msg agent';
    msg.innerHTML = `<div class="agy-msg-bubble">${formatMarkdown(text)}</div>`;
    chatMessages.appendChild(msg);
    currentStreamingBubble = null;
    scrollChat();
  }

  function streamAgentChunk(chunk, targetConvId = null) {
    if ((targetConvId || activeConversationId) !== activeConversationId) return;
    if (!currentStreamingBubble) {
      const msg = document.createElement('div');
      msg.className = 'agy-msg agent';
      const bubble = document.createElement('div');
      bubble.className = 'agy-msg-bubble';
      msg.appendChild(bubble);
      chatMessages.appendChild(msg);
      currentStreamingBubble = bubble;
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
    const card = document.createElement('div');
    card.className = 'agy-step-card';
    card.style.borderLeftColor = '#7928CA';
    card.innerHTML = `
      <div class="agy-step-header" style="color:#C084FC;">
        <span>🧠 Agent Reasoning</span>
      </div>
      <div style="font-size:11.5px;color:#D8B4FE;line-height:1.4;">${escapeHtml(thought)}</div>
    `;
    chatMessages.appendChild(card);
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
    card.className = 'agy-step-card';
    card.id = `step-${Date.now()}`;
    card.innerHTML = `
      <div class="agy-step-header">
        <span>⚡ Executing: ${tool}</span>
        <span class="agy-spinner"></span>
      </div>
      <div class="agy-step-details">${escapeHtml(JSON.stringify(params, null, 2))}</div>
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
    const lastCard = chatMessages.querySelector('.agy-step-card:last-child');
    if (lastCard) {
      const spinner = lastCard.querySelector('.agy-spinner');
      if (spinner) spinner.remove();

      const statusSpan = document.createElement('span');
      statusSpan.style.fontSize = '10px';
      statusSpan.style.fontWeight = 'bold';
      statusSpan.style.color = error ? '#FF2E63' : '#00E676';
      statusSpan.textContent = error ? 'FAILED' : 'SUCCESS';
      lastCard.querySelector('.agy-step-header').appendChild(statusSpan);
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
    noticeEl.style.color = '#9CA3AF';
    noticeEl.style.textAlign = 'center';
    noticeEl.style.margin = '6px 0';
    noticeEl.style.padding = '4px 8px';
    noticeEl.style.background = 'rgba(255,255,255,0.03)';
    noticeEl.style.borderRadius = '4px';
    noticeEl.textContent = notice;
    chatMessages.appendChild(noticeEl);
    scrollChat();
  }

  function showAgentStatus(label) {
    agentStatusPill.style.display = 'flex';
    agentStatusLabel.textContent = label;
  }

  function hideAgentStatus() {
    agentStatusPill.style.display = 'none';
  }

  function scrollChat() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // --- 9. Audit Logging (Phase Twelve) ---

  function addAuditEntry(action, status, details) {
    const emptyState = auditList.querySelector('.agy-empty-state');
    if (emptyState) emptyState.remove();

    const time = new Date().toLocaleTimeString();
    const item = document.createElement('div');
    item.className = 'agy-audit-item';
    item.innerHTML = `
      <div class="agy-audit-top">
        <span class="agy-audit-type">${action}</span>
        <span class="agy-audit-time">${time}</span>
      </div>
      <div class="agy-audit-desc">Status: <strong>${status}</strong></div>
      <pre class="agy-step-details">${escapeHtml(JSON.stringify(details, null, 2))}</pre>
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
              item.className = 'agy-audit-item';
              item.innerHTML = `
                <div class="agy-audit-top">
                  <span class="agy-audit-type">${entry.action} ${entry.tool ? `(${entry.tool})` : ''}</span>
                  <span class="agy-audit-time">${new Date(entry.timestamp).toLocaleTimeString()}</span>
                </div>
                <div class="agy-audit-desc">Status: <strong>${entry.status}</strong> | Risk: ${entry.riskLevel}</div>
                <pre class="agy-step-details">${escapeHtml(JSON.stringify(entry.params || entry.result || entry.error || {}, null, 2))}</pre>
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
      <div class="agy-empty-state">
        <div class="agy-shield-icon">📜</div>
        <h4>Audit Log Cleared</h4>
      </div>
    `;
  });

  // --- 10. Workspaces & Provider Health Management (Phase Six & Four) ---

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
          workspacesList.innerHTML = `<div style="font-size:11px;color:#9CA3AF;padding:4px;">Start local engine to manage workspaces.</div>`;
        }
      } catch (e) {
        workspacesList.innerHTML = `<div style="font-size:11px;color:#9CA3AF;padding:4px;">Offline. Start engine to view workspaces.</div>`;
      }
    });
  }

  function renderWorkspaces(workspaces) {
    workspacesList.innerHTML = '';
    if (!workspaces || workspaces.length === 0) {
      workspacesList.innerHTML = `
        <div style="font-size:11px;color:#FFB800;padding:6px;background:rgba(255,184,0,0.1);border-radius:4px;border:1px dashed #FFB800;">
          ⚠️ No approved workspaces. Filesystem and terminal operations are completely locked down until you approve a workspace directory below.
        </div>
      `;
      return;
    }

    workspaces.forEach(wsPath => {
      const item = document.createElement('div');
      item.className = 'agy-workspace-item';
      item.innerHTML = `
        <span class="agy-workspace-path" title="${escapeHtml(wsPath)}">${escapeHtml(wsPath)}</span>
        <button class="agy-workspace-del" title="Remove workspace scope">&times;</button>
      `;
      item.querySelector('.agy-workspace-del').addEventListener('click', async () => {
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
            <div><strong>Gemini:</strong> ${p.gemini?.configured ? '<span style="color:#00E676;">Configured</span>' : '<span style="color:#9CA3AF;">Missing Key</span>'}</div>
            <div><strong>Claude:</strong> ${p.anthropic?.configured ? '<span style="color:#00E676;">Configured</span>' : '<span style="color:#9CA3AF;">Missing Key</span>'}</div>
            <div><strong>OpenAI:</strong> ${p.openai?.configured ? '<span style="color:#00E676;">Configured</span>' : '<span style="color:#9CA3AF;">Missing Key</span>'}</div>
            <div><strong>Ollama:</strong> ${p.ollama?.healthy ? '<span style="color:#00E676;">Online (' + p.ollama.model + ')</span>' : '<span style="color:#FF2E63;">Offline</span>'}</div>
            <div><strong>Autonomous Engine:</strong> <span style="color:#00F2FE;">Ready (Built-in)</span></div>
          `;
        } else {
          providerHealthBadge.innerHTML = `<span style="color:#9CA3AF;">Connect to Local Engine to inspect provider status.</span>`;
        }
      } catch (e) {
        providerHealthBadge.innerHTML = `<span style="color:#9CA3AF;">Local Engine offline.</span>`;
      }
    });
  }

  // --- 11. Engine Health & Status Management ---

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
      enginePill.className = 'agy-status-pill connected';
      engineStatusText.textContent = `ONLINE :${port}`;
    } else if (authFailed) {
      enginePill.className = 'agy-status-pill error';
      engineStatusText.textContent = 'AUTH FAILED';
      if (error) {
        appendSystemNotice(`⚠️ ${error}`);
      }
    } else {
      enginePill.className = 'agy-status-pill disconnected';
      engineStatusText.textContent = 'OFFLINE';
    }
  }

  async function refreshActiveTabContext() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      pageTitleText.textContent = tab.title || tab.url || 'Active Tab';
      pageTitleText.title = tab.url || '';
    }
  }

  chrome.tabs.onActivated.addListener(() => {
    refreshActiveTabContext();
  });

  // --- 12. Settings Storage & Engine Synchronization ---

  // Ephemeral First-Run Pairing Handler
  if (btnPairEngine) {
    btnPairEngine.addEventListener('click', async () => {
      const pairingCode = settingPairingCode ? settingPairingCode.value.trim() : '';
      if (!pairingCode) {
        if (pairingHint) {
          pairingHint.textContent = 'Please enter the 6-character code from the engine console.';
          pairingHint.style.color = '#FF2E63';
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
            pairingHint.style.color = '#00E676';
            pairingHint.style.display = 'block';
          }
          chrome.runtime.sendMessage({ action: 'RECONNECT_ENGINE' });
          setTimeout(checkEngineStatus, 800);
          setTimeout(checkProviderHealth, 1000);
          setTimeout(loadWorkspaces, 1000);
        } else {
          if (pairingHint) {
            pairingHint.textContent = `Pairing failed: ${data.error || 'Invalid code'}`;
            pairingHint.style.color = '#FF2E63';
            pairingHint.style.display = 'block';
          }
        }
      } catch (err) {
        if (pairingHint) {
          pairingHint.textContent = `Engine unreachable at port ${port}. Ensure engine is running.`;
          pairingHint.style.color = '#FF2E63';
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
      const provider = res.selectedProvider || 'hybrid';
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

      // Query engine for masked settings status if token is present
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

      // Authenticated Settings Synchronization to Local Engine
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/config`, {
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

        if (resp.ok) {
          settingsSavedHint.textContent = 'Settings saved and applied to Local Engine!';
          settingsSavedHint.style.color = '#00E676';
        } else {
          settingsSavedHint.textContent = 'Saved in browser (Local Engine offline/unauthenticated).';
          settingsSavedHint.style.color = '#FFB800';
        }
      } catch (err) {
        settingsSavedHint.textContent = 'Saved in browser (Local Engine unreachable).';
        settingsSavedHint.style.color = '#FFB800';
      }

      settingsSavedHint.style.display = 'block';
      setTimeout(() => { settingsSavedHint.style.display = 'none'; }, 3000);
      chrome.runtime.sendMessage({ action: 'RECONNECT_ENGINE' });
      checkProviderHealth();
    });
  });

  // Utilities
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
    return text
      .replace(/### (.*?)(\n|$)/g, '<h4 style="color:#00F2FE;margin:6px 0;">$1</h4>')
      .replace(/## (.*?)(\n|$)/g, '<h3 style="color:#00F2FE;margin:8px 0;">$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/```([\s\S]*?)```/g, '<pre style="background:rgba(0,0,0,0.5);padding:6px;border-radius:4px;overflow-x:auto;color:#E2E8F0;font-size:11px;">$1</pre>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.4);padding:1px 4px;border-radius:3px;color:#00F2FE;">$1</code>')
      .replace(/\n/g, '<br>');
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
});
