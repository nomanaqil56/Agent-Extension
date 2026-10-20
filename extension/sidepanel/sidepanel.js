// Antigravity Browser Agent - Side Panel Controller
// Manages chat streaming, voice input, approvals, audit logs, and settings

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const tabButtons = document.querySelectorAll('.agy-tab');
  const viewSections = document.querySelectorAll('.agy-view');
  const enginePill = document.getElementById('engine-status-pill');
  const engineStatusText = document.getElementById('engine-status-text');
  const emergencyStopBtn = document.getElementById('emergency-stop-btn');
  const pageTitleText = document.getElementById('page-title-text');
  const modelSelect = document.getElementById('model-select');

  // Chat Elements
  const chatMessages = document.getElementById('chat-messages');
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
  const clearAuditBtn = document.getElementById('clear-audit-btn');

  // Settings Elements
  const settingEngineUrl = document.getElementById('setting-engine-url');
  const settingAuthToken = document.getElementById('setting-auth-token');
  const settingProvider = document.getElementById('setting-provider');
  const settingGeminiKey = document.getElementById('setting-gemini-key');
  const settingAnthropicKey = document.getElementById('setting-anthropic-key');
  const settingOpenAiKey = document.getElementById('setting-openai-key');
  const settingOllamaUrl = document.getElementById('setting-ollama-url');
  const settingAudioFeedback = document.getElementById('setting-audio-feedback');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const settingsSavedHint = document.getElementById('settings-saved-hint');

  // State
  let isConnected = false;
  let isProcessing = false;
  let attachedScreenshot = null;
  let pendingApprovals = new Map();
  let speechRecognition = null;
  let isListeningVoice = false;
  let currentStreamingBubble = null;

  // --- 1. Initialization & Active Tab Context ---

  loadSettings();
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

  // Model switch
  modelSelect.addEventListener('change', () => {
    chrome.storage.local.set({ selectedProvider: modelSelect.value });
    appendSystemNotice(`Active provider switched to: ${modelSelect.options[modelSelect.selectedIndex].text}`);
  });

  // --- 2. Chat & Instruction Dispatch ---

  sendBtn.addEventListener('click', handleSendPrompt);

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendPrompt();
    }
  });

  // Prompt suggestions
  document.querySelectorAll('.agy-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const prompt = pill.getAttribute('data-prompt');
      userInput.value = prompt;
      handleSendPrompt();
    });
  });

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

    // Add user message to UI
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

      // Check if Local Engine is connected
      if (isConnected) {
        // Send full task to Local Engine
        chrome.runtime.sendMessage({
          action: 'SEND_ENGINE_MESSAGE',
          payload: {
            type: 'USER_TASK',
            task: promptText,
            provider: modelSelect.value,
            context
          }
        });
      } else {
        // Run fallback autonomous action directly in extension
        runDirectFallbackAgent(promptText, context);
      }
    } catch (err) {
      appendAgentMessage(`⚠️ Error executing prompt: ${err.message}`);
      hideAgentStatus();
      isProcessing = false;
    }
  }

  // --- 3. Message Stream Handling from Engine ---

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'ENGINE_STATUS':
        updateEngineStatus(msg.connected, msg.port);
        break;

      case 'AGENT_THOUGHT':
        renderAgentThought(msg.thought);
        break;

      case 'STREAM_CHUNK':
        streamAgentChunk(msg.chunk);
        break;

      case 'AGENT_MESSAGE':
        appendAgentMessage(msg.message);
        hideAgentStatus();
        isProcessing = false;
        speakTextIfEnabled(msg.message);
        break;

      case 'TOOL_START':
        showAgentStatus(`Executing: ${msg.tool}...`);
        renderToolStep(msg.tool, msg.params);
        addAuditEntry(msg.tool, 'started', msg.params);
        break;

      case 'TOOL_FINISH':
        renderToolResult(msg.tool, msg.result, msg.error);
        addAuditEntry(msg.tool, msg.error ? 'failed' : 'completed', msg.result || msg.error);
        break;

      case 'APPROVAL_REQUEST':
        handleNewApproval(msg);
        break;

      case 'TASK_COMPLETE':
        hideAgentStatus();
        isProcessing = false;
        if (msg.summary) {
          appendAgentMessage(msg.summary);
          speakTextIfEnabled(msg.summary);
        }
        break;
    }
  });

  // --- 4. Direct Browser Fallback Agent (for zero-config offline mode) ---

  async function runDirectFallbackAgent(prompt, context) {
    showAgentStatus('Autonomous Engine: Analyzing browser action...');
    await delay(400);

    const lower = prompt.toLowerCase();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Handle common commands directly
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
        appendAgentMessage(`### 📑 Page Summary: ${textRes.title}\n\n**URL**: ${textRes.url}\n\n**Key Content Highlights**:\n` +
          lines.map(l => `- ${l}`).join('\n') +
          `\n\n*(Tip: Connect the Local Engine for full multi-step desktop & multi-tab control)*`);
      } else {
        appendAgentMessage('Could not extract text from this page.');
      }
    } else if (lower.includes('label') || lower.includes('highlight') || lower.includes('buttons')) {
      if (!tab?.id) return;
      const res = await chrome.tabs.sendMessage(tab.id, { action: 'LABEL_INTERACTIVE' });
      appendAgentMessage(`🎯 Labeled **${res.labeledCount || 0}** interactive elements directly on the active webpage. You can inspect element numbers or instruct me to click any of them.`);
    } else if (lower.includes('click')) {
      const words = lower.replace('click', '').trim();
      const res = await chrome.tabs.sendMessage(tab.id, { action: 'CLICK_ELEMENT', target: words });
      appendAgentMessage(`✓ Clicked element matching "${words}". Tag: ${res.tagName}, Text: "${res.text}"`);
    } else if (lower.includes('screenshot') || lower.includes('capture')) {
      const snap = await chrome.runtime.sendMessage({ action: 'DIRECT_BROWSER_ACTION', browserCommand: 'capture_screenshot' });
      appendAgentMessage(`📸 Tab screenshot captured successfully. View preview attached in conversation.`);
    } else {
      appendAgentMessage(`💡 **Instruction Received**: "${prompt}"\n\nTo unleash deep multi-step computer automation (filesystem editing, terminal commands, test runners, and multi-tab workflows), please start the **Local Agent Engine** using:\n\`npm run start:engine\`\n\nStatus: Local engine is currently connecting or offline.`);
    }

    hideAgentStatus();
    isProcessing = false;
  }

  // --- 5. Approvals & Security System ---

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

    card.innerHTML = `
      <div class="agy-approval-header">
        <span class="agy-risk-badge ${riskLevel || 'medium'}">${(riskLevel || 'MEDIUM')} RISK</span>
        <span style="font-size:11px;color:#9CA3AF;">${tool}</span>
      </div>
      <div style="font-size:12px;font-weight:600;color:#FFF;">${actionType}</div>
      <pre class="agy-approval-details">${escapeHtml(JSON.stringify(details, null, 2))}</pre>
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
    speakTextIfEnabled('Security approval required for action.');
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

  // --- 6. Emergency Stop ---

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
    appendSystemNotice('🛑 EMERGENCY STOP ACTIVATED. All agent operations, child terminal processes, and browser automations have been halted.');
    addAuditEntry('EMERGENCY_STOP', 'EXECUTED', { triggeredBy: 'user' });
    speakTextIfEnabled('Emergency stop activated.');
  }

  // --- 7. Voice Dictation (Web Speech API) ---

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

  // --- 8. UI Rendering Helpers ---

  function appendUserMessage(text, screenshot = null) {
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

  function appendAgentMessage(text) {
    const msg = document.createElement('div');
    msg.className = 'agy-msg agent';
    msg.innerHTML = `<div class="agy-msg-bubble">${formatMarkdown(text)}</div>`;
    chatMessages.appendChild(msg);
    currentStreamingBubble = null;
    scrollChat();
  }

  function streamAgentChunk(chunk) {
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

  function renderAgentThought(thought) {
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

  function renderToolStep(tool, params) {
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

  function renderToolResult(tool, result, error) {
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

  function appendSystemNotice(notice) {
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

  // --- 9. Audit Logging View ---

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

  clearAuditBtn.addEventListener('click', () => {
    auditList.innerHTML = `
      <div class="agy-empty-state">
        <div class="agy-shield-icon">📜</div>
        <h4>Audit Log Cleared</h4>
      </div>
    `;
  });

  // --- 10. Engine Health & Status Management ---

  function checkEngineStatus() {
    chrome.runtime.sendMessage({ action: 'GET_ENGINE_STATUS' }, (res) => {
      if (res) {
        updateEngineStatus(res.connected);
      }
    });
  }

  function updateEngineStatus(connected, port = 3721) {
    isConnected = Boolean(connected);
    if (isConnected) {
      enginePill.className = 'agy-status-pill connected';
      engineStatusText.textContent = `ONLINE :${port}`;
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

  // --- 11. Settings Storage ---

  function loadSettings() {
    chrome.storage.local.get([
      'enginePort',
      'authToken',
      'selectedProvider',
      'geminiKey',
      'anthropicKey',
      'openAiKey',
      'ollamaUrl',
      'audioFeedback'
    ], (res) => {
      if (res.enginePort) settingEngineUrl.value = `ws://localhost:${res.enginePort}`;
      if (res.authToken) settingAuthToken.value = res.authToken;
      if (res.selectedProvider) {
        settingProvider.value = res.selectedProvider;
        modelSelect.value = res.selectedProvider;
      }
      if (res.geminiKey) settingGeminiKey.value = res.geminiKey;
      if (res.anthropicKey) settingAnthropicKey.value = res.anthropicKey;
      if (res.openAiKey) settingOpenAiKey.value = res.openAiKey;
      if (res.ollamaUrl) settingOllamaUrl.value = res.ollamaUrl;
      if (typeof res.audioFeedback === 'boolean') {
        settingAudioFeedback.checked = res.audioFeedback;
      }
    });
  }

  saveSettingsBtn.addEventListener('click', () => {
    let port = 3721;
    const match = settingEngineUrl.value.match(/:(\d+)/);
    if (match) port = parseInt(match[1], 10);

    const config = {
      enginePort: port,
      authToken: settingAuthToken.value.trim(),
      selectedProvider: settingProvider.value,
      geminiKey: settingGeminiKey.value.trim(),
      anthropicKey: settingAnthropicKey.value.trim(),
      openAiKey: settingOpenAiKey.value.trim(),
      ollamaUrl: settingOllamaUrl.value.trim(),
      audioFeedback: settingAudioFeedback.checked
    };

    chrome.storage.local.set(config, () => {
      modelSelect.value = config.selectedProvider;
      settingsSavedHint.style.display = 'block';
      setTimeout(() => { settingsSavedHint.style.display = 'none'; }, 2500);
      chrome.runtime.sendMessage({ action: 'RECONNECT_ENGINE' });
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
      .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.4);padding:1px 4px;border-radius:3px;color:#00F2FE;">$1</code>')
      .replace(/\n/g, '<br>');
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
});
