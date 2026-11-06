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
  /** HUD / status 用：确认已加载本轮脚本（旧缓存没有这个字段） */
  var KEEPALIVE_BUILD = '2026-10-22h';
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
      'Weekly usage limit reached',
      'Monthly usage limit reached',
      'Upgrade your plan for more weekly usage',
      'Upgrade Plan',
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
    // 营销弹窗：只认「标题级」硬短语；禁止用 Upgrade to access 等短句（聊天记录会误伤）
    promoTitlePhrases: [
      'Cursor is now on iOS',
      'AI teammates that get work done',
      'Meet Grok Bot',
    ],
    // 标题命中后再要求至少再命中一条（降低聊天复述误判）
    promoSupportPhrases: [
      'Build from anywhere',
      'Kick off agents, review demos',
      'Download now',
      'your team of helpful agents',
      'Hand off tasks and watch them carry',
      'Upgrade to access',
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
  // 接口层用量墙（DOM 扫不到时仍可发「继续」）
  var apiWall = null;
  var apiWallHookInstalled = false;

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
    apiWall = null;
    log('cooldown reset');
  };
  window.__cursorKeepaliveStatus = function () {
    var retry = findErrorRetryAction();
    var promo = findPromoModal();
    var bannerEl = findUsageLimitBanner();
    var wall = detectUsageWall();
    var bannerText = '';
    var bodyHard = false;
    try {
      bannerText = bannerEl
        ? flattenText(bannerEl.innerText || bannerEl.textContent || '').slice(0, 120)
        : '';
      bodyHard = isHardUsageWallText(
        (document.body && (document.body.innerText || document.body.textContent)) || '',
      );
    } catch (_) {}
    return {
      running: true,
      build: KEEPALIVE_BUILD,
      lastActionAt: lastActionAt,
      lastReason: lastReason,
      actionCount: actionCount,
      banner: !!bannerEl || !!wall,
      wallSource: wall && wall.source,
      wallText: wall && wall.text ? String(wall.text).slice(0, 120) : '',
      bannerText: bannerText,
      bannerClass: bannerEl && bannerEl.className ? String(bannerEl.className).slice(0, 80) : '',
      bodyHardWall: bodyHard,
      apiWall: apiWall
        ? { stage: apiWall.stage, trayLabel: (apiWall.trayLabel || '').slice(0, 80), at: apiWall.at }
        : null,
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
  window.__cursorKeepaliveDebugScan = function () {
    var body = '';
    try {
      body = flattenText((document.body && document.body.innerText) || '');
    } catch (_) {}
    var ariaHits = [];
    try {
      var nodes = document.querySelectorAll('[aria-label], [title], [data-banner-type]');
      for (var i = 0; i < nodes.length && ariaHits.length < 12; i++) {
        var el = nodes[i];
        var bag = [
          el.getAttribute('aria-label') || '',
          el.getAttribute('title') || '',
          el.getAttribute('data-banner-type') || '',
          flattenText(el.innerText || '').slice(0, 80),
        ].join(' | ');
        if (/usage|limit|upgrade|weekly|monthly/i.test(bag)) {
          ariaHits.push(bag.slice(0, 160));
        }
      }
    } catch (_) {}
    return {
      bodyHasWeekly: /weekly\s+usage\s+limit/i.test(body),
      bodyLen: body.length,
      iframeCount: document.querySelectorAll('iframe').length,
      webviewCount: document.querySelectorAll('webview').length,
      ariaHits: ariaHits,
      apiWall: apiWall,
      wall: detectUsageWall(),
    };
  };

  function ensureHud() {
    var hud = document.getElementById('__cursor_keepalive_hud');
    if (hud) return hud;
    hud = document.createElement('div');
    hud.id = '__cursor_keepalive_hud';
    hud.textContent = 'keepalive ON ' + KEEPALIVE_BUILD;
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
    if (!root || depth > 16) return;
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

  function normalizeLabel(s) {
    return (s || '')
      .replace(/[\u2197\u2192\u2196\u2190\u2191\u2193\u21AA\u21A9\u2924\u27A4\u279A\u279C\u00BB▸►›»]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function flattenText(s) {
    return String(s || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\u00A0\u202F\u2007\u2060]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isUpgradeProLabel(s) {
    s = normalizeLabel(s);
    return /^upgrade to pro(\+|)?$/i.test(s);
  }

  /** 周限额新墙 / 旧墙 / composer warning 共用 */
  function looksLikeLimitToast(text) {
    text = flattenText(text);
    return (
      /you'?ve hit your usage limit/i.test(text) ||
      /you'?ve reached your (usage |free plan )?limit/i.test(text) ||
      /get cursor pro for more agent usage/i.test(text) ||
      /weekly\s+usage\s+limit\s+reached/i.test(text) ||
      /monthly\s+usage\s+limit\s+reached/i.test(text) ||
      /usage\s+limit\s+reached/i.test(text) ||
      /upgrade\s+your\s+plan\s+for\s+more/i.test(text) ||
      /upgrade for (extended|\d+x) usage/i.test(text) ||
      /it resets in\s+\d+\s+days?/i.test(text)
    );
  }

  function isHardUsageWallText(text) {
    text = flattenText(text);
    return (
      /weekly\s+usage\s+limit\s+reached/i.test(text) ||
      /monthly\s+usage\s+limit\s+reached/i.test(text) ||
      /you'?ve hit your usage limit/i.test(text) ||
      /upgrade\s+your\s+plan\s+for\s+more\s+(weekly|monthly)\s+usage/i.test(text)
    );
  }

  function isUpgradeishLabel(s) {
    s = normalizeLabel(s);
    if (!s || s.length > 48) return false;
    return (
      /^upgrade to pro(\+|)?$/i.test(s) ||
      /^upgrade to ultra$/i.test(s) ||
      /^upgrade plan$/i.test(s) ||
      /^upgrade$/i.test(s) ||
      /^get pro$/i.test(s) ||
      /^get more usage$/i.test(s) ||
      /^set a new limit$/i.test(s) ||
      /^set new limit$/i.test(s) ||
      /^buy credits$/i.test(s) ||
      /^升级到\s*pro/i.test(s) ||
      /^升级$/i.test(s)
    );
  }

  function looksLikeChatHistory(el) {
    if (!el || !el.closest) return false;
    try {
      // 额度墙 / composer warning 挂在对话区附近，绝不能当聊天气泡排除
      if (
        el.closest(
          '[class*="usage-limit-policy"], [class*="composer-error"], [class*="composer-warning"], [class*="ComposerWarning"]',
        )
      ) {
        return false;
      }
      var own = flattenText(el.innerText || el.textContent || '');
      if (isHardUsageWallText(own)) return false;
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

  function pickSmallestMatching(nodes) {
    var best = null;
    var bestLen = Infinity;
    var i;
    var el;
    var t;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (!visible(el)) continue;
      t = flattenText(el.innerText || el.textContent || '');
      if (!isHardUsageWallText(t) && !looksLikeLimitToast(t)) continue;
      if (t.length < 8 || t.length > 800) continue;
      if (t.length < bestLen) {
        best = el;
        bestLen = t.length;
      }
    }
    return best;
  }

  function noteApiWallFromPayload(data) {
    try {
      var s = typeof data === 'string' ? data : JSON.stringify(data);
      if (!s || s.length < 8) return;
      if (
        !/usageLimitPolicyStatus|trayLabel|WEEKLY_LIMIT|MONTHLY_LIMIT|Weekly usage limit|Monthly usage limit|You've hit your usage limit/i.test(
          s,
        )
      ) {
        return;
      }
      var stage = '';
      var trayLabel = '';
      var m = s.match(/"stage"\s*:\s*"?(WEEKLY_LIMIT|MONTHLY_LIMIT|HARD_BLOCK|SLOW_POOL|[\w.]+)"?/i);
      if (m) stage = m[1];
      m = s.match(/"trayLabel"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (m) {
        try {
          trayLabel = JSON.parse('"' + m[1] + '"');
        } catch (_) {
          trayLabel = m[1];
        }
      }
      var hard =
        /WEEKLY_LIMIT|MONTHLY_LIMIT/i.test(stage) ||
        isHardUsageWallText(trayLabel) ||
        isHardUsageWallText(s) ||
        /You've hit your usage limit/i.test(s);
      if (!hard) {
        // 明确清掉：接口说已恢复
        if (/UNSPECIFIED|"stage"\s*:\s*0/.test(s) && !/trayLabel/.test(s)) {
          apiWall = null;
        }
        return;
      }
      apiWall = {
        at: Date.now(),
        stage: stage || 'usage_limit',
        trayLabel: trayLabel || 'usage limit',
      };
      log('api usage wall', apiWall.stage, (apiWall.trayLabel || '').slice(0, 60));
    } catch (_) {}
  }

  function installApiWallHooks() {
    if (apiWallHookInstalled) return;
    apiWallHookInstalled = true;
    try {
      var origFetch = window.fetch;
      if (typeof origFetch === 'function') {
        window.fetch = function () {
          var args = arguments;
          return origFetch.apply(this, args).then(function (res) {
            try {
              var clone = res.clone();
              clone
                .text()
                .then(function (txt) {
                  noteApiWallFromPayload(txt);
                })
                .catch(function () {});
            } catch (_) {}
            return res;
          });
        };
      }
    } catch (_) {}
    try {
      var OrigXHR = window.XMLHttpRequest;
      if (!OrigXHR) return;
      var proto = OrigXHR.prototype;
      var origOpen = proto.open;
      var origSend = proto.send;
      proto.open = function (method, url) {
        this.__keepaliveUrl = url;
        return origOpen.apply(this, arguments);
      };
      proto.send = function () {
        var xhr = this;
        xhr.addEventListener('load', function () {
          try {
            noteApiWallFromPayload(xhr.responseText || '');
          } catch (_) {}
        });
        return origSend.apply(this, arguments);
      };
    } catch (_) {}
  }

  function isApiWallActive() {
    if (!apiWall || !apiWall.at) return false;
    // 接口结果缓存 10 分钟；周墙本身会挂很久
    return Date.now() - apiWall.at < 10 * 60 * 1000;
  }

  /** 综合 DOM + aria + 通知 + 接口 */
  function detectUsageWall() {
    var el = findUsageLimitBanner();
    if (el) {
      return {
        source: 'dom',
        el: el,
        text: flattenText(el.innerText || el.textContent || el.getAttribute('aria-label') || ''),
      };
    }
    if (isApiWallActive()) {
      return {
        source: 'api',
        el: null,
        text: apiWall.trayLabel || apiWall.stage || 'usage limit',
      };
    }
    return null;
  }

  /**
   * 认真实额度墙：
   * 周限额常在闭影/独立层，正文 innerText 可能扫不到；
   * 同时扫 aria/title/data-banner-type/通知 toast，并由接口钩子兜底。
   */
  function findUsageLimitBanner() {
    var found = null;
    walkDeep(document, function (root) {
      if (found) return;
      var nodes;
      var i;
      var el;
      var t;
      var label;
      var scope;
      var aria;

      // 0a) 官方 usage-limit-policy-banner
      try {
        nodes = root.querySelectorAll
          ? root.querySelectorAll(
              '.usage-limit-policy-banner, [class*="usage-limit-policy-banner"], [data-banner-type]',
            )
          : [];
      } catch (_) {
        nodes = [];
      }
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (!visible(el)) continue;
        t = flattenText(
          (el.innerText || '') +
            ' ' +
            (el.getAttribute('aria-label') || '') +
            ' ' +
            (el.getAttribute('data-banner-type') || ''),
        );
        if (
          el.className &&
          /usage-limit-policy-banner/i.test(String(el.className))
        ) {
          found =
            (el.closest && el.closest('.usage-limit-policy-banner')) || el;
          return;
        }
        if (isHardUsageWallText(t) || looksLikeLimitToast(t)) {
          found = el;
          return;
        }
      }

      // 0b) ComposerWarningPopup / 通知 toast
      try {
        nodes = root.querySelectorAll
          ? root.querySelectorAll(
              '.composer-error-title, .composer-error-message, .composer-warning-modal-content, [class*="composer-warning"], [class*="composer-error-title"], .notification-toast, .notifications-toasts .notification-list-item, .notification-toast-container',
            )
          : [];
      } catch (_) {
        nodes = [];
      }
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (!visible(el)) continue;
        t = flattenText(el.innerText || el.textContent || '');
        if (!looksLikeLimitToast(t) && !isHardUsageWallText(t)) continue;
        found =
          (el.closest &&
            el.closest(
              '.composer-warning-modal-content, [class*="composer-warning"], [class*="composer-error"], .notification-toast, .notification-toast-container',
            )) ||
          el;
        return;
      }

      // 0c) aria-label / title（闭影宿主常把文案挂这里）
      try {
        nodes = root.querySelectorAll
          ? root.querySelectorAll('[aria-label], [title], [aria-description]')
          : [];
      } catch (_) {
        nodes = [];
      }
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        aria = flattenText(
          (el.getAttribute('aria-label') || '') +
            ' ' +
            (el.getAttribute('title') || '') +
            ' ' +
            (el.getAttribute('aria-description') || ''),
        );
        if (!isHardUsageWallText(aria) && !looksLikeLimitToast(aria)) continue;
        if (!visible(el) && !(el.getBoundingClientRect && el.getBoundingClientRect().width > 0)) {
          // aria 宿主可能自身不可见尺寸，仍认
        }
        found = el;
        return;
      }

      // 0d) 全文硬匹配
      try {
        nodes = root.querySelectorAll
          ? root.querySelectorAll('div, span, section, p, button, a, li, h1, h2, h3')
          : [];
      } catch (_) {
        nodes = [];
      }
      el = pickSmallestMatching(nodes);
      if (el) {
        found = el;
        return;
      }

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
        label = buttonLabel(el);
        if (!(isUpgradeishLabel(label) || isUpgradeProLabel(label))) continue;
        t = nearbyParentText(el);
        if (looksLikeLimitToast(t) || isHardUsageWallText(t)) {
          found = el;
          return;
        }
        // 周限额墙文案常在闭影里，父级扫不到；聊天区可见的 Upgrade Plan 也认
        if (/^upgrade plan$/i.test(normalizeLabel(label))) {
          found = el;
          return;
        }
      }

      try {
        scope = root.body || root.documentElement || root;
        t = flattenText(scope.innerText || scope.textContent || '');
      } catch (_) {
        t = '';
      }
      if (isHardUsageWallText(t)) {
        found = scope;
      }
    }, 0);
    return found;
  }

  function nearbyParentText(el) {
    var node = el;
    var hops = 0;
    var t = '';
    while (node && hops < 12) {
      t = flattenText(node.innerText || node.textContent || '');
      if (looksLikeLimitToast(t) || isHardUsageWallText(t)) return t;
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

  function countPhraseHits(text, phrases) {
    var n = 0;
    var i;
    for (i = 0; i < phrases.length; i++) {
      if (text.indexOf(phrases[i]) >= 0) n += 1;
    }
    return n;
  }

  /** 必须像真实营销弹窗：标题硬命中 +（dialog/modal 或 再命中一条辅助文案） */
  function looksLikePromoText(text) {
    text = (text || '').replace(/\s+/g, ' ');
    if (!text) return false;
    var titles = CFG.promoTitlePhrases || [];
    var support = CFG.promoSupportPhrases || [];
    if (countPhraseHits(text, titles) < 1) return false;
    // 标题极短复述（聊天里只抄一句）不够；要有辅助句或足够长的弹窗体
    if (countPhraseHits(text, support) >= 1) return true;
    if (/Cursor is now on iOS/i.test(text) && /Download now|Build from anywhere/i.test(text)) {
      return true;
    }
    // 真弹窗标题 + 较长正文（含内嵌假 UI），且不像「规则说明」中文复述
    if (text.length >= 80 && !/自动点|keepalive|promo|误判|识别/i.test(text)) {
      return /AI teammates that get work done|Meet Grok Bot|Cursor is now on iOS/i.test(text);
    }
    return false;
  }

  function looksLikeChatOrComposerChrome(el) {
    if (!el || !el.closest) return false;
    try {
      if (looksLikeMessageBubble(el)) return true;
      return !!(
        el.closest(
          '[data-message-role], [data-message-id], .composer-human-message, .composer-ai-message, .markdown-root, .anysphere-markdown-container-root, .aislash-editor-input, .monaco-editor, [class*="composer-bar"], [class*="chat-message"], [class*="conversation"]',
        ) || el.closest('[class*="sidebar"], [class*="explorer"], [id*="workbench.parts"]')
      );
    } catch (_) {
      return false;
    }
  }

  function isOverlayLikePanel(el) {
    if (!el || !el.getBoundingClientRect) return false;
    try {
      var st = window.getComputedStyle(el);
      var pos = (st && st.position) || '';
      if (pos !== 'fixed' && pos !== 'absolute') {
        // dialog 根可能是 relative，看祖先
        var p = el.parentElement;
        var hops = 0;
        while (p && hops < 4) {
          try {
            var pst = window.getComputedStyle(p);
            if (pst && (pst.position === 'fixed' || pst.position === 'absolute')) {
              pos = pst.position;
              break;
            }
          } catch (_) {}
          p = p.parentElement;
          hops += 1;
        }
      }
      if (pos !== 'fixed' && pos !== 'absolute') return false;
      var r = el.getBoundingClientRect();
      var vw = window.innerWidth || 1200;
      var vh = window.innerHeight || 800;
      // 大致居中遮罩层，不是贴边侧栏
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      if (cx < vw * 0.2 || cx > vw * 0.8) return false;
      if (cy < vh * 0.15 || cy > vh * 0.85) return false;
      return true;
    } catch (_) {
      return false;
    }
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

  function softVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    try {
      var r = el.getBoundingClientRect();
      if (r.width >= 1 && r.height >= 1) return true;
      // 官方叉号内部常是空 div，点按钮本体；有些版本 button 本身尺寸靠 CSS
      var st = window.getComputedStyle(el);
      if (st && st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0') {
        return r.width > 0 || r.height > 0 || !!el.offsetParent;
      }
    } catch (_) {}
    return false;
  }

  /**
   * 营销弹窗（Grok Bot / iOS 等）：
   * 官方：.fullscreen-ad-backdrop > [role=dialog] > button.announcement-modal-close-button
   * 只认这些节点，聊天复述不会误伤。
   */
  function findPromoModal() {
    var found = null;

    function accept(panel, closeEl, key, text) {
      if (!closeEl && !panel) return;
      found = {
        el: panel || closeEl,
        closeEl: closeEl,
        text: (text || '').slice(0, 120),
        key: key,
        allowEsc: true,
      };
    }

    walkDeep(document, function (root) {
      if (found) return;
      var nodes;
      var i;
      var el;
      var panel;
      var t;
      var closeEl;
      var scope;

      // 0) 官方叉号：存在即认（不依赖文案）
      try {
        nodes = root.querySelectorAll
          ? root.querySelectorAll(
              'button.announcement-modal-close-button, .announcement-modal-close-button, .fullscreen-ad-backdrop button[aria-label="Close"], .fullscreen-ad-backdrop button[aria-label="close"]',
            )
          : [];
      } catch (_) {
        nodes = [];
      }
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (!softVisible(el) && !visible(el)) continue;
        panel =
          (el.closest &&
            (el.closest('.fullscreen-ad-backdrop') ||
              el.closest('[role="dialog"]') ||
              el.closest('[aria-modal="true"]'))) ||
          el.parentElement;
        if (panel && looksLikeMessageBubble(panel)) continue;
        t = flattenText((panel && (panel.innerText || panel.textContent)) || '');
        accept(panel, el, 'promo:announcement-close', t);
        return;
      }

      // 1) 有 backdrop 就找里面任意 Close
      try {
        nodes = root.querySelectorAll
          ? root.querySelectorAll('.fullscreen-ad-backdrop')
          : [];
      } catch (_) {
        nodes = [];
      }
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (!softVisible(el) && !visible(el)) continue;
        closeEl = null;
        try {
          closeEl =
            el.querySelector('button.announcement-modal-close-button, .announcement-modal-close-button') ||
            el.querySelector('button[aria-label="Close"], button[aria-label="close"]') ||
            pickCloseIn(el);
        } catch (_) {}
        t = flattenText(el.innerText || el.textContent || '');
        accept(el, closeEl, 'promo:fullscreen-backdrop', t);
        return;
      }

      // 2) 标题硬匹配 → 向上找 dialog → 点 Close（远端文案 / 无 class 时）
      try {
        nodes = root.querySelectorAll ? root.querySelectorAll('h1, h2, h3, [class*="title"]') : [];
      } catch (_) {
        nodes = [];
      }
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (!visible(el)) continue;
        t = flattenText(el.innerText || el.textContent || '');
        if (
          !/AI teammates that get work done/i.test(t) &&
          !/^Meet Grok Bot$/i.test(t) &&
          !/Cursor is now on iOS/i.test(t)
        ) {
          continue;
        }
        if (looksLikeMessageBubble(el)) continue;
        panel =
          (el.closest &&
            (el.closest('.fullscreen-ad-backdrop') ||
              el.closest('[role="dialog"]') ||
              el.closest('[aria-modal="true"]'))) ||
          null;
        if (!panel) continue;
        closeEl =
          panel.querySelector(
            'button.announcement-modal-close-button, .announcement-modal-close-button, button[aria-label="Close"], button[aria-label="close"]',
          ) || pickCloseIn(panel);
        accept(panel, closeEl, 'promo:title:' + t.slice(0, 24), t);
        return;
      }
    });

    // 文档根再扫一遍（不依赖 walkDeep）
    if (!found) {
      try {
        var closeBtn = document.querySelector(
          'button.announcement-modal-close-button, .fullscreen-ad-backdrop button[aria-label="Close"]',
        );
        if (closeBtn && (softVisible(closeBtn) || visible(closeBtn))) {
          var pan =
            closeBtn.closest('.fullscreen-ad-backdrop') ||
            closeBtn.closest('[role="dialog"]') ||
            closeBtn.parentElement;
          accept(
            pan,
            closeBtn,
            'promo:doc-query',
            flattenText((pan && pan.innerText) || ''),
          );
        }
      } catch (_) {}
    }
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
      promoDismissedKey = '';
    }

    if (!force && Date.now() - lastPromoDismissAt < 800) return true;

    log('dismiss promo', hit.key, hit.text);
    setHud('keepalive: close promo…', true);

    var clicked = false;
    if (hit.closeEl) {
      clicked = fireClick(hit.closeEl);
      // 再点内部子节点（官方叉号内部是空 div）
      try {
        var child = hit.closeEl.firstElementChild;
        if (child) fireClick(child);
      } catch (_) {}
    }
    // 全屏广告一律 Esc 兜底（不依赖 role=dialog）
    if (hit.allowEsc) {
      try {
        var opts = {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
          view: window,
        };
        document.dispatchEvent(new KeyboardEvent('keydown', opts));
        document.dispatchEvent(new KeyboardEvent('keyup', opts));
        if (hit.el && hit.el.dispatchEvent) {
          hit.el.dispatchEvent(new KeyboardEvent('keydown', opts));
        }
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
    var wall = detectUsageWall();
    if (!wall) {
      bannerSeenAt = 0;
      pendingSend = false;
      bannerAlreadySent = false;
      return false;
    }

    // 周限额墙会一直挂着：冷却过后允许再发「继续」
    if (bannerAlreadySent && !force) {
      if (Date.now() - lastActionAt < CFG.cooldownMs) {
        setHud('keepalive: already sent', true);
        return true;
      }
      bannerAlreadySent = false;
      bannerSeenAt = 0;
      pendingSend = false;
    }

    if (!force && Date.now() - lastActionAt < CFG.cooldownMs) {
      if (!pendingSend) return true;
    }

    var now = Date.now();
    if (!bannerSeenAt) {
      bannerSeenAt = now;
      pendingSend = true;
      log('usage wall via', wall.source, (wall.text || '').slice(0, 80));
      setHud('keepalive: ' + wall.source + '… wait 2s', true);
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

    log('usage wall ready after delay via', wall.source);
    submitInFlight = true;
    var started = typeContinue(function (ok) {
      submitInFlight = false;
      if (ok) {
        lastActionAt = Date.now();
        lastReason = 'usage_limit_' + (wall.source || 'banner');
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
      setHud('keepalive ON ' + KEEPALIVE_BUILD, false);
    }
  }

  function start() {
    installApiWallHooks();
    ensureHud();
    setHud('keepalive ON ' + KEEPALIVE_BUILD);
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
