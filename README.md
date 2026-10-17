# cursor-agent-keepalive

给 Cursor **Agent** 用的本机保活小工具：额度墙和可重试错误浮层出现时自动处理，少手动点。

## 实际做什么

| 浮层场景 | 自动动作 |
|----------|----------|
| 用量墙（You've hit your usage limit / Upgrade to Pro 等） | 等约 **2 秒** → 输入框发一次「继续」（只点**发送**态按钮，不点空输入时的语音键） |
| 可重试错误（Connection failed / stalled、Server error、Agent connection lost 等） | 一出现 **Resume** 或 **Try again** 就点一次 |
| 营销弹窗（如 **Cursor is now on iOS** / Download now） | 自动点右上角叉号关掉（找不到叉则 Esc） |

同一次浮层只处理一次；浮层消失后再出现才会再动。

**主方案**：把脚本注入 Cursor 的 `workbench.html`（不依赖 CDP）。  
**可选**：Puppeteer 连远程调试端口（旧路径，不如注入省事）。

---

## 安装（Workbench 注入）

需要 Node.js ≥ 18。写入 Cursor 安装目录时可能要管理员权限。

```bash
git clone https://github.com/Luochenself/cursor-agent-keepalive.git
cd cursor-agent-keepalive
node scripts/install-workbench-inject.mjs
```

安装脚本会：

1. 复制 `inject-keepalive.js` → workbench 下的 `cursor-chat-keepalive.js`
2. 在 `workbench.html` 挂外部 `<script src>`（CSP 禁止 inline）

然后：

1. Cursor：`Ctrl+Shift+P` → **Developer: Reload Window**
2. 右下角绿色 HUD：`keepalive ON`

改逻辑后重新跑 install，再 Reload。Cursor 大版本更新若覆盖 `workbench.html`，再装一次。

常见安装路径：`D:\ProgramFiles\cursor\...` 或 `%LOCALAPPDATA%\Programs\cursor\...`。

### 验收

- 用量墙 → HUD：`wait 2s` → `sent 继续`（只一条）
- Connection 类错误 → HUD：`clicked Resume` / `clicked Try again`
- 不应误开 Voice call

### Console

```js
__cursorKeepaliveStatus()
__cursorKeepalivePing()
__cursorKeepaliveReset()
__cursorKeepaliveStop()
```

---

## 可选：CDP 方案

需用 `--remote-debugging-port=9222` 启动 Cursor：

```bash
npm install
npm run launch-cursor
npm start
```

配置见 `config.json`。日常请优先用上面的注入方案。

---

## 目录

| 路径 | 说明 |
|------|------|
| `inject-keepalive.js` | 注入核心：额度墙 + Resume/Try again |
| `scripts/install-workbench-inject.mjs` | 安装到 Cursor workbench |
| `HOW-TO.txt` | 中文短备忘 |
| `config.json` / `src/` | CDP 可选方案 |
| `test-harness.html` | 本地简易检测页 |

---

## 注意

- 会改本机 Cursor 安装目录文件；升级后可能要重装注入
- 仅供个人自动化；请自行评估影响
- 不要提交含密钥的本机配置
