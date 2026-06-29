# CDP 原生实现陷阱与解决方案

## 2025-06-29 测试记录

### 问题1：puppeteer-core 违反技能协议
**症状**: 技能 SKILL.md 明确禁止外部自动化库，但 `nexus-automation.js` 使用了 `puppeteer-core`。
**后果**: 触发 Nexus Mods 的 Cloudflare 反爬虫检测，页面被拦截。
**修复**: 完全移除 `puppeteer-core`，改用原生 `ws` 模块连接 CDP。

### 问题2：WebSocket 连接层级错误
**症状**: `Session with given id not found.`
**原因**: 连接到了 Browser 级别 WS (`/devtools/browser/...`)，但执行了 Page 级别命令。
**修复**: 从 `http://127.0.0.1:9222/json/list` 获取 Page 级别 WS (`/devtools/page/...`) 并直接连接。

```javascript
const targets = await fetchJson('http://127.0.0.1:9222/json/list');
const page = targets.find(t => t.type === 'page' && !t.url.startsWith('chrome://'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
```

### 问题3：Runtime.evaluate 语法错误
**症状**: `SyntaxError: Unexpected token 'const'` 或 `Invalid parameters`
**原因**: CDP 的 `Runtime.evaluate` 对表达式语法敏感：
- 模板字符串嵌套导致引号解析错误
- `awaitPromise: true` 参数不被接受
- 箭头函数在某些 Chrome 版本下解析失败

**修复**: 使用 ES5 语法编写所有 evaluate 表达式：
```javascript
// ❌ 错误
const result = await client.evaluate(`
  (() => {
    const mods = [];
    const links = document.querySelectorAll('a');
    return links.map(a => a.href);
  })()
`);

// ✅ 正确
const expr = `
(function() {
  var mods = [];
  var links = document.querySelectorAll('a');
  return Array.from(links).map(function(a) { return a.href; });
})()
`.trim();
const result = await client.evaluate(expr);
```

### 问题4：Next.js 客户端渲染延迟
**症状**: `document.querySelectorAll('.mod-tile')` 返回 0，但页面文本显示有内容。
**原因**: Nexus Mods 使用 Next.js，初始 HTML 只有 `<script>` 标签，DOM 由 JS 客户端渲染。
**修复**: 导航后等待 5 秒让 JS 执行完成：
```javascript
await client.navigate(url);
await delay(5000); // 等待 Next.js hydration
```

### 问题5：Tailwind CSS 类名选择器
**症状**: `.mod-tile` 选择器匹配不到元素。
**原因**: Nexus Mods 使用 Tailwind CSS，实际类名是 `group/mod-tile relative`（包含空格）。
**修复**: 使用属性选择器或文本内容定位：
```javascript
// ❌ 错误
document.querySelectorAll('.mod-tile')

// ✅ 正确 - 方法1：属性包含
document.querySelectorAll('[class*="mod-tile"]')

// ✅ 正确 - 方法2：通过 heading 定位容器
const heading = Array.from(document.querySelectorAll('h2, h3, h4'))
  .find(function(h) { return h.textContent.includes('Trending Mods'); });
const container = heading.parentElement;
const links = container.querySelectorAll('a[href*="/mods/"]');
```

### 问题6：Page.loadEventFired 不可靠
**症状**: `等待事件 Page.loadEventFired 超时`
**原因**: Next.js 页面持续加载资源（广告、追踪脚本），`load` 事件可能不触发或延迟很久。
**修复**: 不使用事件等待，改用固定延迟：
```javascript
// ❌ 错误
await this.waitForEvent('Page.loadEventFired', 15000);

// ✅ 正确
await delay(5000);
```

### 问题7：Nexus Mods URL 格式陷阱（2025-06-29）
**症状**: 访问 `/mods?sort=endorsements&timeRange=7` 被重定向到具体 MOD 页面或首页，参数丢失。
**原因**: Nexus Mods 使用两种 URL 结构：
- 正确：`https://www.nexusmods.com/games/skyrimspecialedition/mods`（带 `/games/` 前缀）
- 错误：`https://www.nexusmods.com/skyrimspecialedition/mods`（不带 `/games/` 前缀，会被重定向）

