/**
 * cursor-agent-keepalive (workbench inject)
 * 1) 用量墙 → 等 2s → 只发一次「继续」（只点发送态，不点语音）
 * 2) 可重试错误浮层 → 点 Resume / Try again（同一次只点一次）
 * 3) 营销弹窗（如 Cursor is now on iOS）→ 自动点右上角叉号关掉
 *
 * 安装：node scripts/install-workbench-inject.mjs → Reload Window
 * 仓库：https://github.com/Luochenself/cursor-agent-keepalive
 */
(function () {
  'use strict';

  if (window.__cursorKeepaliveStop) {
    try {
      window.__cursorKeepaliveStop();
    } catch (_) {}
  }

  var CONTINUE = '\u7ee7\u7eed';
  var CFG = {
    continueText: CONTINUE,
    pollMs: 1200,
    cooldownMs: 15000,
    // 检测到额度框后，再等这么久才发「继续」（给额度恢复一点时间）
    bannerDelayMs: 2000,
    // 必须整句命中，且出现在「横幅」节点里，不能在聊天气泡里
    bannerPhrases: [
      "You've hit your usage limit",
      'Get Cursor Pro for more Agent usage',
    ],
    composerSelectors: [
      '.aislash-editor-input:not(.aislash-editor-input-readonly)',
      '.ui-prompt-input-editor__input [contenteditable="true"]',
      '.ui-prompt-input-editor__input',
      '.full-input-box [contenteditable="true"]',
      '.composer-bar [contenteditable="true"]',
      '[contenteditable="true"]',
    ],
    // 同槽位按钮：空输入=语音(realtime-voice-start)，有内容=发送(prompt-input-submit-button)
    submitSlotSelector: 'button.ui-prompt-input-submit-button, .ui-prompt-input-submit-button',
    // 写入「继续」后，等 React 把语音图标切成发送，最长等这么久
    sendReadyTimeoutMs: 1600,
    sendReadyPollMs: 50,
    resumeNeedles: ['stop the agent after', 'resume the conversation'],
    // 错误浮层才会挂的重试键（平常 DOM 里没有）→ 一出现就点
    // Cursor: extraButtons id:"resume", label Resume|Try again；UI 常为 div.hover-opacity
    retryButtonLabels: ['Resume', 'Try again', 'Retry', '重试', '恢复'],
    // 同一颗重试键只点一次；消失后再出现可再点
    retryCooldownMs: 8000,
    // 营销弹窗标题/文案（命中后找叉号）
    promoPhrases: [
      'Cursor is now on iOS',
      'Build from anywhere',
      'Kick off agents, review demos',
      'Download now',
    ],
    promoDismissCooldownMs: 4000,
  };

  var lastActionAt = 0;
  var lastReason = '';
  var actionCount = 0;
  var timer = null;
  var observer = null;
  // 首次看到额度框的时间；满 bannerDelayMs 才真正发送
  var bannerSeenAt = 0;
  var pendingSend = false;
  var submitInFlight = false;
  // 同一次额度框只发一次「继续」；框消失后才重置
  var bannerAlreadySent = false;
  var lastRetryAt = 0;
  var retryAlreadyClicked = false;
  var lastRetryKey = '';
  var lastPromoDismissAt = 0;
  var promoDismissedKey = '';

  function log() {
    try {
      console.log.apply(console, ['[keepalive]'].concat([].slice.call(arguments)));
    } catch (_) {}
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (observer) {
      try {
        observer.disconnect();
      } catch (_) {}
      observer = null;
    }
    window.__cursorKeepaliveRunning = false;
    var hud = document.getElementById('__cursor_keepalive_hud');
    if (hud) hud.remove();
    log('stopped');
  }

  window.__cursorKeepaliveRunning = true;
  window.__cursorKeepaliveStop = stop;
  window.__cursorKeepaliveReset = function () {
    lastActionAt = 0;
    bannerSeenAt = 0;
    pendingSend = false;
    submitInFlight = false;
    bannerAlreadySent = false;
    lastRetryAt = 0;
    retryAlreadyClicked = false;
    lastRetryKey = '';
    lastPromoDismissAt = 0;
    promoDismissedKey = '';
    log('cooldown reset');
  };
  window.__cursorKeepaliveStatus = function () {
    var retry = findErrorRetryAction();
    var promo = findPromoModal();
    return {
      running: true,
      lastActionAt: lastActionAt,
      lastReason: lastReason,
      actionCount: actionCount,
      banner: !!findUsageLimitBanner(),
      bannerSeenAt: bannerSeenAt,
      pendingSend: pendingSend,
      submitInFlight: submitInFlight,
      bannerAlreadySent: bannerAlreadySent,
      bannerDelayMs: CFG.bannerDelayMs,
      retry: retry ? { label: retry.label, key: retry.key } : null,
      retryAlreadyClicked: retryAlreadyClicked,
      lastRetryAt: lastRetryAt,
      promo: promo
        ? { key: promo.key, hasClose: !!promo.closeEl, text: (promo.text || '').slice(0, 60) }
        : null,
      lastPromoDismissAt: lastPromoDismissAt,
    };
  };
  window.__cursorKeepalivePing = function () {
    act(true);
    return window.__cursorKeepaliveStatus();
  };

  function ensureHud() {
    var hud = document.getElementById('__cursor_keepalive_hud');
    if (hud) return hud;
    hud = document.createElement('div');
    hud.id = '__cursor_keepalive_hud';
    hud.textContent = 'keepalive ON';
    var s = hud.style;
    s.position = 'fixed';
    s.right = '12px';
    s.bottom = '12px';
    s.zIndex = '2147483647';
    s.padding = '6px 10px';
    s.fontSize = '12px';
    s.fontFamily = 'Consolas, monospace';
    s.color = '#e8ffe8';
    s.background = 'rgba(10,110,40,.92)';
    s.border = '1px solid #4dff7a';
    s.borderRadius = '8px';
    s.pointerEvents = 'none';
    (document.body || document.documentElement).appendChild(hud);
    return hud;
  }

  function setHud(text, alert) {
    var hud = ensureHud();
    if (hud.textContent === text) return;
    hud.textContent = text;
    hud.style.background = alert ? 'rgba(140,35,15,.95)' : 'rgba(10,110,40,.92)';
    hud.style.borderColor = alert ? '#ffb080' : '#4dff7a';
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  function collectRoots(root, out, depth) {
    if (!root || depth > 6) return;
    out.push(root);
    var nodes;
    try {
      nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
    } catch (_) {
      return;
    }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.shadowRoot) collectRoots(el.shadowRoot, out, depth + 1);
      if (el.tagName === 'IFRAME') {
        try {
          if (el.contentDocument) collectRoots(el.contentDocument, out, depth + 1);
        } catch (_) {}
      }
    }
  }

  function allRoots() {
    var out = [];
    collectRoots(document, out, 0);
    return out;
  }

  function buttonLabel(el) {
    return ((el && (el.innerText || el.textContent || el.getAttribute('aria-label'))) || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function walkDeep(root, fn, depth) {
    if (!root || depth > 8) return;
    try {
      fn(root);
    } catch (_) {}
    var nodes;
    var i;
    var el;
    try {
      nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
    } catch (_) {
      return;
    }
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el.shadowRoot) walkDeep(el.shadowRoot, fn, depth + 1);
      if (el.tagName === 'IFRAME') {
        try {
          if (el.contentDocument) walkDeep(el.contentDocument, fn, depth + 1);
        } catch (_) {}
      }
    }
  }

  function isUpgradeProLabel(s) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return /^upgrade to pro$/i.test(s);
  }

  function looksLikeLimitToast(text) {
    text = (text || '').replace(/\s+/g, ' ');
    return (
      /you've hit your usage limit/i.test(text) ||
      /get cursor pro for more agent usage/i.test(text)
    );
  }

  function isUpgradeishLabel(s) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return (
      /^upgrade to pro$/i.test(s) ||
      /^upgrade$/i.test(s) ||
      /^get pro$/i.test(s) ||
      /^升级到\s*pro$/i.test(s) ||
      /^升级$/i.test(s)
    );
  }

  function looksLikeChatHistory(el) {
    if (!el || !el.closest) return false;
    try {
      return !!(
        el.closest(
          '[data-message-role], [data-message-id], .composer-human-message, .composer-ai-message, .markdown-root, .anysphere-markdown-container-root',
        ) ||
        el.closest('[class*="conversation"], [class*="chat-message"]')
      );
    } catch (_) {
      return false;
    }
  }

  /**
   * 认真实额度 toast：
   * 1) Upgrade / Upgrade to Pro 按钮 + usage limit 文案
   * 2) 或小浮层本身含 usage limit（排除聊天气泡）
   */
  function findUsageLimitBanner() {
    var found = null;
    walkDeep(document, function (root) {
      if (found) return;
      var nodes;
      var i;
      var el;
      var t;
      var rect;
      var label;
      try {
        nodes = root.querySelectorAll
          ? root.querySelectorAll('button, a, [role="button"], span, div')
          : [];
      } catch (_) {
        return;
      }
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (!visible(el)) continue;
        if (looksLikeChatHistory(el)) continue;
        label = buttonLabel(el);
        if (isUpgradeishLabel(label) || isUpgradeProLabel(label)) {
          t = nearbyParentText(el);
          if (!looksLikeLimitToast(t)) continue;
          found = el;
          return;
        }
      }
      // 回退：小浮层正文直接含额度文案（无按钮也认）
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (!visible(el)) continue;
        if (looksLikeChatHistory(el)) continue;
        t = ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim();
        if (!looksLikeLimitToast(t)) continue;
        if (t.length > 280) continue;
        rect = el.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 36) continue;
        if (rect.width > 720 || rect.height > 420) continue;
        found = el;
        return;
      }
    }, 0);
    return found;
  }

  function nearbyParentText(el) {
    var node = el;
    var hops = 0;
    var t = '';
    while (node && hops < 10) {
      t = ((node.innerText || node.textContent || '') + '').replace(/\s+/g, ' ').trim();
      if (looksLikeLimitToast(t)) return t;
      node = node.parentElement;
      hops += 1;
    }
    return t;
  }

  function isRetryActionLabel(label) {
    label = (label || '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 40) return false;
    if (/upgrade|pro|升级|copy request/i.test(label)) return false;
    for (var i = 0; i < CFG.retryButtonLabels.length; i++) {
      var needle = CFG.retryButtonLabels[i].replace(/\s+/g, '\\s+');
      // 允许「Resume ▾」这类带箭头后缀
      if (new RegExp('^' + needle + '(\\s*[\\u25BE\\u25BC\\u25B2▼▲▾▴]?)?$', 'i').test(label)) {
        return true;
      }
      if (new RegExp('^' + needle + '\\b', 'i').test(label) && label.length <= 16) {
        return true;
      }
    }
    return false;
  }

  /** 仅排除消息气泡正文；错误条在 conversation 面板内，不能用 class*=conversation 误杀 */
  function looksLikeMessageBubble(el) {
    if (!el || !el.closest) return false;
    try {
      return !!el.closest(
        '[data-message-role], [data-message-id], .composer-human-message, .composer-ai-message, .markdown-root, .anysphere-markdown-container-root',
      );
    } catch (_) {
      return false;
    }
  }

  function looksLikeRetryableErrorText(text) {
    text = (text || '').replace(/\s+/g, ' ');
    return (
      /internal\s*error/i.test(text) ||
      /unexpected error occurred on our servers/i.test(text) ||
      /copy request/i.test(text) ||
      /connection (?:failed|error|lost|closed)/i.test(text) ||
      /try again/i.test(text) ||
      /agent.*(?:stopped|interrupted|error)/i.test(text)
    );
  }

  function findRetryableErrorPanel() {
    var found = null;
    walkDeep(document, function (root) {
      if (found) return;
      var nodes;
      var i;
      var el;
      var t;
      var rect;
      try {
        nodes = root.querySelectorAll ? root.querySelectorAll('div, section, aside, li') : [];
      } catch (_) {
        return;
      }
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (!visible(el)) continue;
        if (looksLikeMessageBubble(el)) continue;
        t = ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim();
        if (!looksLikeRetryableErrorText(t)) continue;
        if (t.length > 600) continue;
        rect = el.getBoundingClientRect();
        if (rect.width < 160 || rect.height < 28) continue;
        if (rect.width > 960 || rect.height > 280) continue;
        // 优先更小的错误条（真正的 toast），不是整页
        if (!found || rect.height < found.rect.height) {
          found = { el: el, rect: rect, text: t };
        }
      }
    }, 0);
    return found ? found.el : null;
  }

  function scoreRetryCandidate(el, label, panel) {
    var score = 1;
    if (
      (el.getAttribute && el.getAttribute('data-id') === 'resume') ||
      el.id === 'resume'
    ) {
      score += 10;
    }
    if (el.classList && el.classList.contains('hover-opacity')) score += 8;
    if (/^resume/i.test(label)) score += 6;
    if (/^try\s*again/i.test(label)) score += 5;
    if (panel && panel.contains && panel.contains(el)) score += 20;
    try {
      if (getComputedStyle(el).cursor === 'pointer') score += 2;
    } catch (_) {}
    return score;
  }

  /**
   * 一出现就点：错误条上的 div.hover-opacity「Resume」/「Try again」（Solid 绑 click）。
   * 注意：浮层挂在 Agent conversation 面板里，绝不能用 class*=conversation 整段跳过。
   */
  function findErrorRetryAction() {
    var panel = findRetryableErrorPanel();
    var bestScore = -1;
    var best = null;

    function considerRoot(root) {
      var nodes;
      var i;
      var el;
      var label;
      var score;
      try {
        nodes = root.querySelectorAll
          ? root.querySelectorAll(
              'button, a, [role="button"], .hover-opacity, [data-id="resume"], [id="resume"], div[style*="cursor"]',
            )
          : [];
      } catch (_) {
        return;
      }
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (!visible(el)) continue;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        // 只跳过消息气泡里的假 Resume；错误条本身要保留
        if (looksLikeMessageBubble(el) && !(panel && panel.contains(el))) continue;
        label = buttonLabel(el);
        if (!isRetryActionLabel(label)) continue;
        // 若已定位错误条，优先只要条内按钮
        if (panel && !panel.contains(el)) {
          // 仍保留全局候选，但分低
        }
        score = scoreRetryCandidate(el, label, panel);
        if (score > bestScore) {
          bestScore = score;
          best = { el: el, label: label, key: label + '@' + Math.round(el.getBoundingClientRect().top) };
        }
      }
    }

    if (panel) considerRoot(panel);
    walkDeep(document, function (root) {
      considerRoot(root);
    }, 0);

    return best;
  }

  function fireClick(el) {
    if (!el) return false;
    var opts = { bubbles: true, cancelable: true, view: window, composed: true };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', opts));
    } catch (_) {}
    try {
      el.dispatchEvent(new PointerEvent('pointerup', opts));
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent('mouseup', opts));
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent('click', opts));
    } catch (_) {}
    try {
      if (typeof el.click === 'function') el.click();
    } catch (_) {}
    return true;
  }

  function looksLikePromoText(text) {
    text = (text || '').replace(/\s+/g, ' ');
    if (!text) return false;
    for (var i = 0; i < CFG.promoPhrases.length; i++) {
      if (text.indexOf(CFG.promoPhrases[i]) >= 0) return true;
    }
    return /Cursor is now on iOS/i.test(text);
  }

  function isCloseControl(el) {
    if (!el || !visible(el)) return false;
    var tag = (el.tagName || '').toLowerCase();
    var role = (el.getAttribute && el.getAttribute('role')) || '';
    var label = (
      (el.getAttribute &&
        (el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.getAttribute('data-testid') ||
          '')) ||
      ''
    ).toLowerCase();
    var text = ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim();
    if (/close|dismiss|关闭|关掉|cancel/i.test(label)) return true;
    if (/^(×|✕|✖|x|X|⨯)$/.test(text)) return true;
    if (tag === 'button' || role === 'button' || (el.getAttribute && el.getAttribute('tabindex') != null)) {
      if (text.length <= 2 && /[×✕✖xX⨯]/.test(text)) return true;
    }
    try {
      var cls = String(el.className || '');
      if (/codicon-close|dialog-close|modal-close|btn-close|close-button/i.test(cls)) return true;
    } catch (_) {}
    return false;
  }

  function pickCloseIn(root) {
    if (!root || !root.querySelectorAll) return null;
    var sels = [
      'button[aria-label*="close" i]',
      'button[aria-label*="Close" i]',
      'button[aria-label*="dismiss" i]',
      'button[title*="close" i]',
      '[role="button"][aria-label*="close" i]',
      'button.codicon-close',
      '.codicon-close',
      '[class*="close-button"]',
      '[class*="dialog-close"]',
      '[data-testid*="close"]',
    ];
    var i, j, nodes, el;
    for (i = 0; i < sels.length; i++) {
      try {
        nodes = root.querySelectorAll(sels[i]);
      } catch (_) {
        continue;
      }
      for (j = 0; j < nodes.length; j++) {
        el = nodes[j];
        if (isCloseControl(el) || visible(el)) {
          if (visible(el)) return el;
        }
      }
    }
    try {
      nodes = root.querySelectorAll('button, [role="button"], a, div[tabindex], span[tabindex]');
    } catch (_) {
      return null;
    }
    for (j = 0; j < nodes.length; j++) {
      el = nodes[j];
      if (isCloseControl(el)) return el;
    }
    return null;
  }

  /** 「Cursor is now on iOS」一类营销弹窗 + 右上角叉号 */
  function findPromoModal() {
    var found = null;
    walkDeep(document, function (root) {
      if (found) return;
      var nodes;
      var i;
      var el;
      var t;
      var rect;
      var closeEl;
      var panel;
      try {
        nodes = root.querySelectorAll
          ? root.querySelectorAll('[role="dialog"], [aria-modal="true"], div, section, aside')
          : [];
      } catch (_) {
        return;
      }
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (!visible(el)) continue;
        if (looksLikeMessageBubble(el)) continue;
        t = ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim();
        if (!looksLikePromoText(t)) continue;
        if (t.length > 1200) continue;
        rect = el.getBoundingClientRect();
        // 弹窗体量：比 toast 大，又不是整页
        if (rect.width < 280 || rect.height < 200) continue;
        if (rect.width > 1100 || rect.height > 900) continue;
        panel = el;
        closeEl = pickCloseIn(panel);
        if (!closeEl && panel.parentElement) closeEl = pickCloseIn(panel.parentElement);
        found = {
          el: panel,
          closeEl: closeEl,
          text: t.slice(0, 120),
          key: 'promo:' + t.slice(0, 40),
        };
        return;
      }
    });
    return found;
  }

  function dismissPromoModal(force) {
    var hit = findPromoModal();
    if (!hit) {
      promoDismissedKey = '';
      return false;
    }

    if (promoDismissedKey === hit.key && !force) {
      if (Date.now() - lastPromoDismissAt < CFG.promoDismissCooldownMs) {
        setHud('keepalive: promo closing…', true);
        return true;
      }
    }

    if (!force && Date.now() - lastPromoDismissAt < 800) return true;

    log('dismiss promo', hit.text);
    setHud('keepalive: close promo…', true);

    var clicked = false;
    if (hit.closeEl) {
      clicked = fireClick(hit.closeEl);
    }
    if (!clicked) {
      // 叉号选择器没挂上时：Esc 关掉 modal
      try {
        var opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
        document.dispatchEvent(new KeyboardEvent('keydown', opts));
        if (hit.el && hit.el.dispatchEvent) hit.el.dispatchEvent(new KeyboardEvent('keydown', opts));
        clicked = true;
        log('promo Escape fallback');
      } catch (_) {}
    }

    if (!clicked) return false;

    promoDismissedKey = hit.key;
    lastPromoDismissAt = Date.now();
    lastActionAt = lastPromoDismissAt;
    lastReason = 'promo_dismiss';
    actionCount += 1;
    setHud('keepalive: promo closed', true);
    return true;
  }

  function clickErrorRetry(force) {
    var hit = findErrorRetryAction();
    if (!hit) {
      retryAlreadyClicked = false;
      lastRetryKey = '';
      return false;
    }

    if (lastRetryKey !== hit.key) {
      lastRetryKey = hit.key;
      retryAlreadyClicked = false;
    }

    if (retryAlreadyClicked && !force) {
      setHud('keepalive: retry done', true);
      return false;
    }

    // 错误条出现后尽快点；冷却只挡连点，不挡首次
    if (!force && retryAlreadyClicked && Date.now() - lastRetryAt < CFG.retryCooldownMs) {
      return false;
    }
    if (!force && !retryAlreadyClicked && Date.now() - lastRetryAt < 600) {
      // 防 MutationObserver 同帧连点
      return false;
    }

    log('clicking retry', hit.label, hit.key);
    setHud('keepalive: clicking ' + hit.label + '…', true);
    if (!fireClick(hit.el)) return false;

    retryAlreadyClicked = true;
    lastRetryAt = Date.now();
    lastActionAt = lastRetryAt;
    lastReason = 'retry_' + hit.label.toLowerCase().replace(/\s+/g, '_');
    actionCount += 1;
    log('clicked retry', hit.label);
    setHud('keepalive: clicked ' + hit.label, true);
    return true;
  }

  function findComposer(root) {
    var i, j, sel, nodes, el, ph, all;
    for (i = 0; i < CFG.composerSelectors.length; i++) {
      sel = CFG.composerSelectors[i];
      try {
        nodes = root.querySelectorAll(sel);
      } catch (_) {
        continue;
      }
      for (j = 0; j < nodes.length; j++) {
        el = nodes[j];
        if (!visible(el)) continue;
        if (el.classList && el.classList.contains('aislash-editor-input-readonly')) continue;
        if (el.closest && el.closest('.aislash-editor-input-readonly')) continue;
        return el;
      }
    }
    try {
      all = root.querySelectorAll('[contenteditable="true"], textarea, div[role="textbox"]');
    } catch (_) {
      return null;
    }
    for (j = 0; j < all.length; j++) {
      el = all[j];
      if (!visible(el)) continue;
      ph =
        el.getAttribute('placeholder') ||
        el.getAttribute('data-placeholder') ||
        el.getAttribute('aria-placeholder') ||
        '';
      if (/Plan, search, build anything|Add a follow-up|Ask anything/i.test(ph)) return el;
    }
    return null;
  }

  /**
   * Cursor 输入框右侧是同一颗「槽位按钮」：
   * - 输入为空 → data-component=realtime-voice-start（波形 / Start voice chat）
   * - 有内容   → data-component=prompt-input-submit-button（Send message）
   * - 生成中   → data-state=stop（Stop generation）
   * 绝不能在 voice 态点击。
   */
  function classifySubmitSlot(el) {
    if (!el || !visible(el)) return 'none';
    var dc = ((el.getAttribute && el.getAttribute('data-component')) || '').toLowerCase();
    var aria = ((el.getAttribute && el.getAttribute('aria-label')) || '').toLowerCase();
    var title = ((el.getAttribute && el.getAttribute('title')) || '').toLowerCase();
    var state = ((el.getAttribute && el.getAttribute('data-state')) || '').toLowerCase();
    var label = (buttonLabel(el) || '').toLowerCase();
    var blob = aria + ' ' + title + ' ' + label;

    if (dc === 'realtime-voice-start') return 'voice';
    if (/start voice|voice chat|waveform|dictation|麦克风|语音/.test(blob)) return 'voice';
    if (
      el.querySelector &&
      el.querySelector(
        '[name="waveform"], [data-icon="waveform"], [class*="waveform"], [class*="microphone"], .codicon-mic',
      )
    ) {
      return 'voice';
    }

    if (state === 'stop' || /stop generation|停止生成/.test(blob)) return 'stop';

    if (dc === 'prompt-input-submit-button') {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true' || state === 'disabled') {
        return 'disabled';
      }
      if (/send|发送|submit|提交/.test(blob) || state === 'active' || !state) return 'send';
      return 'send';
    }

    if (/^send(\s|$)|\bsend message\b|发送/.test(blob)) return 'send';
    if (
      el.querySelector &&
      el.querySelector('.codicon-arrow-up-two, .codicon-arrow-up, [name="submit"], [name="arrowUpTwo"]')
    ) {
      return 'send';
    }
    return 'unknown';
  }

  function findSubmitSlot(root, near) {
    var base =
      (near &&
        near.closest &&
        near.closest('.full-input-box, .composer-bar, .ui-prompt-input, form, [class*="composer"]')) ||
      root;
    var nodes;
    var i;
    var el;
    try {
      nodes = base.querySelectorAll(CFG.submitSlotSelector);
    } catch (_) {
      nodes = [];
    }
    // 优先：composer 容器内、且离输入框最近的那颗
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (!visible(el)) continue;
      return el;
    }
    if (base !== root) {
      try {
        nodes = root.querySelectorAll(CFG.submitSlotSelector);
      } catch (_) {
        nodes = [];
      }
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (!visible(el)) continue;
        return el;
      }
    }
    return null;
  }

  function clickOnlyIfSend(slot) {
    var kind = classifySubmitSlot(slot);
    if (kind !== 'send') {
      log('skip click, slot is', kind, 'not send');
      return false;
    }
    try {
      slot.click();
      return true;
    } catch (_) {
      return false;
    }
  }

  /** 写入文字后等槽位从 voice → send，再点；一直是 voice 则绝不点 */
  function waitAndClickSend(root, box, done) {
    var started = Date.now();
    function tick() {
      var slot = findSubmitSlot(root, box);
      var kind = classifySubmitSlot(slot);
      if (kind === 'send') {
        var ok = clickOnlyIfSend(slot);
        done(ok, kind);
        return;
      }
      if (kind === 'voice' || kind === 'unknown' || kind === 'disabled' || kind === 'none') {
        if (Date.now() - started < CFG.sendReadyTimeoutMs) {
          setTimeout(tick, CFG.sendReadyPollMs);
          return;
        }
        log('slot never became send (stuck as', kind, ') — no click');
        setHud('keepalive: skip voice btn', true);
        done(false, kind);
        return;
      }
      // stop / 其它：不要点
      log('slot is', kind, '— no click');
      done(false, kind);
    }
    tick();
  }

  function fireKey(el, type, key, code, keyCode) {
    try {
      el.dispatchEvent(
        new KeyboardEvent(type, {
          key: key,
          code: code,
          keyCode: keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true,
        }),
      );
    } catch (_) {}
  }

  function insertText(el, text) {
    try {
      el.focus();
      el.click();
    } catch (_) {}
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      if (document.execCommand('insertText', false, text)) return;
    } catch (_) {}
    try {
      if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
        el.textContent = text;
      } else {
        el.value = text;
      }
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        }),
      );
    } catch (_) {}
  }

  /**
   * 写入「继续」→ 等槽位变成 send → 只提交一次：
   * - 能点发送按钮就只 click（不再补 Enter）
   * - 点不到才退回一次 Enter
   */
  function typeContinue(onDone) {
    var roots = allRoots();
    var i;
    var box;
    var root;
    var slot;
    var kind;
    for (i = 0; i < roots.length; i++) {
      root = roots[i];
      box = findComposer(root);
      if (!box) continue;

      slot = findSubmitSlot(root, box);
      kind = classifySubmitSlot(slot);
      log('before insert, slot=', kind);

      insertText(box, CFG.continueText);
      setHud('keepalive: wait send UI…', true);

      waitAndClickSend(root, box, function (clicked, finalKind) {
        if (clicked) {
          log('sent continue once via send button');
          setHud('keepalive: sent ' + CONTINUE, true);
          if (onDone) onDone(true);
          return;
        }

        // 仅在没点到发送时，才用 Enter 兜底一次
        try {
          fireKey(box, 'keydown', 'Enter', 'Enter', 13);
          fireKey(box, 'keypress', 'Enter', 'Enter', 13);
          fireKey(box, 'keyup', 'Enter', 'Enter', 13);
        } catch (_) {}

        if (finalKind === 'voice') {
          log('Enter once only — refused voice click');
          setHud('keepalive: Enter once', true);
        } else {
          log('sent continue once via Enter, slot was', finalKind);
          setHud('keepalive: sent ' + CONTINUE, true);
        }
        if (onDone) onDone(true);
      });
      return true;
    }
    log('banner found but composer missing');
    setHud('keepalive: no input', true);
    if (onDone) onDone(false);
    return false;
  }

  function handleUsageBanner(force) {
    var banner = findUsageLimitBanner();
    if (!banner) {
      bannerSeenAt = 0;
      pendingSend = false;
      bannerAlreadySent = false;
      return false;
    }

    // 同一次额度框已发过：不再发（仍可去点 Resume/Try again）
    if (bannerAlreadySent && !force) {
      setHud('keepalive: already sent', true);
      return true;
    }

    if (!force && Date.now() - lastActionAt < CFG.cooldownMs) {
      if (!pendingSend) return true;
    }

    var now = Date.now();
    if (!bannerSeenAt) {
      bannerSeenAt = now;
      pendingSend = true;
      log('usage banner seen, wait', CFG.bannerDelayMs, 'ms');
      setHud('keepalive: banner… wait 2s', true);
      return true;
    }

    var waited = now - bannerSeenAt;
    if (waited < CFG.bannerDelayMs) {
      pendingSend = true;
      setHud(
        'keepalive: wait ' + Math.ceil((CFG.bannerDelayMs - waited) / 100) / 10 + 's',
        true,
      );
      return true;
    }

    if (!force && now - lastActionAt < CFG.cooldownMs) return true;

    log('usage banner ready after delay', (banner.innerText || '').slice(0, 80));
    submitInFlight = true;
    var started = typeContinue(function (ok) {
      submitInFlight = false;
      if (ok) {
        lastActionAt = Date.now();
        lastReason = 'usage_limit_banner';
        actionCount += 1;
        bannerAlreadySent = true;
        pendingSend = false;
      }
    });
    if (!started) submitInFlight = false;
    return true;
  }

  function act(force) {
    // 营销弹窗挡操作：优先叉掉
    var dismissedPromo = dismissPromoModal(force);

    // Resume 与发「继续」互不阻塞：错误条出现时即使正在打字/等发送也要点
    var clickedRetry = clickErrorRetry(force);

    var handledUsage = false;
    if (!submitInFlight) {
      handledUsage = handleUsageBanner(force);
    }

    if (
      !dismissedPromo &&
      !handledUsage &&
      !clickedRetry &&
      !findErrorRetryAction() &&
      !findPromoModal()
    ) {
      setHud('keepalive ON', false);
    }
  }

  function start() {
    ensureHud();
    setHud('keepalive ON');
    timer = setInterval(function () {
      act(false);
    }, CFG.pollMs);
    try {
      observer = new MutationObserver(function () {
        act(false);
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: false,
      });
    } catch (_) {}
    act(true);
    log('strict banner mode. status=__cursorKeepaliveStatus()');
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  setTimeout(function () {
    act(true);
  }, 2000);
})();
