# Nexus Mods DOM 结构参考（2025-06-29 实测）

## 页面 URL 结构

| 页面类型 | 正确 URL 格式 | 说明 |
|---------|-------------|------|
| 游戏首页 | `https://www.nexusmods.com/games/{game_domain}` | 带 `/games/` 前缀 |
| MOD 列表页 | `https://www.nexusmods.com/games/{game_domain}/mods` | 带 `/games/` 前缀 |
| Trending 7 days | `https://www.nexusmods.com/games/{game_domain}/mods?sort=endorsements&timeRange=7` | 带 `/games/` 前缀 |
| MOD 详情页 | `https://www.nexusmods.com/{game_domain}/mods/{mod_id}` | **不带** `/games/` 前缀 |

⚠️ **陷阱**: 使用 `https://www.nexusmods.com/{game_domain}/mods`（不带 `/games/`）会被重定向到具体 MOD 页面或首页。

## 搜索 URL 结构（2025-06-29 实测）

Nexus Mods 的搜索完全通过 URL 参数实现，无需通过搜索框 UI 交互。

### 基础搜索 URL
```
https://www.nexusmods.com/games/{game_domain}/mods?keyword={keyword}
```

### 完整搜索参数
```
https://www.nexusmods.com/games/skyrimspecialedition/mods
  ?keyword=skyui              # 搜索关键词（必填）
  &sort=endorsements          # 排序：endorsements, downloads, updated, name
  &timeRange=7                # 时间范围：7, 30, 365
  &sortDirection=ASC          # 排序方向：ASC, DESC
  &count=20                   # 每页结果数
  &categoryName=Gameplay      # 分类筛选
  &tag=Polish                 # 包含标签
  &excludedTag=Translation    # 排除标签
  &title=skyui                # 标题包含
  &description=skyui         # 描述包含
  &author=schlangster         # 作者包含
  &uploader=schlangster       # 上传者包含
  &adultContent=false         # 成人内容：true, false
```

### 搜索页面 DOM 结构
搜索结果的 DOM 结构与 Trending 页面**完全相同**：
- 列表容器：`.mods-grid`
- MOD tile：`.mods-grid > div`（子元素）
- 标题：`[data-e2eid="mod-tile-title"]`
- 作者：`[data-e2eid="user-link"]`
- 分类：`a[href*="categoryName"]`
- 时间：`<time>` 元素
- 统计信息：innerText 行数组

**关键发现**: 搜索框使用 React/Headless UI 实现，直接 DOM 操作无法触发搜索。URL 参数搜索是唯一可靠方式。

## MOD 列表页 DOM 结构

### 列表容器
```html
<div class="mods-grid">
  <!-- 每个子元素是一个 MOD tile -->
  <div class="group/mod-tile relative ...">...</div>
  <div class="group/mod-tile relative ...">...</div>
</div>
```

### 单个 MOD Tile 结构
```html
<div class="group/mod-tile relative ...">
  <!-- 图片区域 -->
  <a href="/skyrimspecialedition/mods/{mod_id}" class="hover-overlay block ...">
    <img src="..." alt="Mod Thumbnail" />
  </a>
  
  <!-- 标题 -->
  <a data-e2eid="mod-tile-title" href="/skyrimspecialedition/mods/{mod_id}" class="nxm-link ...">
    Mod Name
  </a>
  
  <!-- 作者 -->
  <a data-e2eid="user-link" href="/profile/{author_name}?gameId=..." class="nxm-link ...">
    AuthorName
  </a>
  
  <!-- 分类 -->
  <a href="/games/skyrimspecialedition/mods?categoryName=..." class="nxm-link ...">
    Category Name
  </a>
  
  <!-- 成人内容标志（紧跟在分类后面） -->
  <span class="text-body-sm text-danger-strong">
    <span>Adult</span>
  </span>
  
  <!-- 上传时间 -->
  <span>Uploaded 29 June 2026</span>
  
  <!-- 描述 -->
  <span>Short description text...</span>
  
  <!-- 统计信息（文本格式） -->
  <span>Endorsements</span>
  <span>396</span>
  <span>Downloads</span>
  <span>13.1k</span>
</div>
```

