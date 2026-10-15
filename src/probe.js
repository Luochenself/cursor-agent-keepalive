import { loadConfig } from './config.js';
import { connectCdp, isCdpAlive, listPages, pickTargetPage } from './cdp.js';
import { scanDisconnect } from './detector.js';
import { info, warn } from './logger.js';

async function main() {
  const cfg = loadConfig();
  const alive = await isCdpAlive(cfg);
  info('CDP alive?', { alive, cdpUrl: cfg.cdpUrl });
  if (!alive) {
    warn('未检测到调试端口。请先：npm run launch-cursor');
    process.exit(2);
  }

  const browser = await connectCdp(cfg);
  const pages = await listPages(browser);
  info(
    'pages',
    pages.map((p) => p.url),
  );

  const page = await pickTargetPage(browser, cfg);
  if (!page) {
    warn('no target page');
    process.exit(3);
  }

  const scan = await scanDisconnect(page, cfg);
  info('scan', scan);
  console.log('\n=== PROBE OK ===');
  console.log(JSON.stringify({ url: page.url(), scan }, null, 2));
  browser.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
