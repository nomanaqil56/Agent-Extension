// Antigravity Browser Agent - Content Script
// Handles DOM distillation, visual action highlighting, element interaction, and page context

(() => {
  if (window.__ANTIGRAVITY_CONTENT_LOADED__) return;
  window.__ANTIGRAVITY_CONTENT_LOADED__ = true;

  console.log('[Antigravity] Content script initialized on', window.location.href);

  // Active highlights cache
  let activeHighlights = [];
  let labeledMarkers = [];

  // Listen for messages from background service worker or sidepanel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => {
        console.error('[Antigravity] Content action error:', err);
        sendResponse({ success: false, error: err.message || String(err) });
      });
    return true; // async response
  });

  async function handleMessage(msg) {
    switch (msg.action) {
      case 'GET_PAGE_CONTEXT':
        return getPageContext();

      case 'GET_SELECTION':
        return { selection: window.getSelection()?.toString().trim() || '' };

      case 'DISTILL_DOM':
        return distillInteractiveDOM(msg.maxElements || 75);

      case 'CLICK_ELEMENT':
        return clickElement(msg.target, msg.options);

      case 'FILL_ELEMENT':
        return fillElement(msg.target, msg.value, msg.options);

      case 'SCROLL_PAGE':
        return scrollPage(msg.direction, msg.amount, msg.target);

      case 'HIGHLIGHT_ELEMENT':
        return highlightTarget(msg.target, msg.label || 'TARGET');

      case 'CLEAR_HIGHLIGHTS':
        clearAllHighlights();
        return { cleared: true };

      case 'LABEL_INTERACTIVE':
        return labelInteractiveElements(msg.maxElements || 50);

      case 'CLEAR_LABELS':
        clearInteractiveLabels();
        return { cleared: true };

      case 'EXTRACT_TEXT':
        return extractPageContent();

      case 'PING':
        return { status: 'ready', url: window.location.href, title: document.title };

      default:
        throw new Error(`Unknown content action: ${msg.action}`);
    }
  }

  // --- 1. Page Context & Distillation ---

  function getPageContext() {
    const selection = window.getSelection()?.toString().trim() || '';
    return {
      title: document.title,
      url: window.location.href,
      domain: window.location.hostname,
      selection,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight
      },
      hasSelection: selection.length > 0
    };
  }

  // Distills interactive elements into clean, numbered schema for LLM reasoning
  function distillInteractiveDOM(maxElements = 75) {
    const candidates = document.querySelectorAll(
      'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
    );

    const distilled = [];
    let count = 0;

    for (const el of candidates) {
      if (count >= maxElements) break;
      if (!isElementVisible(el)) continue;

      const rect = el.getBoundingClientRect();
      const tagName = el.tagName.toLowerCase();
      const text = getElementAccessibleText(el);
      const role = el.getAttribute('role') || tagName;
      const type = el.getAttribute('type') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const selector = getUniqueSelector(el);

      count++;
      distilled.push({
        id: count,
        tag: tagName,
        type: type || undefined,
        role,
        text: text.slice(0, 80),
        placeholder: placeholder || undefined,
        href: el.getAttribute('href') || undefined,
        value: el.value !== undefined ? String(el.value).slice(0, 50) : undefined,
        checked: el.checked,
        disabled: el.disabled,
        selector,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      });
    }

    return {
      title: document.title,
      url: window.location.href,
      totalCount: count,
      elements: distilled
    };
  }

  function getElementAccessibleText(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    const title = el.getAttribute('title');
    if (title) return title.trim();

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();

    const inner = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (inner) return inner;

    const alt = el.getAttribute('alt');
    if (alt) return alt.trim();

    return '';
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    // Inside or near viewport (allow scrolling leeway)
    const inVerticalBounds = rect.bottom >= -500 && rect.top <= (window.innerHeight + 500);
    const inHorizontalBounds = rect.right >= -200 && rect.left <= (window.innerWidth + 200);
    return inVerticalBounds && inHorizontalBounds;
  }

  // --- 2. Element Locator & Selector Generation ---

  function findElement(target) {
    if (!target) return null;

    // If target is an object with selector
    if (typeof target === 'object' && target.selector) {
      try {
        const el = document.querySelector(target.selector);
        if (el) return el;
      } catch (e) {}
    }

    // If target is a string CSS selector
    if (typeof target === 'string') {
      try {
        const el = document.querySelector(target);
        if (el) return el;
      } catch (e) {}
    }

    // Try finding by text content
    const targetText = typeof target === 'string' ? target.trim().toLowerCase() : (target.text || '').toLowerCase();
    if (targetText) {
      // Find buttons/links with exact or partial match
      const clickables = document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]');
      for (const el of clickables) {
        const text = (el.innerText || el.textContent || el.value || '').trim().toLowerCase();
        if (text === targetText || text.includes(targetText)) {
          return el;
        }
      }
    }

    // If target is an ID number from distilled list
    if (typeof target === 'number' || (typeof target === 'object' && target.id)) {
      const id = typeof target === 'number' ? target : target.id;
      const marker = document.querySelector(`[data-agy-index="${id}"]`);
      if (marker && marker.__antigravityElement) {
        return marker.__antigravityElement;
      }
    }

    return null;
  }

  function getUniqueSelector(el) {
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }

    // Common descriptive attributes
    if (el.name) {
      return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    }
    if (el.getAttribute('data-testid')) {
      return `[data-testid="${CSS.escape(el.getAttribute('data-testid'))}"]`;
    }
    if (el.getAttribute('aria-label')) {
      return `[aria-label="${CSS.escape(el.getAttribute('aria-label'))}"]`;
    }

    // Hierarchy path
    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && path.length < 5) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        path.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      let sibling = current;
      let nth = 1;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === current.tagName) nth++;
      }
      if (nth > 1) {
        selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ');
  }

  // --- 3. Browser Automation Actions ---

  async function clickElement(target, options = {}) {
    const el = findElement(target);
    if (!el) {
      throw new Error(`Target element not found: ${JSON.stringify(target)}`);
    }

    // Smoothly scroll into view
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    await delay(250);

    // Visual highlight with "CLICKING" badge
    createActionHighlight(el, 'CLICKING');
    await delay(200);

    // Dispatch native sequence
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY
    };

    el.dispatchEvent(new MouseEvent('mouseenter', eventInit));
    el.dispatchEvent(new MouseEvent('mouseover', eventInit));
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));
    el.dispatchEvent(new MouseEvent('mouseup', eventInit));
    el.click();

    await delay(350);
    clearAllHighlights();

    return {
      clicked: true,
      tagName: el.tagName,
      text: getElementAccessibleText(el),
      href: el.getAttribute('href') || null
    };
  }

  async function fillElement(target, value, options = {}) {
    const el = findElement(target);
    if (!el) {
      throw new Error(`Target input element not found: ${JSON.stringify(target)}`);
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(200);

    createActionHighlight(el, 'TYPING');
    await delay(150);

    el.focus();

    // Support for contentEditable or standard input/textarea
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Clean and set value
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (options.pressEnter) {
      await delay(150);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

      // Form submit if input is in form
      if (el.form && typeof el.form.requestSubmit === 'function') {
        el.form.requestSubmit();
      }
    }

    await delay(300);
    clearAllHighlights();

    return {
      filled: true,
      valueLength: value.length,
      pressedEnter: Boolean(options.pressEnter)
    };
  }

  async function scrollPage(direction = 'down', amount = 500, target = null) {
    if (target) {
      const el = findElement(target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(300);
        return { scrolled: true, toElement: true };
      }
    }

    let deltaY = 0;
    if (direction === 'down') deltaY = amount || 500;
    else if (direction === 'up') deltaY = -(amount || 500);
    else if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await delay(350);
      return { scrolled: true, position: 'top' };
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      await delay(350);
      return { scrolled: true, position: 'bottom' };
    }

    window.scrollBy({ top: deltaY, behavior: 'smooth' });
    await delay(300);

    return {
      scrolled: true,
      deltaY,
      scrollY: window.scrollY,
      maxScroll: document.documentElement.scrollHeight
    };
  }

  function extractPageContent() {
    // Clone body and remove scripts, styles, noscript, svg, hidden
    const clone = document.body.cloneNode(true);
    const removeSelectors = ['script', 'style', 'noscript', 'svg', 'iframe', '.antigravity-action-highlight', '.antigravity-element-marker'];
    removeSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    const rawText = clone.innerText || clone.textContent || '';
    const cleanLines = rawText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    return {
      title: document.title,
      url: window.location.href,
      content: cleanLines.slice(0, 200).join('\n'), // First 200 meaningful lines
      lineCount: cleanLines.length
    };
  }

  // --- 4. Visual Action Highlights ---

  function createActionHighlight(el, badgeText = 'AGENT') {
    clearAllHighlights();
    const rect = el.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const box = document.createElement('div');
    box.className = 'antigravity-action-highlight';
    box.style.left = `${rect.left + scrollX}px`;
    box.style.top = `${rect.top + scrollY}px`;
    box.style.width = `${Math.max(rect.width, 24)}px`;
    box.style.height = `${Math.max(rect.height, 24)}px`;

    const badge = document.createElement('div');
    badge.className = 'antigravity-action-badge';
    badge.textContent = badgeText;
    box.appendChild(badge);

    document.body.appendChild(box);
    activeHighlights.push(box);
  }

  function clearAllHighlights() {
    activeHighlights.forEach(el => el.remove());
    activeHighlights = [];
  }

  function highlightTarget(target, label = 'TARGET') {
    const el = findElement(target);
    if (!el) throw new Error('Target not found for highlight');
    createActionHighlight(el, label);
    return { highlighted: true };
  }

  function labelInteractiveElements(maxCount = 50) {
    clearInteractiveLabels();
    const distilled = distillInteractiveDOM(maxCount);

    distilled.elements.forEach(item => {
      const el = findElement(item.selector);
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const marker = document.createElement('div');
      marker.className = 'antigravity-element-marker';
      marker.setAttribute('data-agy-index', String(item.id));
      marker.__antigravityElement = el;
      marker.textContent = `[${item.id}]`;
      marker.style.left = `${rect.left + window.scrollX}px`;
      marker.style.top = `${rect.top + window.scrollY - 14}px`;

      document.body.appendChild(marker);
      labeledMarkers.push(marker);
    });

    return { labeledCount: labeledMarkers.length };
  }

  function clearInteractiveLabels() {
    labeledMarkers.forEach(m => m.remove());
    labeledMarkers = [];
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