### 数据提取要点

1. **标题**: `tile.querySelector('[data-e2eid="mod-tile-title"]')`
2. **作者**: `tile.querySelector('[data-e2eid="user-link"]')`
3. **MOD ID**: 从标题链接的 `href` 属性提取 `/mods/(\d+)/`
4. **点赞数**: 从 `innerText` 行数组中找到 `"Endorsements"` 后的下一行
5. **下载数**: 从 `innerText` 行数组中找到 `"Downloads"` 后的下一行

### 提取代码示例
```javascript
var grid = document.querySelector('.mods-grid');
var tiles = grid.children;

for (var i = 0; i < tiles.length; i++) {
  var tile = tiles[i];
  var titleEl = tile.querySelector('[data-e2eid="mod-tile-title"]');
  var authorEl = tile.querySelector('[data-e2eid="user-link"]');
  
  var href = titleEl.getAttribute('href') || '';
  var modIdMatch = href.match(/\/mods\/(\d+)/);
  var modId = modIdMatch ? modIdMatch[1] : 'unknown';
  
  var name = titleEl.textContent.trim();
  var author = authorEl ? authorEl.textContent.trim() : 'Unknown';
  
  // 从 innerText 提取统计数字
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
}
```

## 首页 DOM 结构（不同页面）

首页 (`/games/skyrimspecialedition`) 和 MOD 列表页 (`/games/skyrimspecialedition/mods`) 是**不同的页面结构**。

### 首页 Trending Mods 区域
```html
<!-- 首页有 "Trending Mods" heading -->
<h2>Trending Mods</h2>
<!-- 相邻的容器内有 MOD 链接 -->
```

### 首页筛选标签
```html
<button>New</button>
<button>Updated</button>
<button>Trending</button>
<button>Popular</button>
<button>Surprise</button>
<button>All time</button>
```

⚠️ **注意**: 首页的筛选标签和 MOD 列表页的筛选标签是**不同的控件**，点击后行为也不同。

## 技术栈

- **前端框架**: Next.js（React）
- **样式**: Tailwind CSS
- **渲染方式**: 客户端渲染（CSR），初始 HTML 只包含 `<script>` 标签
- **类名格式**: Tailwind 的 `group/mod-tile relative` 格式（包含斜杠和空格）

## MOD 详情页操作按钮 DOM 结构

### Track / Endorse / Vote 按钮

每个操作有两个互斥的 `<li>` 元素，通过 `display` 属性控制显示/隐藏：

```html
<ul class="modactions clearfix">
  <!-- Track：未追踪时显示 -->
  <li id="action-track-1704-183263" style="display:none;">
    <a class="btn inline-flex toggle-track-mod" data-mod-id="183263" data-game-id="1704" data-do-track="1">
      <svg class="icon icon-track"><use xlink:href="/assets/images/icons/icons.svg#icon-track"></use></svg>
      <span class="flex-label">Track</span>
    </a>
  </li>
  <!-- Track：已追踪时显示 -->
  <li id="action-untrack-1704-183263" style="">
    <a class="btn inline-flex btn-active toggle-track-mod" data-mod-id="183263" data-game-id="1704" data-do-track="0" title="Click to stop tracking this mod">
      <svg class="icon icon-track"><use xlink:href="/assets/images/icons/icons.svg#icon-track"></use></svg>
      <span class="flex-label">Tracking</span>
    </a>
  </li>

  <!-- Endorse：未点赞时显示 -->
  <li id="action-endorse-1704-183263" style="display:none;">
    <a class="btn inline-flex endorse-mod" data-mod-id="183263" data-game-id="1704" data-mod-uid="..." data-positive="1">
      <svg class="icon icon-endorse"><use xlink:href="/assets/images/icons/icons.svg#icon-endorse"></use></svg>
      <span class="flex-label">Endorse</span>
    </a>
  </li>
  <!-- Endorse：已点赞时显示 -->
  <li id="action-unendorse-1704-183263" style="">
    <a class="btn btn-active inline-flex endorse-mod" data-mod-id="183263" data-game-id="1704" data-mod-uid="..." data-positive="0" title="Click to remove your endorsement">
      <svg class="icon icon-endorse"><use xlink:href="/assets/images/icons/icons.svg#icon-endorse"></use></svg>
      <span class="flex-label">Endorsed</span>
    </a>
  </li>

  <!-- Vote：未投票时显示 -->
  <li id="action-vote-1704-183263" style="display:none;">
    <a class="btn inline-flex vote-mod" data-mod-id="183263" data-game-id="1704" data-positive="1" title="Vote for Mod of the Month">
      <svg class="icon icon-vote"><use xlink:href="/assets/images/icons/icons.svg#icon-vote"></use></svg>
      <span class="flex-label">Vote</span>
    </a>
  </li>
  <!-- Vote：已投票时显示 -->
  <li id="action-novote-1704-183263" style="">
    <a class="btn btn-active inline-flex vote-mod" data-mod-id="183263" data-game-id="1704" data-positive="0" title="Click to remove your vote for Mod of the Month">
      <svg class="icon icon-vote"><use xlink:href="/assets/images/icons/icons.svg#icon-vote"></use></svg>
      <span class="flex-label">Voted</span>
    </a>
  </li>
</ul>
```