**修复**: 始终使用带 `/games/` 前缀的 URL：
```javascript
// ❌ 错误 - 会被重定向
const url = `https://www.nexusmods.com/${gameDomain}/mods?sort=endorsements&timeRange=7`;

// ✅ 正确
const url = `https://www.nexusmods.com/games/${gameDomain}/mods?sort=endorsements&timeRange=7`;
```

### 问题8：MOD 列表数据提取（2025-06-29）
**症状**: 提取的数据包含噪音（如 "Updated since last downloaded"）、作者名包含下载数、标题为空。
**原因**: 
1. 使用 `a[href*="/mods/"]` 选择器会匹配到多个链接（标题、作者、分类等）
2. 直接从 `innerText` 提取文本会包含所有子元素的文本

**修复**: 使用 `data-e2eid` 属性精确定位元素：
```javascript
// ❌ 错误 - 会匹配到多个链接，数据混乱
var links = tile.querySelectorAll('a[href*="/mods/"]');

// ✅ 正确 - 精确定位标题和作者
var titleEl = tile.querySelector('[data-e2eid="mod-tile-title"]');
var authorEl = tile.querySelector('[data-e2eid="user-link"]');

// 从 innerText 行数组提取统计数字
var allText = tile.innerText.split('\n');
var endorsements = 'N/A';
var downloads = 'N/A';
for (var j = 0; j < allText.length; j++) {
  if (allText[j] === 'Endorsements' && j + 1 < allText.length) {
    endorsements = allText[j + 1].trim();
  }
  if (allText[j] === 'Downloads' && j + 1 < allText.length) {
    downloads = allText[j + 1].trim();
  }
}
```

### 问题9：DOM 选择器匹配（2025-06-29）
**症状**: `.mod-tile` 选择器匹配不到元素，但页面显示有 MOD 列表。
**原因**: Nexus Mods 使用 Tailwind CSS 的类名格式如 `group/mod-tile relative`（包含斜杠和空格），不是简单的 `mod-tile`。
**修复**: 使用属性包含选择器或精确定位：
```javascript
// ❌ 错误
document.querySelectorAll('.mod-tile')

// ✅ 正确 - 方法1：属性包含
document.querySelectorAll('[class*="mod-tile"]')

// ✅ 正确 - 方法2：通过 mods-grid 容器遍历子元素
var grid = document.querySelector('.mods-grid');
var tiles = grid.children;
```

### 问题10：成人内容标志检测（2025-06-29）
**症状**: `isAdult` 始终为 `false`，即使 MOD 明显是成人内容（如 "Mia UBE Follower"）。
**原因**: 成人内容标志 `"Adult"` 在 innerText 中不是独立行，而是和分类文本连在一起：
```
"Followers & CompanionsAdult"  // 分类 + Adult 连在一起
"ArmourAdult"                   // 分类 + Adult 连在一起
```
原来的检测代码 `text === 'Adult'` 永远不会匹配。

**修复**: 使用 `includes('Adult')` 和 `endsWith('Adult')` 检测：
```javascript
// ❌ 错误 - 永远不会匹配
if (text === 'Adult') {
  isAdult = true;
}

