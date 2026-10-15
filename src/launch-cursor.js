import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { isCdpAlive } from './cdp.js';
import { info, warn } from './logger.js';

function findCursorExe(cfg) {
  for (const p of cfg.cursorExeCandidates || []) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  const cfg = loadConfig();
  if (await isCdpAlive(cfg)) {
    info('CDP already open', { cdpUrl: cfg.cdpUrl });
    console.log('已有调试端口，可直接 npm start / npm run probe');
    return;
  }

  const exe = findCursorExe(cfg);
  if (!exe) {
    warn('找不到 Cursor.exe，请把路径写进 config.json → cursorExeCandidates');
    process.exit(1);
  }

  // 注意：已运行的 Cursor 不会自动打开 9222，需先退出再用本脚本启动
  info('Launching Cursor with remote debugging', { exe, port: 9222 });
  const child = spawn(exe, ['--remote-debugging-port=9222'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isCdpAlive(cfg)) {
      info('CDP ready', { cdpUrl: cfg.cdpUrl });
      console.log('调试端口已就绪 → 下一步：npm run probe 或 npm start');
      return;
    }
  }
  warn('超时仍未打开 9222。请完全退出 Cursor 后重试本命令。');
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
