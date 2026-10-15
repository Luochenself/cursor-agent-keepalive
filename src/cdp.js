import puppeteer from 'puppeteer-core';
import { info, warn } from './logger.js';

/**
 * Connect to Cursor (Electron) via Chrome DevTools Protocol.
 * Cursor must be started with --remote-debugging-port=9222 (see launch-cursor.js).
 */
export async function connectCdp(cfg) {
  const browser = await puppeteer.connect({
    browserURL: cfg.cdpUrl,
    defaultViewport: null,
  });
  info('CDP connected', { cdpUrl: cfg.cdpUrl });
  return browser;
}

export async function listPages(browser) {
  const pages = await browser.pages();
  return pages.map((p) => ({
    url: p.url(),
    title: '',
    page: p,
  }));
}

export async function pickTargetPage(browser, cfg) {
  const pages = await browser.pages();
  const needles = (cfg.targetPageMatch || []).map((s) => String(s).toLowerCase());

  const scored = [];
  for (const page of pages) {
    let title = '';
    try {
      title = await page.title();
    } catch {
      /* ignore */
    }
    const url = page.url() || '';
    const hay = `${url} ${title}`.toLowerCase();
    const score = needles.reduce((n, k) => (hay.includes(k) ? n + 1 : n), 0);
    scored.push({ page, url, title, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored.find((x) => x.score > 0) || scored[0];
  if (!best) {
    warn('No CDP pages found');
    return null;
  }
  info('Target page', { url: best.url, title: best.title, score: best.score });
  return best.page;
}

export async function isCdpAlive(cfg) {
  try {
    const res = await fetch(`${cfg.cdpUrl}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
