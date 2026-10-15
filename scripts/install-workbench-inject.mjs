/**
 * cursor-agent-keepalive — 安装到 Cursor workbench
 * 拷贝 inject-keepalive.js，并在 workbench.html 挂 <script src>（CSP 禁止 inline）。
 *
 *   node scripts/install-workbench-inject.mjs
 * 然后 Ctrl+Shift+P → Developer: Reload Window
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const injectSrc = path.join(root, 'inject-keepalive.js');

const MARK_START = '<!-- !! CURSOR-CHAT-KEEPALIVE-START !! -->';
const MARK_END = '<!-- !! CURSOR-CHAT-KEEPALIVE-END !! -->';
const SCRIPT_NAME = 'cursor-chat-keepalive.js';

const candidates = [
  path.join('D:', 'ProgramFiles', 'cursor', 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench'),
  path.join(
    process.env.LOCALAPPDATA || '',
    'Programs',
    'cursor',
    'resources',
    'app',
    'out',
    'vs',
    'code',
    'electron-sandbox',
    'workbench',
  ),
  path.join(
    process.env.LOCALAPPDATA || '',
    'Programs',
    'Cursor',
    'resources',
    'app',
    'out',
    'vs',
    'code',
    'electron-sandbox',
    'workbench',
  ),
];

function findWorkbenchDirs() {
  const dirs = [];
  const seen = new Set();
  for (const dir of candidates) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const html = path.join(dir, 'workbench.html');
    if (fs.existsSync(html)) dirs.push(dir);
  }
  const extraHtml = [
    path.join('D:', 'ProgramFiles', 'cursor', 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
    path.join('D:', 'ProgramFiles', 'cursor', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
    path.join('D:', 'ProgramFiles', 'cursor', 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.html'),
  ];
  for (const html of extraHtml) {
    const dir = path.dirname(html);
    if (fs.existsSync(html) && !seen.has(dir)) {
      seen.add(dir);
      dirs.push(dir);
    }
  }
  return dirs;
}

function patchHtml(html) {
  // 必须用外部 script src：Cursor CSP 禁止 unsafe-inline
  html = html.replace(
    new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}\\n?`, 'g'),
    '',
  );
  const snippet =
    `${MARK_START}\n` +
    `<script src="./${SCRIPT_NAME}"></script>\n` +
    `${MARK_END}\n`;
  if (!html.includes('</head>')) {
    throw new Error('workbench.html missing </head>');
  }
  return html.replace('</head>', `${snippet}</head>`);
}

function main() {
  const dirs = findWorkbenchDirs();
  if (!dirs.length) {
    console.error('找不到 Cursor workbench 目录');
    process.exit(1);
  }
  const code = fs.readFileSync(injectSrc, 'utf8');
  const userJs = path.join(
    process.env.APPDATA || '',
    'Cursor',
    'User',
    'cursor-chat-keepalive.js',
  );
  if (userJs) {
    try {
      fs.mkdirSync(path.dirname(userJs), { recursive: true });
      fs.writeFileSync(userJs, code, 'utf8');
    } catch (e) {
      console.warn('User 副本写入失败（可忽略）', e.message);
    }
  }

  for (const dir of dirs) {
    const htmlPath = path.join(dir, 'workbench.html');
    const destJs = path.join(dir, SCRIPT_NAME);
    fs.writeFileSync(destJs, code, 'utf8');
    const bak = htmlPath + '.bak-keepalive';
    if (!fs.existsSync(bak)) {
      fs.copyFileSync(htmlPath, bak);
      console.log('备份:', bak);
    }
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = patchHtml(html);
    try {
      fs.writeFileSync(htmlPath, html, 'utf8');
    } catch (e) {
      console.error('写入失败（需要管理员权限）:', htmlPath, e.message);
      process.exit(2);
    }
    console.log('OK 外部脚本注入:', htmlPath);
    console.log('OK 脚本文件:', destJs);
  }
  console.log('下一步: Ctrl+Shift+P → Developer: Reload Window');
  console.log('验收: 右下角 keepalive ON；用量墙→「继续」；错误浮层→Resume/Try again');
}

main();
