import { loadConfig } from './config.js';
import { connectCdp, isCdpAlive, pickTargetPage } from './cdp.js';
import { scanDisconnect } from './detector.js';
import { tryReconnect } from './reconnect.js';
import { error, event, info, warn } from './logger.js';

const state = {
  browser: null,
  page: null,
  lastReconnectAt: 0,
  reconnectTimestamps: [],
  lastStatus: '',
};

function allowReconnect(cfg) {
  const now = Date.now();
  if (now - state.lastReconnectAt < (cfg.reconnectCooldownMs || 8000)) return false;
  const hourAgo = now - 3600_000;
  state.reconnectTimestamps = state.reconnectTimestamps.filter((t) => t > hourAgo);
  if (state.reconnectTimestamps.length >= (cfg.maxReconnectPerHour || 30)) {
    warn('Hit maxReconnectPerHour, skipping');
    return false;
  }
  return true;
}

async function ensureSession(cfg) {
  const alive = await isCdpAlive(cfg);
  if (!alive) {
    state.browser = null;
    state.page = null;
    return false;
  }
  if (!state.browser || !state.browser.connected) {
    state.browser = await connectCdp(cfg);
  }
  state.page = await pickTargetPage(state.browser, cfg);
  return !!state.page;
}

async function tick(cfg) {
  const ok = await ensureSession(cfg);
  if (!ok) {
    const msg = `CDP 未就绪：请先 npm run launch-cursor，或手动用 --remote-debugging-port=9222 启动 Cursor（${cfg.cdpUrl}）`;
    if (state.lastStatus !== msg) {
      warn(msg);
      state.lastStatus = msg;
    }
    return;
  }

  let scan;
  try {
    scan = await scanDisconnect(state.page, cfg);
  } catch (e) {
    warn('scan failed, will reattach', e.message || e);
    state.page = null;
    return;
  }

  if (cfg.statusHud) {
    const status = scan.disconnected
      ? `HIT scenario=${scan.scenario?.id || 'unknown'} action=${scan.scenario?.action || '?'} reasons=${(scan.reasons || []).join('|')} composer=${scan.composer?.placeholder || '-'}`
      : 'OK listening';
    if (status !== state.lastStatus) {
      info(status);
      state.lastStatus = status;
    }
  }

  if (!scan.disconnected) return;
  event('disconnect.detected', {
    scenario: scan.scenario,
    reasons: scan.reasons,
    buttons: scan.buttons,
    composer: scan.composer,
  });

  if (!allowReconnect(cfg)) return;

  const result = await tryReconnect(state.page, cfg, scan);
  state.lastReconnectAt = Date.now();
  if (result.ok) state.reconnectTimestamps.push(Date.now());
  event('reconnect.result', result);
}

async function main() {
  const cfg = loadConfig();
  info('cursor-chat-keepalive framework starting', {
    cdpUrl: cfg.cdpUrl,
    pollMs: cfg.pollMs,
  });
  info(
    '验收：出现 usage limit 横幅时，应自动在输入框输入「继续」并发送；日志见 logs/keepalive.log（disconnect.detected + reconnect.type_continue）',
  );

  for (;;) {
    try {
      await tick(cfg);
    } catch (e) {
      error('tick error', e.message || String(e));
      state.browser = null;
      state.page = null;
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs || 1500));
  }
}

main().catch((e) => {
  error('fatal', e.message || String(e));
  process.exit(1);
});