// ✅ 正确 - 检测包含 Adult 的文本
if (text === 'Adult' || text.includes('Adult')) {
  // 排除 false positive（如 "Adult" 是作者名或标题的一部分）
  // 检查是否紧跟在分类后面
  if (text === 'Adult' || text.endsWith('Adult')) {
    isAdult = true;
  }
}
```

**DOM 中的 Adult 标志结构**：
```html
<span class="text-body-sm text-danger-strong"><span>Adult</span></span>
```
在 innerText 中表现为分类文本后紧跟 `"Adult"`：
```
Followers & CompanionsAdult
ArmourAdult
```

### 问题12：Track/Endorse/Vote 按钮 DOM 结构与点击（2025-06-29 更新）
**症状**: `btn.click()` 和 `getBoundingClientRect()` 返回 0，按钮点击无效。
**原因**:
1. 每个操作（Track/Endorse/Vote）有两个 `<li>` 元素：一个可见（激活状态），一个隐藏（`display: none`）
2. 使用 `querySelector('a.toggle-track-mod')` 会匹配到第一个（隐藏的）按钮，其 `getBoundingClientRect` 全为 0
3. React 的事件系统会忽略 `btn.click()` 触发的点击，需要真实的鼠标事件

**解决方案**: 拆分为三个独立函数 `trackMod()`、`endorseMod()`、`voteMod()`，每个函数：
- 使用 `li[id^="action-track-"]` / `li[id^="action-untrack-"]` 等选择器定位可见按钮
- 通过 CDP `Input.dispatchMouseEvent` 模拟真实鼠标点击
- 点击后刷新页面验证状态变化
- 支持 `toggle` 模式（自动切换状态）

**正确的 DOM 结构**（每个操作有两个互斥的 `<li>`）：
```html
<!-- Track：未追踪时显示，已追踪时隐藏 -->
<li id="action-track-1704-183263" style="display:none;">
  <a class="btn inline-flex toggle-track-mod" data-do-track="1">
    <span class="flex-label">Track</span>
  </a>
</li>
<!-- Track：已追踪时显示，未追踪时隐藏 -->
<li id="action-untrack-1704-183263" style="">
  <a class="btn inline-flex btn-active toggle-track-mod" data-do-track="0">
    <span class="flex-label">Tracking</span>
  </a>
</li>

<!-- Endorse：未点赞时显示，已点赞时隐藏 -->
<li id="action-endorse-1704-183263" style="display:none;">
  <a class="btn inline-flex endorse-mod" data-positive="1">
    <span class="flex-label">Endorse</span>
  </a>
</li>
<!-- Endorse：已点赞时显示，未点赞时隐藏 -->
<li id="action-unendorse-1704-183263" style="">
  <a class="btn btn-active inline-flex endorse-mod" data-positive="0">
    <span class="flex-label">Endorsed</span>
  </a>
</li>

<!-- Vote：未投票时显示，已投票时隐藏 -->
<li id="action-vote-1704-183263" style="display:none;">
  <a class="btn inline-flex vote-mod" data-positive="1">
    <span class="flex-label">Vote</span>
  </a>
</li>
<!-- Vote：已投票时显示，未投票时隐藏 -->
<li id="action-novote-1704-183263" style="">
  <a class="btn btn-active inline-flex vote-mod" data-positive="0">
    <span class="flex-label">Voted</span>
  </a>
</li>
```

**修复 - 选择器必须匹配可见的按钮**：
```javascript
// ❌ 错误 - 匹配到隐藏的按钮，getBoundingClientRect 全为 0
var btn = document.querySelector('a.toggle-track-mod');

// ✅ 正确 - 匹配可见的按钮
var btn = document.querySelector('li[id^="action-track-"] a.toggle-track-mod');
var visible = window.getComputedStyle(btn.parentElement).display !== 'none';
```

**修复 - 使用 CDP Input.dispatchMouseEvent 模拟真实点击**：
```javascript
// ❌ 错误 - React 忽略 btn.click()
btn.click();

// ✅ 正确 - 使用 CDP 发送真实鼠标事件
const rect = await client.evaluate(`
(function() {
  var btn = document.querySelector('li[id^="action-track-"] a.toggle-track-mod');
  var rect = btn.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()
`);
await client.send('Input.dispatchMouseEvent', { 
  type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 
});
await delay(100);
await client.send('Input.dispatchMouseEvent', { 
  type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 
});
```

**修复 - 点击后需要刷新页面验证状态**：
```javascript
// 点击后等待 AJAX 完成
await delay(2000);

