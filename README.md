# Cursor Chat Keepalive

在 Cursor Agent 对话里自动处理两类打断，减少卡死、额度墙后要手动点的麻烦。

| 场景 | 行为 |
|------|------|
| **用量墙**（You've hit your usage limit / Upgrade to Pro） | 检测到浮层后等约 **2 秒**，自动往输入框发一次「继续」（只点发送态按钮，不点语音键） |
| **可重试错误**（Connection failed / Internal / Server error 等） | 浮层出现 **Resume** 或 **Try again** 时自动点一次 |

主路径是往 Cursor 的 `workbench.html` 注入脚本（不依赖 CDP）。仓库里也保留可选的 Puppeteer/CDP 方案。

---

## 推荐用法：Workbench 注入（主方案）

### 要求

- 已安装 [Node.js](https://nodejs.org/) ≥ 18
- Windows 上 Cursor 常见路径：
  - `D:\ProgramFiles\cursor\...`
  - 或 `%LOCALAPPDATA%\Programs\cursor\...`
- 写入 Cursor 安装目录可能需要**管理员权限**

### 安装

```bash
cd cursor-chat-keepalive
node scripts/install-workbench-inject.mjs
```

脚本会：

1. 把 `inject-keepalive.js` 拷到 workbench 目录，名为 `cursor-chat-keepalive.js`
2. 在 `workbench.html` 的 `</head>` 前插入外部 `<script src>`（Cursor CSP 禁止 inline）

然后：

1. `Ctrl+Shift+P` → **Developer: Reload Window**
2. 右下角应出现绿色 HUD：`keepalive ON`

### 验收

- 用量墙出现 → HUD 先显示 `wait 2s` → 再 `sent 继续`，聊天里只出现**一条**「继续」
- Connection / 可重试错误 → HUD 显示 `clicked Resume` 或 `clicked Try again`
- 发送时**不会**误开 Voice call（空输入时同槽位是语音按钮，有内容才是发送）

### 改脚本后

```bash
node scripts/install-workbench-inject.mjs
```

再 Reload Window。Cursor 大版本更新若覆盖了 `workbench.html`，重新跑一次安装即可。

### 控制台调试

在 Cursor 开发者工具 Console：

```js
__cursorKeepaliveStatus()  // 运行状态
__cursorKeepalivePing()    // 强制立刻扫一轮
__cursorKeepaliveReset()   // 清冷却 / 已发送标记
__cursorKeepaliveStop()    // 停止
```

---

## 行为说明（摘要）

- **只认真实浮层**，不扫聊天气泡里的 usage limit 字样（避免误发）
- 用量墙：**同一浮层只发一次**「继续」；浮层消失后才允许下一轮
- 发送按钮：识别 `data-component`——空输入是 `realtime-voice-start`（语音），有内容是 `prompt-input-submit-button`（发送）；语音态绝不点击
- Resume / Try again：平时 DOM 里没有，错误浮层才会挂；一出现就点，同一次只点一次

---

## 可选：CDP / Puppeteer 方案

若不想改 workbench，可用远程调试端口 + Puppeteer（需自行用调试参数启动 Cursor）：

```bash
npm install
npm start
```

配置见 `config.json`。日常更推荐上面的 **Workbench 注入**。

---

## 目录

```
inject-keepalive.js              # 注入到 Cursor 的核心逻辑
scripts/install-workbench-inject.mjs
HOW-TO.txt                       # 简短中文备忘
config.json                      # CDP 方案配置
src/                             # CDP / 探测相关
test-harness.html                # 本地简易检测页
```

---

## 注意

- 会修改本机 Cursor 安装目录下的文件；升级 Cursor 后可能需重装注入
- 仅供个人自动化使用；请自行评估对 Cursor 客户端的影响
- 不要把含密钥的个人配置提交进仓库
