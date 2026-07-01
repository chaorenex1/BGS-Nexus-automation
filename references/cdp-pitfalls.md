# CDP 原生实现陷阱与解决方案

## 2026-06-30 — evaluate() 三重 SyntaxError 修复

### 问题17：Windows CRLF 在 CDP 表达式中的 \r 控制字符

**症状**: 所有 evaluate 调用抛出 `SyntaxError: Invalid or unexpected token`。

**原因**: Windows 换行符 `\r\n` 在模板字面量中保留 `\r`（0x0D）。CDP `Runtime.evaluate` 将 `\r` 解析为控制字符，破坏 JS 语法。

**修复 — evaluate() 级别守卫（源代码中 MUST 用此形式）**:
```javascript
async evaluate(expression) {
    // ✅ 防 patch 工具破坏 — 动态构造 CR 正则，无字面 \r
    const sanitized = expression.replace(new RegExp(String.fromCharCode(13), 'g'), '');
    const response = await this.send('Runtime.evaluate', {
      expression: sanitized,
      returnByValue: true
    });
    // ...
}
```

⚠️ **Patch 工具二次破坏陷阱 (2026-07-01 实测)**：下面这种写法 **不能通过 patch/write_file 写入源文件**：
```javascript
// ❌ 被 patch 工具破坏: /\r/g 在写入时二次转义为物理 CR+LF
//    产生 /<换行>/g → SyntaxError: Invalid regular expression: missing /
const sanitized = expression.replace(/\r/g, '');
```
patch 工具会将 `\r` 二次转义为物理 CR+LF。涉及 `\r` 的源码修改请用 `execute_code` 做字节级替换。

### 问题18：字符串字面量中的字面换行符

**症状**: `SyntaxError: Invalid or unexpected token`，即使 `\r` 已被清除。

**原因**: `split('\n')` 在 CDP 表达式字符串中引入字面换行符（0x0A）。CDP 解析器无法处理字符串内部的物理换行 — 它把换行当作语句边界。

**修复**: 使用 `String.fromCharCode(10)` 替代：
```javascript
// ❌ 错误 — 字面换行符
var allText = tile.innerText.split('\n');

// ✅ 正确 — ES5 兼容
var allText = tile.innerText.split(String.fromCharCode(10));
```

**影响范围**: `getTrendingMods`, `searchMods`, `getModDetails`, `summarizeDescription` 中的 4 处 `split('\n')`。

### 问题19：`new RegExp()` 中的正则分隔符

**症状**: MOD ID 全部为 `"unknown"`，正则不匹配。

**原因**: `new RegExp('/mods/(\\d+)')` — `new RegExp` 的字符串参数是**正则模式**，不应包含 `/` 分隔符。`/mods/` 被当作字面 `/` 字符匹配，而非路径分隔符。

**修复**: 移除 `new RegExp` 中的 `/` 前缀：
```javascript
// ❌ 错误 — '/' 被当作字面字符
new RegExp('/mods/(\\\\d+)')

// ✅ 正确
new RegExp('mods/(\\\\d+)')
```

### 问题20：反斜杠三层转义级联

**架构**: 源文件(模板字面量) → Node.js 运行时 → CDP `Runtime.evaluate`

每层会消费一层转义：

| 层 | 输入 | 输出 | 说明 |
|----|------|------|------|
| 源文件 `\\\\d` | `\\\\` (4个0x5C) | `\\` (2个0x5C) | Node.js 模板字面量 |
| CDP 表达式 | `\\d` (2个0x5C) | `\d` | `new RegExp('mods/(\\d+)')` |
| RegExp 引擎 | `\d` | 数字字符类 | 最终正则模式 |

**陷阱**: 使用 `patch` 工具修改时，`new_string` 中的 `\\\\` 会被 double-escape。建议使用 `execute_code` 直接操作字节：
```python
# ✅ 直接操作字节避开转义级联
old = b"new RegExp('/mods/(\\\\\\\\d+)')"
new = b"new RegExp('mods/(\\\\\\\\d+)')"
content = content.replace(old, new)
```

---

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

**原因**: 重构 evaluate 表达式时，将浏览器端代码（`document.querySelector(...)`）意外留在 Node.js 函数体中。

**修复**: 删除 Node.js 代码体中的 DOM API 调用。只有 `evaluate()` 的字符串参数内才能使用 `document`。

### 问题16：追踪中心页面的 ES6 特异性 SyntaxError

**症状**: 仅在 `/mods/trackingcentre` 页面，`const`/`?.`/箭头函数触发 `SyntaxError: Unexpected token 'const'`。

**结论**: tracking centre 页面存在未知机制干扰 `Runtime.evaluate`。为一致性和可靠性，**所有** evaluate 表达式统一使用 ES5。

### 问题21：React 受控输入组件 — `/games` 页面的 Game Filter 陷阱 (2026-07-01)

**症状**: 设置 `input#keyword-game.value = 'skyrim'` 后，`input.value` 显示为空字符串，点击 `button[type=submit]` 不触发搜索，URL 不变。

**原因**: Nexus Mods 使用 Next.js App Router，`input#keyword-game` 是 React 受控组件（`value` 属性由 React state 管理，不是 DOM value 属性）。直接操作 DOM value 不会同步到 React state，表单提交时 React 读取 state 中的空值。

**已尝试的无效方案**:
```javascript
// ❌ 直接赋值
inp.value = 'skyrim';

// ❌ 原生 setter 注入
var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(inp, 'skyrim');
inp.dispatchEvent(new Event('input', {bubbles: true}));
// → input.value 仍为空字符串
```

**正确方案 — URL 参数导航**:
```javascript
// ✅ 绕过 React 输入框，直接 URL 参数搜索
const url = `https://www.nexusmods.com/games?keyword=${encodeURIComponent(keyword)}`;
await client.navigate(url);
await delay(8000);  // Next.js RSC hydration
```
搜索通过 RESTful URL 参数路由到服务端，不依赖客户端 React state。

**通用教训**: React/Next.js 网站的搜索/筛选，优先测试是否可通过 URL 参数实现；受控组件只能用浏览器原生键盘输入模拟，CDP JS 注入方案不可靠。

**参考**: `references/game-filter-dom.md` — 完整交互分析。

---

## 推荐 CDP 客户端模式

```javascript
class CDPClient {
  async evaluate(expression) {
    // Remove CR chars via String.fromCharCode — avoids source-level \r corruption
    const sanitized = expression.replace(new RegExp(String.fromCharCode(13), 'g'), '');
    const response = await this.send('Runtime.evaluate', {
      expression: sanitized,
      returnByValue: true
    });
    if (response?.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || 'JS error');
    }
    return response?.result?.value;
  }
}
```

**编写 evaluate 表达式的规则**:
1. 使用 ES5 语法 (`var`, `function`, 无箭头函数, 无 `?.`)
2. 使用 `String.fromCharCode(10)` 替代 `'\n'`
3. 使用 `new RegExp('pattern')` 替代 `/pattern/` 字面量（注意不含 `/` 分隔符）
4. 反斜杠转义链: 源文件需要 4 个 `\` 才能在 CDP 中产生 `\d` 数字类