### 状态检测方法

```javascript
// Track 状态检测
var trackedBtn = document.querySelector('li[id^="action-untrack-"] a.toggle-track-mod');
if (trackedBtn && window.getComputedStyle(trackedBtn.parentElement).display !== 'none') {
  // 已追踪状态
}

var trackBtn = document.querySelector('li[id^="action-track-"] a.toggle-track-mod');
if (trackBtn && window.getComputedStyle(trackBtn.parentElement).display !== 'none') {
  // 未追踪状态
}

// Endorse 状态检测
var endorsedBtn = document.querySelector('li[id^="action-unendorse-"] a.endorse-mod');
if (endorsedBtn && window.getComputedStyle(endorsedBtn.parentElement).display !== 'none') {
  // 已点赞状态
}

var endorseBtn = document.querySelector('li[id^="action-endorse-"] a.endorse-mod');
if (endorseBtn && window.getComputedStyle(endorseBtn.parentElement).display !== 'none') {
  // 未点赞状态
}

// Vote 状态检测
var votedBtn = document.querySelector('li[id^="action-novote-"] a.vote-mod');
if (votedBtn && window.getComputedStyle(votedBtn.parentElement).display !== 'none') {
  // 已投票状态
}

var voteBtn = document.querySelector('li[id^="action-vote-"] a.vote-mod');
if (voteBtn && window.getComputedStyle(voteBtn.parentElement).display !== 'none') {
  // 未投票状态
}
```

### 下载历史指示器

```html
<div class="modhistory inline-flex">
  <svg class="icon icon-tick-blue">
    <use xlink:href="/assets/images/icons/icons.svg#icon-tick-blue"></use>
  </svg>
  <span class="flex-copy">You last downloaded a file from this mod on 27 Jun 2026</span>
</div>
```

- `icon-tick-blue` 表示已下载过该 MOD
- Endorse 和 Vote 操作需要已下载才能成功
- 下载历史文本格式："You last downloaded a file from this mod on {date}"

### 按钮点击方式

必须使用 CDP `Input.dispatchMouseEvent` 模拟真实鼠标点击：

```javascript
// 获取按钮位置
var btn = document.querySelector('li[id^="action-track-"] a.toggle-track-mod');
var rect = btn.getBoundingClientRect();
var centerX = rect.left + rect.width / 2;
var centerY = rect.top + rect.height / 2;

// 通过 CDP 发送鼠标按下和释放事件
// Input.dispatchMouseEvent { type: 'mousePressed', x: centerX, y: centerY, button: 'left', clickCount: 1 }
// 延迟 100ms
// Input.dispatchMouseEvent { type: 'mouseReleased', x: centerX, y: centerY, button: 'left', clickCount: 1 }
```

**注意**：
- React 事件系统会忽略 `btn.click()` 触发的点击
- 按钮必须通过 `li[id^="action-xxx-"]` 选择器定位，避免选中隐藏的按钮
- 点击后需要等待 2-3 秒，然后刷新页面验证状态变化
