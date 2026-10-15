/**
 * Detect chat interrupt scenarios from Cursor DOM (via CDP).
 * Scenario #1 (from your screenshot): usage limit banner → type「继续」.
 */

function matchScenario(bodyText, scenarios) {
  const hits = [];
  for (const s of scenarios || []) {
    const keys = s.textIncludesAny || [];
    const matched = keys.filter((k) => bodyText.includes(k));
    if (matched.length) {
      hits.push({
        id: s.id,
        action: s.action,
        matched,
        priority: s.id === 'usage_limit' ? 100 : 10,
      });
    }
  }
  hits.sort((a, b) => b.priority - a.priority);
  return hits[0] || null;
}

export async function scanDisconnect(page, cfg) {
  const scenarios = cfg.scenarios || [];
  const buttonTexts = cfg.reconnectActions?.buttonTextIncludes || [];
  const placeholders = cfg.composer?.placeholderIncludes || [];

  const result = await page.evaluate(
    ({ buttonTexts, placeholders }) => {
      const bodyText = (document.body && document.body.innerText) || '';

      const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
      const reconnectCandidates = [];
      for (const el of buttons) {
        const label = (el.innerText || el.getAttribute('aria-label') || '').trim();
        if (!label) continue;
        // 不要把 Upgrade to Pro 当重连按钮
        if (/upgrade\s*to\s*pro/i.test(label)) continue;
        const hit = buttonTexts.find((t) => label.toLowerCase().includes(String(t).toLowerCase()));
        if (hit) {
          const rect = el.getBoundingClientRect();
          reconnectCandidates.push({
            label,
            matched: hit,
            disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
            visible: rect.width > 0 && rect.height > 0,
          });
        }
      }

      // 找输入框：优先匹配 placeholder
      const fields = Array.from(
        document.querySelectorAll(
          'textarea, [contenteditable="true"], div[role="textbox"], input[type="text"]',
        ),
      );
      let composer = null;
      for (const el of fields) {
        const ph =
          el.getAttribute('placeholder') ||
          el.getAttribute('aria-placeholder') ||
          el.getAttribute('data-placeholder') ||
          '';
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const phHit = placeholders.some((p) => ph.includes(p));
        const softHit =
          /composer|chat|prompt|input|editor/i.test(el.className || '') ||
          /composer|chat|prompt|input|editor/i.test(el.id || '');
        if (phHit || softHit || (!composer && ph)) {
          composer = {
            tag: el.tagName,
            placeholder: ph.slice(0, 80),
            contentEditable: el.getAttribute('contenteditable') === 'true',
            phHit,
          };
          if (phHit) break;
        }
      }

      return {
        bodyText,
        reconnectCandidates,
        composer,
        sample: bodyText.slice(0, 500),
      };
    },
    { buttonTexts, placeholders },
  );

  const scenario = matchScenario(result.bodyText, scenarios);
  const disconnected =
    !!scenario || result.reconnectCandidates.some((c) => c.visible && !c.disabled);

  return {
    disconnected,
    scenario,
    reasons: scenario ? scenario.matched : [],
    buttons: result.reconnectCandidates,
    composer: result.composer,
    sample: result.sample,
  };
}
