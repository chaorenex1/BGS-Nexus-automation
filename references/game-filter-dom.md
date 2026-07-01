# /games 页面 Game Filter DOM 参考

> 来源: `https://www.nexusmods.com/games` (2026-07-01)
> 涉及命令: `game-search <keyword>`
> ⚠️ 作为 `/games` 跨游戏搜索页面的参考，本文档中的域名是实测数据示例。

## Accordion 结构

Game Filter 通过 accordion 组件展开/收起，不使用 modal/popover：

```
<button id="accordion-header-game" aria-expanded="true|false">
< div data-e2eid="game-filter" aria-hidden="true|false">
```

- **展开态**: `aria-expanded="true"` + `aria-hidden="false"`
- **收起态**: `aria-expanded="false"` + `aria-hidden="true"`

## Filter Panel 内部 DOM

```html
<div data-e2eid="game-filter" aria-hidden="false" class="block pb-6 pt-2">
  <form class="space-y-3">
    <div class="w-full min-w-0">
      <label class="sr-only" for="keyword-game">Game</label>
      <input id="keyword-game" type="text" name="keyword"
             placeholder="Search game" minlength="2"
             class="text-neutral-strong text-body-lg ..." />
    </div>
    <button class="nxm-button nxm-button-sm nxm-button-secondary-filled-weak w-full"
            type="submit">
      <span>Apply</span>
    </button>
  </form>
</div>
```

### 表单字段

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 输入框 | `input#keyword-game` | `type="text"`, `name="keyword"`, 最少 2 字符 |
| 提交按钮 | `button[type="submit"]` | 文本 "Apply" |

## 交互分析

### React 受控组件 (不可用)

Nexus Mods 使用 Next.js App Router + React。`input#keyword-game` 是 React 受控组件 (`value` 由 React state 管理)。**直接设置 `input.value` 无效**：

```javascript
// 无效 — React 会忽略此操作
var inp = document.getElementById('keyword-game');
inp.value = 'skyrim';

// 原生 setter 同样不可靠
var nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value').set;
nativeSetter.call(inp, 'skyrim');
inp.dispatchEvent(new Event('input', {bubbles: true}));
// → value 显示为空字符串，页面 URL 不变
```

经过实测：即使使用 `nativeSetter` + `input`/`change` 事件 + `button.click()`，页面 URL 和 DOM 均不变。

### URL 参数搜索 (稳定方案)

`/games?keyword={keyword}` 直接导航触发 Next.js RSC 流重新渲染：

| 输入 | 结果 |
|------|------|
| `?keyword=skyrim` | 4 游戏 (Skyrim SE, Skyrim, Skyrim Switch, Skyrim PS4) |
| `?keyword=fallout` | 预期匹配 Fallout 4, Fallout New Vegas, Fallout 3 等 |
| `?keyword=zzzznotagame` | 0 结果，页面显示 "0 results" |

页面标题变为 "Search games"，body 显示 `Search results for "{keyword}" / N results`。

### 搜索行为

- URL 参数触发服务端搜索，不是客户端 DOM 过滤
- 搜索覆盖所有 4,824 个游戏
- 默认按热度排序
- 结果使用与首页相同的 tile 组件渲染

## 提取字段（与首页相同）

| 字段 | 提取方式 |
|------|----------|
| `name` | `[data-e2eid="game-tile-title"]` innerText |
| `url` | 同上元素的 href 属性 |
| `domain` | 从 `url` 分割 `/games/` 后取第二部分 |
| `image` | 在 tile 容器中向上查找 `img` 元素，取 `src` |
| `game_id` | 从 image URL `/games/v2/{game_id}/` 中提取 |

## 搜索结果示例

```json
{
  "keyword": "skyrim",
  "totalResults": 4,
  "returnedCount": 4,
  "url": "https://www.nexusmods.com/games?keyword=skyrim",
  "games": [
    {"name":"Skyrim Special Edition","domain":"skyrimspecialedition","game_id":"1704",...},
    {"name":"Skyrim","domain":"skyrim","game_id":"110",...},
    {"name":"Skyrim (Switch)","domain":"skyrimnintendoswitch","game_id":"2591",...},
    {"name":"Skyrim - PlayStation 4","domain":"skyrimplaystation4","game_id":"2830",...}
  ]
}
```

### 空结果示例

```json
{
  "keyword": "zzzznotagame",
  "totalResults": 0,
  "returnedCount": 0,
  "url": "https://www.nexusmods.com/games?keyword=zzzznotagame",
  "games": []
}
```

页面 body 显示: `Search results for "zzzznotagame" / 0 results`

## 注意事项

1. **必须通过 URL 参数导航**，不能操作 React 输入框 — 这是唯一可靠的搜索方式
2. `keyword` 值通过 `encodeURIComponent()` 转义后放入 URL
3. 搜索是服务端操作，结果来自 RSC 流渲染，需要等待 8 秒 hydration
4. 结果提取前必须确认 `[data-e2eid="game-tile-title"]` 已渲染
5. 空搜索返回 `0 results` 提示，此字符串可用于检测空结果
6. 首页显示 20 个游戏，搜索后只用新结果替换 — 无需清理之前的数据
