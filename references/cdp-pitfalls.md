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
- **追踪中心页面尤甚** — 即使 Chrome 150 支持 ES6，该页面仍拒绝 `const`/`?.`/arrow function（见问题16）

**修复**: 使用 ES5 语法编写所有 evaluate 表达式：
```javascript
// ❌ 错误 — ES6 语法
const result = await client.evaluate(`
  (() => {
    const mods = [];
    return document.querySelectorAll('a').length;
  })()
`);

// ✅ 正确 — ES5 语法 + 字符串拼接
var expr = "(function() {\n" +
  "  var mods = [];\n" +
  "  return document.querySelectorAll('a').length;\n" +
  "})()";
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
**修复**: 使用属性选择器或通过容器定位：
```javascript
// ❌ 错误
document.querySelectorAll('.mod-tile')

// ✅ 正确 — 属性包含
document.querySelectorAll('[class*="mod-tile"]')

// ✅ 正确 — 通过 mods-grid 遍历子元素
var grid = document.querySelector('.mods-grid');
var tiles = grid.children;
```

### 问题6：Page.loadEventFired 不可靠
**症状**: `等待事件 Page.loadEventFired 超时`
**原因**: Next.js 页面持续加载资源（广告、追踪脚本），`load` 事件可能不触发。  
**修复**: 不使用事件等待，改用固定延迟 `delay(5000)`。

### 问题7：Nexus Mods URL 格式陷阱
**症状**: 访问 `/skyrimspecialedition/mods` 被重定向到具体 MOD 页或首页。
**原因**: Nexus Mods 有两种 URL 结构，不带 `/games/` 前缀会被 Next.js 路由重定向。  
**修复**: 始终使用 `https://www.nexusmods.com/games/{gameDomain}/mods`。

**额外陷阱 — 功能11-13 的 URL 错误**:
| 功能 | 错误 URL | 正确 URL |
|------|---------|---------|
| Tracking Centre | `/users/trackingcentre` | `/mods/trackingcentre?tab=mods` |
| Download History | `/users/downloadhistory` | `/users/myaccount?tab=download+history` |
| API Keys | `/settings/preferences` | `/settings/api-keys` |

### 问题8：MOD 列表数据提取
**症状**: 提取的数据包含噪音（"Updated since last downloaded"）、标题为空。  
**修复**: 使用 `data-e2eid` 属性精确定位标题和作者，从 innerText 行数组提取统计数字。

### 问题9：DOM 选择器匹配
同问题5，Tailwind 类名问题。

### 问题10：成人内容标志检测
**症状**: `isAdult` 始终为 `false`。  
**原因**: `"Adult"` 在 innerText 中与分类文本连接（如 `"ArmourAdult"`）。  
**修复**: 改用 `text.includes('Adult')` 检测。

### 问题11：React/Headless UI 搜索框交互失败
**症状**: 无法通过 DOM 操作触发搜索。  
**原因**: Nexus Mods 搜索框使用 React，直接操作 DOM 不触发搜索。  
**修复**: 放弃 UI 交互，改用 URL 参数直接搜索 `?keyword=...`。  
**关键教训**: 对于 React/Next.js 网站，优先检查搜索是否可通过 URL 参数实现。

### 问题12：Track/Endorse/Vote 按钮 DOM 结构
**症状**: `btn.click()` 无效，`getBoundingClientRect` 返回 0。  
**原因**: 每个操作有两个互斥 `<li>`（可见/隐藏），querySelector 可能匹配隐藏的元素。React 忽略 `click()`。  
**修复**: 使用 `li[id^="action-track-"]` 定位可见按钮，通过 `Input.dispatchMouseEvent` 发送真实鼠标事件。

### 问题13：evaluate() 模板字符串变量注入陷阱
**症状**: `evaluate()` 返回的字段值为 `"undefined"`。  
**原因**: 模板字符串中 `' + variable + '` 是字面文本，浏览器收到未定义的变量名。  
**修复**: 使用 `${variable}` 模板插值注入 Node.js 变量：
```javascript
// ✅ 正确 — ${keyword} 在 Node.js 层面被插值
var kw = '${keyword.replace(/'/g, "\\'")}';
```

### 问题14：模板字面量中的控制字符转义陷阱
**症状**: `SyntaxError: Invalid or unexpected token`。  
**原因**: 模板字符串中 `\r`/`\n`/`\t` 被解析为真正控制字符，破坏浏览器端 JS。  
**修复**: 直接操作原始字符串，避免在模板内使用转义序列。

---

## 2026-06-29 补充

### 问题15：Ghost `document.querySelector` 遗留在 Node.js 代码中

**症状**: 运行时抛出 `ReferenceError: document is not defined`。

**原因**: 重构 evaluate 表达式时，将浏览器端代码（`document.querySelector(...)`）意外留在 Node.js 函数体中：
```javascript
// ❌ 错误 — 遗留的浏览器代码行
async function accessDownloadHistory(client, query, page, action) {
  if (query && action === 'list') {
    var filterInput = document.querySelector('input[...]'); // ← Node.js 无 document！
    await client.evaluate("(function() { ... })()");
  }
}
```

**修复**: 删除 Node.js 代码体中的 DOM API 调用。只有 `evaluate()` 的字符串参数内才能使用 `document`。

**预防**: 任何包含 `document`、`window`、`querySelector` 的代码**必须**在 `evaluate()` 字符串内。

### 问题16：追踪中心页面的 ES6 特异性 SyntaxError

**症状**: 仅在 `/mods/trackingcentre` 页面，`const`/`?.`/箭头函数触发 `SyntaxError: Unexpected token 'const'`，同一表达式在其他 Nexus 页面正常。

**发现**: Chrome 150 原生支持所有 ES6+。同会话中：
- tracking centre → `const` SyntaxError
- download history → `const` OK  
- settings/api-keys → `const` OK

**结论**: tracking centre 页面存在未知机制干扰 `Runtime.evaluate`。为一致性和可靠性，**所有** evaluate 表达式统一使用 ES5。

---

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
    return new Promise(function(resolve, reject) {
      this.ws = new WebSocket(wsEndpoint);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', function(data) { this._onMessage(data); }.bind(this));
    }.bind(this));
  }

  _onMessage(data) {
    var msg = JSON.parse(data.toString());
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      var handlers = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) handlers.reject(new Error(msg.error.message));
      else handlers.resolve(msg.result);
    }
  }

  send(method, params) {
    params = params || {};
    return new Promise(function(resolve, reject) {
      this.id += 1;
      var id = this.id;
      this.pending.set(id, { resolve: resolve, reject: reject });
      this.ws.send(JSON.stringify({ id: id, method: method, params: params }));
    }.bind(this));
  }

  async evaluate(expression) {
    var response = await this.send('Runtime.evaluate', {
      expression: expression,
      returnByValue: true
    });
    if (response && response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception.description || 'JS error');
    }
    return response && response.result ? response.result.value : undefined;
  }

  async navigate(url) {
    await this.send('Page.enable').catch(function(){});
    await this.send('Page.navigate', { url: url });
    await delay(5000);
  }

  disconnect() {
    if (this.ws) this.ws.close();
  }
}
```
