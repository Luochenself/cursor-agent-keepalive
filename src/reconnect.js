import { event, warn, info } from './logger.js';

async function clickButtonByLabel(page, label) {
  return page.evaluate((wanted) => {
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], a'));
    for (const el of nodes) {
      const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
      if (text !== wanted) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      el.click();
      return true;
    }
    return false;
  }, label);
}

/**
 * Focus chat composer and type message, then Enter to send.
 */
async function typeAndSend(page, cfg) {
  const text = cfg.continueText || '继续';
  const placeholders = cfg.composer?.placeholderIncludes || [];

  // 1) 在页面里定位并 focus 输入框
  const focused = await page.evaluate((placeholders) => {
    const fields = Array.from(
      document.querySelectorAll(
        'textarea, [contenteditable="true"], div[role="textbox"], input[type="text"]',
      ),
    );
    const rank = (el) => {
      const ph =
        el.getAttribute('placeholder') ||
        el.getAttribute('aria-placeholder') ||
        el.getAttribute('data-placeholder') ||
        '';
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return -1;
      if (placeholders.some((p) => ph.includes(p))) return 100;
      if (/Plan, search, build anything/i.test(ph)) return 100;
      if (/composer|chat|prompt/i.test(`${el.className} ${el.id}`)) return 50;
      return 10;
    };
    fields.sort((a, b) => rank(b) - rank(a));
    const el = fields.find((f) => rank(f) > 0);
    if (!el) return { ok: false };
    el.focus();
    el.click();
    return {
      ok: true,
      tag: el.tagName,
      placeholder: (el.getAttribute('placeholder') || '').slice(0, 80),
    };
  }, placeholders);

  if (!focused?.ok) {
    warn('找不到 Agent 输入框');
    return { ok: false, reason: 'no-composer' };
  }

  info('composer focused', focused);

  // 2) 清空并输入「继续」
  // contenteditable / textarea 都用 keyboard，兼容性更好
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 30 });

  // 3) 发送：先试 Enter，再试常见发送按钮
  await page.keyboard.press('Enter');

  // 兜底：点带 send / 发送 的按钮
  await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const el of nodes) {
      const label = (el.innerText || el.getAttribute('aria-label') || '').trim();
      if (!label) continue;
      if (!/^(send|发送|submit)$/i.test(label) && !/send message|发送消息/i.test(label)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      el.click();
      return true;
    }
    return false;
  });

  event('reconnect.type_continue', { text, composer: focused });
  return { ok: true, action: 'type_continue', text, composer: focused };
}

export async function tryReconnect(page, cfg, scan) {
  const action = scan.scenario?.action || (scan.buttons?.length ? 'click_button' : 'type_continue');

  if (action === 'type_continue' || scan.scenario?.id === 'usage_limit') {
    return typeAndSend(page, cfg);
  }

  const labels = (scan.buttons || [])
    .filter((b) => b.visible && !b.disabled)
    .map((b) => b.label);

  if (!labels.length) {
    // 没有按钮时也尝试发「继续」
    warn('No reconnect button; fallback type_continue');
    return typeAndSend(page, cfg);
  }

  const wanted = labels[0];
  const clicked = await clickButtonByLabel(page, wanted);
  if (clicked) {
    event('reconnect.click', { label: wanted });
    return { ok: true, action: 'click_button', label: wanted };
  }

  warn('Click failed, fallback type_continue', { label: wanted });
  return typeAndSend(page, cfg);
}