// 刷新页面验证新状态
await client.navigate(url);
await delay(3000);

// 重新检查按钮状态
var isTracked = document.querySelector('li[id^="action-untrack-"] a.toggle-track-mod') !== null;
```

**关键状态检测逻辑**（toggle 模式）：
```javascript
// Track
var trackedBtn = document.querySelector('li[id^="action-untrack-"] a.toggle-track-mod');
if (trackedBtn && window.getComputedStyle(trackedBtn.parentElement).display !== 'none') {
  return 'already_Tracking'; // 已追踪，toggle 模式下点击取消
}
var trackBtn = document.querySelector('li[id^="action-track-"] a.toggle-track-mod');
if (trackBtn && window.getComputedStyle(trackBtn.parentElement).display !== 'none') {
  return 'ready_to_click'; // 未追踪，点击追踪
}

// Endorse
var endorsedBtn = document.querySelector('li[id^="action-unendorse-"] a.endorse-mod');
if (endorsedBtn && window.getComputedStyle(endorsedBtn.parentElement).display !== 'none') {
  return 'already_Endorsed'; // 已点赞，toggle 模式下点击取消
}
var endorseBtn = document.querySelector('li[id^="action-endorse-"] a.endorse-mod');
if (endorseBtn && window.getComputedStyle(endorseBtn.parentElement).display !== 'none') {
  return 'ready_to_click'; // 未点赞，点击点赞
}

// Vote
var votedBtn = document.querySelector('li[id^="action-novote-"] a.vote-mod');
if (votedBtn && window.getComputedStyle(votedBtn.parentElement).display !== 'none') {
  return 'already_Voted'; // 已投票，toggle 模式下点击取消
}
var voteBtn = document.querySelector('li[id^="action-vote-"] a.vote-mod');
if (voteBtn && window.getComputedStyle(voteBtn.parentElement).display !== 'none') {
  return 'ready_to_click'; // 未投票，点击投票
}
```

**Endorse/Vote 的前提条件**：
- `icon-tick-blue` 图标表示已下载过该 MOD
- Endorse 和 Vote 需要已下载才能操作（未下载时点击无效）
- 下载历史在 `.modhistory` 元素中显示："You last downloaded a file from this mod on ..."

**CLI 命令**（已拆分为独立命令）：
```bash
# 追踪/取消追踪
node nexus-automation.js track 183263 [toggle]

# 点赞/取消点赞
node nexus-automation.js endorse 183263 [toggle]

