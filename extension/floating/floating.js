// Antigravity Floating Command Center HUD Controller

document.addEventListener('DOMContentLoaded', () => {
  const hudInput = document.getElementById('hud-input');
  const hudSendBtn = document.getElementById('hud-send-btn');
  const hudVoiceBtn = document.getElementById('hud-voice-btn');
  const hudStopBtn = document.getElementById('hud-stop-btn');
  const hudCloseBtn = document.getElementById('hud-close-btn');
  const hudStatus = document.getElementById('hud-status');
  const hudStreamContainer = document.getElementById('hud-stream-container');
  const hudStepText = document.getElementById('hud-step-text');
  const hudStreamText = document.getElementById('hud-stream-text');

  let isListening = false;
  let speechRec = null;

  hudInput.focus();

  // Close HUD
  hudCloseBtn.addEventListener('click', closeHUD);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeHUD();
    }
  });

  function closeHUD() {
    window.parent.postMessage({ type: 'ANTIGRAVITY_CLOSE_HUD' }, '*');
  }

  // Quick chips
  document.querySelectorAll('.agy-quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      hudInput.value = chip.getAttribute('data-cmd');
      executeCommand();
    });
  });

  hudSendBtn.addEventListener('click', executeCommand);
  hudInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      executeCommand();
    }
  });

  // Emergency Stop
  hudStopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      action: 'SEND_ENGINE_MESSAGE',
      payload: { type: 'EMERGENCY_STOP' }
    });
    hudStatus.textContent = 'STOPPED';
    hudStatus.style.color = '#FF2E63';
    hudStepText.textContent = 'Halted by user';
  });

  async function executeCommand() {
    const text = hudInput.value.trim();
    if (!text) return;

    hudInput.value = '';
    hudStatus.textContent = 'RUNNING';
    hudStatus.style.color = '#00F2FE';
    hudStreamContainer.style.display = 'block';
    hudStepText.textContent = 'Analyzing command...';
    hudStreamText.textContent = '';

    // Route command via background
    chrome.runtime.sendMessage({
      action: 'SEND_ENGINE_MESSAGE',
      payload: {
        type: 'USER_TASK',
        task: text,
        provider: 'fallback'
      }
    }, (res) => {
      if (!res || !res.sent) {
        // Fallback directly
        hudStepText.textContent = 'Autonomous local execution:';
        runLocalFallback(text);
      }
    });
  }

  async function runLocalFallback(text) {
    const lower = text.toLowerCase();
    if (lower.includes('label') || lower.includes('highlight') || lower.includes('buttons')) {
      chrome.runtime.sendMessage({
        action: 'DIRECT_BROWSER_ACTION',
        browserCommand: 'label_interactive'
      }, (res) => {
        hudStepText.textContent = '✓ Done';
        hudStreamText.textContent = `Highlighted ${res?.result?.labeledCount || 0} interactive elements on page.`;
      });
    } else if (lower.includes('summarize')) {
      chrome.runtime.sendMessage({
        action: 'DIRECT_BROWSER_ACTION',
        browserCommand: 'extract_text'
      }, (res) => {
        hudStepText.textContent = '✓ Page Extracted';
        const lines = (res?.result?.content || '').split('\n').slice(0, 4);
        hudStreamText.textContent = lines.join('\n') || 'Content extracted.';
      });
    } else {
      hudStepText.textContent = 'Command sent';
      hudStreamText.textContent = `Instruction "${text}" dispatched to agent.`;
    }
  }

  // Listen for agent updates
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'AGENT_THOUGHT') {
      hudStepText.textContent = msg.thought;
    } else if (msg.type === 'STREAM_CHUNK') {
      hudStreamText.textContent += msg.chunk;
    } else if (msg.type === 'TOOL_START') {
      hudStepText.textContent = `⚡ Tool: ${msg.tool}`;
    } else if (msg.type === 'TASK_COMPLETE') {
      hudStatus.textContent = 'READY';
      hudStepText.textContent = '✓ Completed';
      if (msg.summary) hudStreamText.textContent = msg.summary;
    }
  });

  // Voice Dictation
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRec = new Speech();
    speechRec.continuous = false;
    speechRec.interimResults = false;

    speechRec.onresult = (e) => {
      hudInput.value = e.results[0][0].transcript;
      executeCommand();
    };

    speechRec.onend = () => {
      isListening = false;
      hudVoiceBtn.style.color = '#FFF';
    };

    hudVoiceBtn.addEventListener('click', () => {
      if (isListening) {
        speechRec.stop();
      } else {
        speechRec.start();
        isListening = true;
        hudVoiceBtn.style.color = '#00F2FE';
      }
    });
  }
});