# 投票/取消投票
node nexus-automation.js vote 183263 [toggle]
```

**向后兼容**：
- `trackAndEndorse()` 函数仍然可用，内部调用 `trackMod()`、`endorseMod()`、`voteMod()`
- 但 CLI 中已移除 `track-endorse` 命令，推荐使用独立的 `track`、`endorse`、`vote` 命令

### 问题13：evaluate() 模板字符串变量注入陷阱（2026-06-29）

**症状**: `evaluate()` 返回的对象中 `keyword` 和 `page` 字段值为 `"undefined"`，或浏览器报告 `ReferenceError: keyword is not defined`。

**原因**: 在 Node.js 的回勾模板字符串中，`' + variableName + '` 是**字面文本**，不是运行时拼接。`client.evaluate()` 接收的是整个模板字符串的最终结果，而此时 `' + keyword + '` 被原封不动地发送到浏览器。浏览器执行时，`keyword` 在浏览器作用域中不存在。

```javascript
// ❌ 错误 — ' + keyword + ' 在模板字符串中是字面文本
const result = await client.evaluate(`
  (function() {
    return { keyword: "' + keyword + '", page: "' + page + '" };
  })()
`);
// 浏览器收到：return { keyword: "' + keyword + '", page: "' + page + '" };
// keyword 和 page 在浏览器中未定义 → 结果为 "undefined"
```

**修复**: 使用 `${}` 模板插值将 Node.js 变量注入 evaluate 表达式：
```javascript
// ✅ 正确 — ${keyword} 在 Node.js 层面被插值
const result = await client.evaluate(`
  (function() {
    var kw = '${keyword.replace(/'/g, "\\'")}';
    var pg = '${page}';
    return { keyword: kw, page: pg };
  })()
`);
```

**何时使用哪种模式**:
| 模式 | 用途 | 示例 |
|------|------|------|
| `${variable}` | Node.js → 浏览器变量注入 | `var keyword = '${kw}';` |
| `' + variable + '` | 仅在非模板字符串（普通引号字符串）中有效 | 不应在 `evaluate()` 中使用 |
| `\\'` 转义 | 防止变量值中的单引号破坏 JS 语法 | `'${str.replace(/'/g, "\\'")}'` |

**关键教训**: 在 `client.evaluate(\`...\`)` 的模板字符串内部，必须使用 `${}` 进行 Node.js 变量插值，不能混用 `' + var + '` 拼接语法。这是一个极易被忽略的陷阱，因为视觉上 `' + keyword + '` 看起来像是合法的字符串拼接。

### 问题14：模板字面量中的控制字符转义陷阱（2026-06-29）

**症状**: `client.evaluate()` 抛出 `SyntaxError: Invalid or unexpected token`，但 `node --check` 验证脚本语法通过。

**原因**: 在 Node.js 回勾模板字符串中，转义序列 `\r`、`\n`、`\t` 会被**解析为真正的控制字符**（回车、换行、制表符），而不是保留为字面文本 `\r`、`\n`、`\t`。当生成的字符串被发送到浏览器执行时，控制字符会破坏 JavaScript 语法。

**具体案例** — 分页链接 onclick 处理：
```javascript
// ❌ 错误 — 模板字面量中 \r \n \t 被解析为控制字符
const result = await client.evaluate(`
  (function() {
    var onclick = link.getAttribute('onclick') || '';
    // \r → 回车符(0x0D), \n → 换行符(0x0A), \t → 制表符(0x09)
    var cleaned = onclick.split('\\r').join(' ').split('\\n').join(' ').split('\\t').join(' ');
    // 相当于 .split('\r').join(' ')  — 按回车分割！
    var match = cleaned.match(/Send\\('page',\\s*'(\\d+)'\\)/);
    // 生成的 JS 字符串中包含实际换行符 → SyntaxError
  })()
`);
```

**生成的实际字符串（浏览器视角）**：
```javascript
.split('␍').join(' ').split('␊').join(' ').split('␉').join(' ');
// ␍␊␉ 是实际控制字符，其中 ␊ 会在字符串中间产生真实换行 → SyntaxError
```

**修复方案 A** — 使用 `${}` 注入 Node.js 变量（推荐）：
```javascript
const result = await client.evaluate(`
  (function() {
    var onclickRaw = link.getAttribute('onclick') || '';
    // 直接在 onclickRaw 上匹配，无需 split 清理
    var match = onclickRaw.match(/Send\\('page',\\s*'(\\d+)'\\)/);
  })()
`);
```

**修复方案 B** — 双倍转义反斜杠：
```javascript
// ✅ 正确 — \\\\r 在模板中 → \\r 在浏览器中（2 字符：反斜杠 + r）
var cleaned = onclick.split('\\\\r').join(' ').split('\\\\n').join(' ').split('\\\\t').join(' ');
// 模板处理：\\\\ → \\ → 浏览器看到 '\\r' = 字符串 "\r"（反斜杠+r）
```

**修复方案 C** — 避免在模板字面量的单引号字符串中使用转义序列：
```javascript
// ✅ 正确 — 直接操作原始字符串，跳过 split 清理步骤
var onclickRaw = (pageLinks[p].getAttribute('onclick') || '');
var pageMatch = onclickRaw.match(/Send\\('page',\\s*'(\\d+)'\\)/);
```

**根本原因总结**:

| 写法 | 在模板字面量中 | 浏览器收到的 JS | 结果 |
|------|-------------|--------------|------|
| `'\\r'` | `\r`（回车符 0x0D） | `.split('\r')`（按回车分割） | ⚠️ 非预期行为 |
| `'\\\\r'` | `\\r`（2 字符：`\` + `r`） | `.split('\\r')`（字符串 `\r`） | ✅ 正确 |
| 避免 split | N/A | 直接匹配原始字符串 | ✅ 最简洁 |

**关键教训**: 在 `client.evaluate(\`...\`)` 模板字面量内的单引号/双引号字符串中，所有反斜杠转义序列（`\r`、`\n`、`\t`、`\\` 等）都会在 Node.js 层面被解析。要保留字面反斜杠，必须双倍转义。最简单的方案是避免在模板字面量内的引号字符串中使用这些转义序列，改为直接操作原始字符串。

### 问题11：React/Headless UI 搜索框交互失败（2025-06-29）
**症状**: `searchMods` 函数报错 "未找到搜索框"，无法通过 DOM 操作触发搜索。
**原因**: Nexus Mods 的主搜索框使用 React/Headless UI 实现，没有标准的 `type="search"` 属性。搜索框的交互逻辑通过 React 事件系统处理，直接操作 DOM（`input.value = ...` + `dispatchEvent`）无法触发实际的搜索行为。

**修复**: 放弃 DOM 搜索框交互，改用 **URL 参数直接搜索**：
```javascript
// ❌ 错误 - 尝试操作 React 搜索框，不可靠
await client.type('input[type="search"]', keyword);
await client.evaluate(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`);

// ✅ 正确 - 直接构造搜索 URL
const searchUrl = `https://www.nexusmods.com/games/${gameDomain}/mods?keyword=${encodeURIComponent(keyword)}`;
await client.navigate(searchUrl);
await delay(5000);
```

**Nexus Mods 搜索 URL 参数大全**（2025-06-29 实测）：
```
https://www.nexusmods.com/games/skyrimspecialedition/mods
  ?keyword=skyui           # 搜索关键词
  &sort=endorsements       # 排序：endorsements, downloads, updated, name
  &timeRange=7             # 时间范围：7, 30, 365
  &sortDirection=ASC       # 排序方向：ASC, DESC
  &count=20                # 每页结果数
  &categoryName=Gameplay   # 分类筛选
  &tag=Polish              # 包含标签
  &excludedTag=Translation # 排除标签
  &title=skyui             # 标题包含
  &description=skyui       # 描述包含
  &author=schlangster      # 作者包含
  &uploader=schlangster    # 上传者包含
  &adultContent=false      # 成人内容：true, false
```

**关键教训**: 对于现代 React/Next.js 网站，优先检查搜索是否可通过 URL 参数直接实现，这比尝试模拟 UI 交互更可靠。

## 推荐 CDP 客户端模式

```javascript
const WebSocket = require('ws');

class CDPClient {
  constructor() {
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
  }

  async connect(wsEndpoint) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsEndpoint);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data) => this._onMessage(data));
    });
  }

  _onMessage(data) {
    const msg = JSON.parse(data.toString());
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      this.id += 1;
      const id = this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true
    });
    if (response?.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || 'JS 执行错误');
    }
    return response?.result?.value;
  }

  async navigate(url) {
    await this.send('Page.enable').catch(() => {});
    await this.send('Page.navigate', { url });
    await delay(5000); // 等待 Next.js 客户端渲染
  }

  disconnect() {
    if (this.ws) this.ws.close();
  }
}

async function connectToPage() {
  const targets = await fetchJson('http://127.0.0.1:9222/json/list');
  const page = targets.find(t => 
    t.type === 'page' && 
    !t.url.startsWith('chrome://') && 
    !t.url.startsWith('chrome-extension://')
  );
  const client = new CDPClient();
  await client.connect(page.webSocketDebuggerUrl);
  return client;
}
```
