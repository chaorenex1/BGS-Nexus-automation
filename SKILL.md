---
title: BGS-Nexus-automation
name: BGS-Nexus-automation
version: 1.7.0
category: browser-automation
author: Hermes Agent
description: 在 @puppeteer/browsers 创建的浏览器内像人类用户浏览 Nexus Mods 网站（Skyrim Special Edition），支持搜索、追踪、点赞、下载等完整操作流。
summary: 在 @puppeteer/browsers 创建的浏览器内像人类用户浏览 Nexus Mods 网站（Skyrim Special Edition），支持搜索、追踪、点赞、下载等完整操作流。
---

# BGS-Nexus-automation

## 概述

本技能使用 `@puppeteer/browsers` 启动真实 Chrome 浏览器，以人类行为模式浏览 [Nexus Mods](https://www.nexusmods.com/games/skyrimspecialedition) 网站。所有操作均在可见浏览器窗口中执行，保留登录态，模拟真实用户交互。

## 重要限制

⚠️ **本技能禁止使用任何外部浏览器工具（如 Puppeteer、Playwright、Selenium 等）连接或操作浏览器。**

- 所有浏览器操作必须通过**本技能自身创建的 CDP（Chrome DevTools Protocol）会话**完成
- 禁止调用外部 `puppeteer-core`、`playwright` 等库来连接浏览器
- CDP 会话由 `init-browser.js` 创建并管理，其他脚本只能复用该会话
- 违反此限制将导致反爬虫检测触发，账号可能被封禁

## CDP 原生实现规范

本技能使用**原生 CDP WebSocket**（通过 `ws` 模块）直接连接浏览器，不依赖任何自动化框架。关键实现要点：

### WebSocket 连接层级
- **Browser 级别** (`ws://127.0.0.1:9222/devtools/browser/...`)：用于管理 targets，不能执行页面操作
- **Page 级别** (`ws://127.0.0.1:9222/devtools/page/...`)：用于执行 `Runtime.evaluate`、`Page.navigate` 等页面操作
- **必须连接到 Page 级别** WS 才能执行 DOM 操作

### CDP Runtime.evaluate 约束

⚠️ **严格 ES5 约束**：Nexus Mods 部分页面（尤其是 `/mods/trackingcentre`）在评估含有 ES6 语法（`const`、`let`、`?.`、箭头函数）的表达式时会抛出 `SyntaxError: Unexpected token 'const'`。即使 Chrome 150+ 原生支持 ES6，Nexus 页面的某些 DOM 状态下 evaluate 仍可能失败。

- **必须使用 ES5 语法**：`var` 而非 `const/let`，传统 `function` 而非箭头函数
- **禁止可选链操作符** (`?.`)：在 CDP 表达式中会导致 `SyntaxError`
- **禁止模板字符串**：避免在 evaluate 表达式中使用 `` ` `` 模板字串，改用字符串拼接 `"..." + "..." + "..."` 
- **禁止 `const`/`let`**：全部使用 `var`
- **参数**：仅使用 `returnByValue: true`，**不要**加 `awaitPromise: true`（会导致 `Invalid parameters`）

### Next.js / 客户端渲染等待
Nexus Mods 使用 Next.js，DOM 是客户端渲染的：
- 初始 HTML 只包含 `<script>` 标签
- 必须等待 JS 执行（约 5 秒）后才能查询 DOM
- `Page.loadEventFired` / `domContentEventFired` 不可靠，使用固定延迟更稳定
- MOD 列表使用 Tailwind CSS 类名（如 `group/mod-tile`），不是简单的 `mod-tile`

## 前置依赖

- Node.js >= 18
- `npx` 可用
- Windows 10 环境

## 初始化流程

### 1. 检查并安装 @puppeteer/browsers

```bash
# 检查是否已安装
if ! npx @puppeteer/browsers --version 2>/dev/null; then
  npx -y @puppeteer/browsers install chrome@stable
  npx -y @puppeteer/browsers install chromedriver
fi
```

### 2. 启动浏览器并创建 CDP 会话

**唯一入口**：直接运行技能自带脚本，它会：
- 检查并安装 `@puppeteer/browsers`
- 以可见窗口启动 Chrome
- 自动开启 `--remote-debugging-port=9222`
- 创建本技能专用的 CDP 会话
- 把 WebSocket 端点写入临时文件供本技能内部复用

```bash
node scripts/init-browser.js
```

### 3. 用户登录提示

向用户发送提示：
> 浏览器已启动。请在打开的 Chrome 窗口中访问 https://www.nexusmods.com 并登录您的账号。登录完成后直接回复我“已登录”即可。

### 4. 等待用户确认

用户回复确认后，继续运行 `node scripts/nexus-automation.js login-state` 或其他命令验证登录状态并执行后续操作。不要在脚本中等待 TTY 输入或要求用户按 Enter。

## 工作目录

当前用户的临时目录，用于存放脚本和日志：
- Windows: `%TEMP%/BGS-Nexus-automation/`
- 实际路径: `C:\Users\zarag\AppData\Local\Temp\BGS-Nexus-automation`

## 核心功能

### 功能1：获取 Trending Mods（7 days）

**目标**: 获取 Skyrim Special Edition 7 天 Trending Mods 列表，支持翻页和完整字段。

**正确的 URL 格式**:
```
https://www.nexusmods.com/games/{game_domain}/mods?sort=endorsements&timeRange=7&page={page}
```

⚠️ **URL 格式陷阱**：Nexus Mods 使用两种 URL 结构：
- 游戏首页：`https://www.nexusmods.com/games/skyrimspecialedition`（带 `/games/` 前缀）
- MOD 列表页：`https://www.nexusmods.com/games/skyrimspecialedition/mods`（带 `/games/` 前缀）
- 错误的格式：`https://www.nexusmods.com/skyrimspecialedition/mods`（不带 `/games/` 前缀）会被重定向到具体 MOD 页或首页

**步骤**:
1. 浏览器访问 `https://www.nexusmods.com/games/skyrimspecialedition/mods?sort=endorsements&timeRange=7&page={page}`
2. 等待 5 秒让 Next.js 客户端渲染完成
3. 通过 `document.querySelector('.mods-grid')` 定位 MOD 列表容器
4. 遍历子元素提取 MOD 数据（使用 `data-e2eid` 属性定位标题和作者）
5. 从 `innerText` 中提取所有字段

**DOM 结构要点**:
- MOD 列表容器：`.mods-grid` div
- 每个 MOD tile：`div[class*="mod-tile"]`（Tailwind 类名，包含空格）
- 标题元素：`[data-e2eid="mod-tile-title"]`
- 作者元素：`[data-e2eid="user-link"]`
- 分类元素：`a[href*="categoryName"]`
- 时间元素：`time`（含 `datetime` 属性）
- 封面图：`img` 元素
- 统计信息在 `innerText` 中按行排列

**完整输出字段**:
```json
[
  {
    "id": "182994",
    "name": "Canidae - A Wolf Replacer",
    "author": "sothasimp",
    "category": "Creatures and Mounts",
    "uploadTime": "1 day ago",
    "uploadDate": "2026-06-28T00:10:36.000Z",
    "description": "A mesh and texture replacer for red wolves...",
    "endorsements": "396",
    "downloads": "13.1k",
    "fileSize": "24.6MB",
    "isAdult": false,
    "thumbnail": "https://staticdelivery.nexusmods.com/...",
    "url": "https://www.nexusmods.com/skyrimspecialedition/mods/182994"
  }
]
```

**字段说明**:
| 字段 | 说明 | 来源 |
|------|------|------|
| `id` | MOD ID | 标题链接 href 正则提取 |
| `name` | MOD 名称 | `[data-e2eid="mod-tile-title"]` |
| `author` | 作者名 | `[data-e2eid="user-link"]` |
| `category` | 分类 | `a[href*="categoryName"]` |
| `uploadTime` | 相对上传时间 | `time` 元素 textContent |
| `uploadDate` | ISO 格式上传时间 | `time` 元素 `datetime` 属性 |
| `description` | 描述文本 | innerText 中日期和 Endorsements 之间的长文本 |
| `endorsements` | 点赞数 | innerText `"Endorsements"` 后的下一行 |
| `downloads` | 下载数 | innerText `"Downloads"` 后的下一行 |
| `fileSize` | 文件大小 | innerText `"File size"` 后的下一行 |
| `isAdult` | 成人内容标志 | innerText 中是否有 `"Adult"` 行 |
| `thumbnail` | 封面缩略图 URL | `img` 元素的 `src` |
| `url` | MOD 页面链接 | 标题链接的完整 href |

**翻页支持**:
- 每页显示 20 个 MOD
- 通过 `&page=N` 参数翻页（从 1 开始）
- 命令行：`node nexus-automation.js trending [page_number]`
- 示例：`node nexus-automation.js trending 2` 获取第2页

**参考**: `references/mod-data-fields.md` — 完整的数据提取字段映射和 innerText 行结构

### 功能2：搜索 MOD

**目标**: 使用 Nexus Mods URL 参数直接搜索 Skyrim Special Edition 的 MOD。

**实现方式**: Nexus Mods 搜索通过 URL 参数直接实现，无需通过搜索框交互：
```
https://www.nexusmods.com/games/skyrimspecialedition/mods?keyword={keyword}&{options}
```

**步骤**:
1. 构造带搜索参数的 URL
2. 直接导航到搜索 URL
3. 等待 Next.js 客户端渲染（5秒）
4. 提取搜索结果列表（使用与 Trending 相同的提取逻辑）

**命令行用法**:
```bash
# 基础搜索
node nexus-automation.js search skyui

# 带筛选条件的搜索
node nexus-automation.js search skyui categoryName=Gameplay count=10

# 多条件组合搜索
node nexus-automation.js search skyui categoryName=Gameplay tag=Polish adultContent=false
```

**支持的搜索参数**:
| 参数 | 说明 | 示例 |
|------|------|------|
| `keyword` | 搜索关键词（必填） | `skyui` |
| `sort` | 排序方式 | `endorsements`, `downloads`, `updated`, `name` |
| `timeRange` | 时间范围（天） | `7`, `30`, `365` |
| `sortDirection` | 排序方向 | `ASC`, `DESC` |
| `count` | 每页结果数 | `20`, `50` |
| `categoryName` | 分类筛选 | `Gameplay`, `User Interface` |
| `tag` | 包含标签 | `Polish`, `Immersion` |
| `excludedTag` | 排除标签 | `Translation` |
| `title` | 标题包含 | `skyui` |
| `description` | 描述包含 | `inventory` |
| `author` | 作者包含 | `schlangster` |
| `uploader` | 上传者包含 | `schlangster` |
| `adultContent` | 成人内容 | `true`, `false` |

### 功能3：获取 MOD 详情摘要

**目标**: 根据 MOD ID 进入详情页，提取关键信息，包括下载状态。

**步骤**:
1. 访问 `https://www.nexusmods.com/skyrimspecialedition/mods/{mod_id}`
2. 提取 `pageTitle`（MOD 标题）
3. 提取 `fileInfo` 区域信息（版本、上传时间、更新日期等）
4. 提取下载状态（是否已下载、上次下载时间）
5. 返回结构化摘要

**输出格式**:
```json
{
  "mod_id": "12345",
  "page_title": "Mod Full Name",
  "version": "1.2.3",
  "uploaded": "2024-01-15",
  "updated": "2024-06-20",
  "author": "AuthorName",
  "summary": "Short description...",
  "isDownloaded": true,
  "lastDownloaded": "27 Jun 2026"
}
```

**下载状态提取方法**:
```javascript
// 检查是否有下载历史
var modhistory = document.querySelector('.modhistory');
if (modhistory) {
  var historyText = modhistory.textContent.trim();
  // 文本格式: "You last downloaded a file from this mod on 27 Jun 2026"
  var match = historyText.match(/You last downloaded a file from this mod on (.+)/);
  if (match) {
    isDownloaded = true;
    lastDownloaded = match[1];
  }
}
```

### 功能4：Track / Endorse / Vote 操作

**目标**: 在 MOD 详情页分别执行 Track、Endorse、Vote 操作。

**按钮状态说明**:
- **Track**: 两个 `<li>` 元素互斥显示
  - `action-track-{gameId}-{modId}` 显示 → 未追踪，文本 "Track"
  - `action-untrack-{gameId}-{modId}` 显示 → 已追踪，文本 "Tracking"
- **Endorse**: 两个 `<li>` 元素互斥显示
  - `action-endorse-{gameId}-{modId}` 显示 → 未点赞，文本 "Endorse"
  - `action-unendorse-{gameId}-{modId}` 显示 → 已点赞，文本 "Endorsed"
- **Vote**: 两个 `<li>` 元素互斥显示
  - `action-vote-{gameId}-{modId}` 显示 → 未投票，文本 "Vote"
  - `action-novote-{gameId}-{modId}` 显示 → 已投票，文本 "Voted"

**命令行用法**:
```bash
# 追踪 MOD（toggle 模式：未追踪则追踪，已追踪则取消）
node nexus-automation.js track 183263

# 取消追踪
node nexus-automation.js track 183263 toggle

# 点赞 MOD
node nexus-automation.js endorse 183263

# 取消点赞
node nexus-automation.js endorse 183263 toggle

# 投票 MOD
node nexus-automation.js vote 183263

# 取消投票
node nexus-automation.js vote 183263 toggle
```

**实现方式**:
1. 访问 MOD 详情页
2. 通过 `li[id^="action-track-"]` / `li[id^="action-untrack-"]` 等选择器定位可见按钮
3. 使用 `Input.dispatchMouseEvent` 模拟真实鼠标点击（React 事件系统需要真实用户交互）
4. 点击后等待 2-3 秒，然后刷新页面验证状态变化
5. 重新检查按钮状态确认操作成功

**输出格式**:
```json
{
  "status": "clicked",
  "clicked": true,
  "verifyStatus": "Tracking"
}
```

**状态说明**:
| status | 含义 |
|--------|------|
| `clicked` | 执行了追踪/点赞/投票操作 |
| `clicked_untrack` | 执行了取消追踪操作 |
| `clicked_unendorse` | 执行了取消点赞操作 |
| `clicked_unvote` | 执行了取消投票操作 |
| `already_Tracking` | 已经是追踪状态（未执行 toggle） |
| `already_Endorsed` | 已经是点赞状态（未执行 toggle） |
| `already_Voted` | 已经是投票状态（未执行 toggle） |
| `not_found` | 未找到对应按钮 |

**注意事项**:
- Endorse 和 Vote 操作需要 MOD 已下载（页面显示 `icon-tick-blue` 下载历史图标）才能成功
- 如果未下载，点击后状态不会变化，返回 `verifyStatus: "Endorse"` 或 `"Vote"`
- 所有操作通过 CDP `Input.dispatchMouseEvent` 模拟真实鼠标点击，而非简单的 `element.click()`
- 操作成功后需要刷新页面才能看到状态变化

### 功能5：获取标签和 Gallery 列表

**目标**: 提取 MOD 的标签和截图/视频列表。支持分别获取或合并获取。

**命令行用法**:
```bash
# 仅获取标签（含名称和链接）
node nexus-automation.js tags 183263

# 仅获取 Gallery 图片/视频
node nexus-automation.js gallery 183263

# 同时获取两者（向后兼容）
node nexus-automation.js tags-gallery 183263
```

**Tags DOM 结构**（实测 2025-06-29）：
- 容器: `ul.tags`
- 每个标签: `ul.tags li a` 内含 `.flex-label` 文本和 `href` 链接
- 链接格式: `/games/skyrimspecialedition/mods/?tags_yes[]={id}&tag={name}`

**Gallery DOM 结构**（实测 2025-06-29）：
- 容器: `ul.thumbgallery.gallery.clearfix`
- 每个项目: `li.thumb` 带有 `data-src`（大图URL）和 `data-exthumbimage`（缩略图URL）
- 图片: `li.thumb img`

**Tags 输出格式**:
```json
{
  "tags": [
    {
      "name": "Anime",
      "url": "https://www.nexusmods.com/games/skyrimspecialedition/mods/?tags_yes[]=1069&tag=Anime"
    },
    {
      "name": "User Interface",
      "url": "https://www.nexusmods.com/games/skyrimspecialedition/mods/?tags_yes[]=1079&tag=User+Interface"
    }
  ]
}
```

**Gallery 输出格式**:
```json
{
  "gallery": [
    {
      "type": "image",
      "url": "https://staticdelivery.nexusmods.com/mods/1704/images/183263/183263-1782095895-1789389423.png",
      "thumbnail": "https://staticdelivery.nexusmods.com/mods/1704/images/thumbnails/183263/183263-1782095895-1789389423.png"
    }
  ]
}
```

### 功能6：Description TAB 信息总结

**目标**: 总结 Description 标签页的关键信息，包括完整的 `dl.accordion` 章节数据、依赖关系和反向依赖列表。

**关注要点**:
- **功能介绍**: MOD 的核心功能和特性
- **兼容性**: 与其他 MOD 的兼容情况
- **翻译**: 是否支持多语言，翻译状态
- **权限**: 使用、修改、再分发的权限说明
- **更改日志**: 版本更新历史
- **依赖 (Requirements)**: 需要的前置 MOD 或工具（支持 `<main-file-requirements>` Web Component 解析）
- **被使用 (usedBy)**: 被哪些其他 MOD 依赖（通过 Nexus API 获取完整列表）
- **Donations**: 捐赠信息
- **Collections**: 包含此 MOD 的收藏集

**步骤**:
1. 确保 Description TAB 已激活（点击切换）
2. 等待内容区域渲染完成（轮询 `div.tabcontent.tabcontent-mod-page[aria-live="assertive"][role="status"]`）
3. 优先使用该选择器提取内容，回退到 `#description` / `.mod-description`
4. 提取 `dl.accordion` 所有章节（Requirements, Permissions, Translations, Changelogs, Mods using this mod, Donations, Collections）
5. 对于 Requirements 章节，解析 `<main-file-requirements>` 自定义元素的 `download-links` JSON 属性
6. 对于 "Mods using this mod"，通过 Nexus API (`/api/games/{gameId}/mods/{modId}/required-by`) 获取完整列表
7. 使用 `extractSections()` 按关键词分区提取结构化信息
8. 返回结构化总结

**关键 DOM 选择器**:
- 内容容器: `div.tabcontent.tabcontent-mod-page[aria-live="assertive"][role="status"]`
- 回退选择器: `#description`, `.tab-description`, `.mod-description`
- Accordion 容器: `dl.accordion`
- Accordion 章节标题: `dl.accordion > dt`
- Accordion 章节内容: `dl.accordion > dd`

**提取的分区关键词**:
| 分区 key | 匹配标题 |
|----------|----------|
| `features` | Features, What this mod does, Overview |
| `compatibility` | Compatibility, Compatible, Requirements |
| `translation` | Translation, Translations, Localisation |
| `permissions` | Permissions, Credits, License |
| `changelog` | Changelog, Version History, Updates |
| `dependencies` | Dependencies, Required, Prerequisites |
| `usedBy` | Mods using this mod, Used by, Mods requiring this |

**完整输出格式**:
```json
{
  "modId": "182994",
  "rawText": "About this mod...",
  "sections": {
    "compatibility": "Compatibility\nIncompatible with the Savage Wolves skeleton...",
    "usedBy": "Mods using this mod (4)\n..."
  },
  "accordion": {
    "Requirements": {
      "heading": "Requirements",
      "isOpen": false,
      "text": "",
      "requirements": {
        "name": "SkyUI",
        "category": 1,
        "downloadUrl": "https://www.nexusmods.com/api/files/.../download",
        "vortexDownloadUrl": "https://www.nexusmods.com/api/files/.../download?nmm=1",
        "dependencies": [
          {
            "files": [
              {
                "uid": 7318624734761,
                "name": "Skyrim Script Extender (SKSE64)  Steam",
                "version": "2.2.6",
                "mod": {
                  "name": "Skyrim Script Extender (SKSE64)",
                  "url": "https://www.nexusmods.com/skyrimspecialedition/mods/30379",
                  "thumbnailUrl": "https://staticdelivery.nexusmods.com/...",
                  "adultContent": false
                }
              }
            ]
          }
        ]
      }
    },
    "permissions": {
      "heading": "Permissions and credits",
      "isOpen": false,
      "text": "Credits and distribution permission...",
      "lists": [["Other user's assets...", "Upload permission..."]]
    },
    "translations": {
      "heading": "Translations",
      "isOpen": false,
      "text": "Translations available on the Nexus...",
      "tables": [
        [
          ["Language", "Name"],
          [{"text": "French", "modName": "French", "modId": "95367", "modUrl": "https://www.nexusmods.com/skyrimspecialedition/mods/95367"}, "SkyUI - Traduction Francaise"]
        ]
      ]
    },
    "changelogs": {
      "heading": "Changelogs",
      "isOpen": false,
      "text": "Version 6.11...",
      "lists": [["Version 6.11...", "Fixed some RaceMenu buttons..."]]
    },
    "usedBy": {
      "heading": "Mods using this mod (1842)",
      "isOpen": false,
      "text": "Loading..."
    },
    "Donations": {
      "heading": "Donations",
      "isOpen": false,
      "text": "Straight donations accepted...",
      "lists": [["Donate"]]
    },
    "collections": {
      "heading": "Collections containing this mod",
      "isOpen": true,
      "text": ""
    }
  },
  "usedByList": [
    {"name": "Canidae - A Wolf Replacer CHS 2.9", "notes": ""},
    {"name": "Dismembering Framework - My patches by Xtudo", "notes": ""}
  ]
}
```

**Requirements 解析要点**:
- Nexus 使用 `<main-file-requirements>` 自定义 Web Component 存储依赖数据
- 实际依赖信息在 `download-links` 属性中，为 JSON 字符串
- 包含 `dependencies[].files[]` 数组，每个文件有 `uid`, `name`, `version`, `downloadUrl`, `mod` 等字段
- `mod` 字段包含 `name`, `url`, `thumbnailUrl`, `adultContent`
- 该组件的 `textContent` 为空，必须通过 `getAttribute('download-links')` 提取

**usedBy 获取要点**:
- "Mods using this mod" 区域使用懒加载，初始显示 "Loading..."
- 直接通过 Nexus API 获取：`https://www.nexusmods.com/api/games/{gameId}/mods/{modId}/required-by?show_adult_content=1`
- 返回 HTML 表格，解析 `<tr>` 中的 `<a>` 链接获取 MOD 名称和 ID
- 表格第一行是表头（"Mod name", "Notes"），需要跳过
- 结果包含分页信息（Pages 1, 2, 3...）

**注意事项**:
- `usedBy` 区域在 Nexus 页面中是可展开区域，文本提取只能获取标题和数量；完整列表通过 API 获取
- 正则匹配使用前瞻断言截断到下一个大标题，避免区域内容混杂
- Accordion 章节可能包含 `tables`（表格数据）、`lists`（列表数据）和 `requirements`（JSON 依赖数据）
- 所有章节数据统一放在 `accordion` 对象中，以 `heading` 文本为 key

### 功能7：Files TAB 操作

**目标**: 获取文件列表并预览文件内容。

**DOM 结构**（实测 2026-06-29）：
- 容器: `div#mod_files.container.tab-files.condensed.fill-file-stats`
- 分类容器: `div#file-container-main-files`, `div#file-container-optional-files`, `div#file-container-old-files`
- 文件条目: `dt.file-expander-header`（含 `data-id`, `data-name`, `data-version`, `data-size`, `data-date`, `data-dependencies-count`）
- 文件详情: `dd.clearfix` 兄弟元素
  - 描述: `div.files-description`
  - 下载按钮: `<download-modal>` 自定义元素（含 `download-links` JSON 属性）
  - 统计: `ul.stats` 中的 `li.stat-uploaddate`, `li.stat-downloaded`, `li.stat-unique-dls`, `li.stat-total-dls`

**步骤**:
1. 直接导航到 `?tab=files` URL
2. 等待 `dt.file-expander-header` 元素渲染
3. 遍历 `dl/dt/dd` accordion 结构提取文件信息
4. 从 `data-*` 属性获取文件元数据
5. 从 `<download-modal>` 提取下载链接和依赖信息
6. 点击 "Preview file contents" 链接（如存在）
7. 提取预览内容（文件树、关键文件说明）

**输出格式**:
```json
{
  "files": {
    "mainFiles": [
      {
        "id": "749043",
        "name": "SkyUI",
        "version": "6.11",
        "size": "2630",
        "date": "1778020881",
        "uploaded": "06 May 2026, 6:41AM",
        "downloaded": "17 May 2026",
        "dependenciesCount": "1",
        "description": "SkyUI 6 Update...",
        "hasModManager": true,
        "hasManual": true,
        "hasPreview": false,
        "isDownloaded": true,
        "isPremium": true,
        "fileUid": "7318625021427",
        "downloadLinks": {
          "name": "SkyUI",
          "category": 1,
          "downloadUrl": "https://www.nexusmods.com/api/files/.../download",
          "vortexDownloadUrl": "https://www.nexusmods.com/api/files/.../download?nmm=1",
          "dependenciesCount": 1,
          "dependencies": [{"files": [...]}]
        }
      }
    ],
    "optionalFiles": [...],
    "oldFiles": [...]
  },
  "preview": "File tree or content preview..."
}
```

### 功能8：搜索 POSTS TAB 评论（支持翻页和嵌套回复）

**目标**: 在 MOD 详情页的 POSTS TAB 中提取评论列表，支持关键词搜索过滤、翻页，以及 **嵌套回复**（nested replies）提取。

**命令行用法**:
```bash
# 获取第1页评论（默认）
node nexus-automation.js posts 183637

# 获取指定页（第2页）
node nexus-automation.js posts 183637 "" 2

# 搜索关键词 + 翻页（第2页，搜索"bug"）
node nexus-automation.js posts 183637 bug 2

# 仅搜索关键词（第1页）
node nexus-automation.js posts 183637 skyui
```

**翻页实现**:
- 通过 `window.RH_CommentContainer.Send('page', 'N')` AJAX 翻页（URL 参数 `?tab=posts&page=N` 不生效）
- 脚本自动调用 CDP `Runtime.evaluate` 执行该函数
- 翻页后等待 3 秒让 AJAX 加载和 DOM 更新
- 分页链接信息在 `pagination` 数组中返回（来自 `.pagination.clearfix a`）
- 分页链接从 onclick 中解析 `Send('page', 'N')` 或 href 中解析 `?page=N`

**嵌套回复实现**:
- 嵌套回复容器为 `ol.comment-kids`（实测 2026-06-29），备选 `.comment-replies`, `.replies`
- 自动跳过嵌套在父评论中的子评论（避免重复计入顶层计数）
- 每个顶层评论的 `nestedReplies` 字段包含其全部直接回复

**DOM 结构**（实测 2026-06-29）：
- 容器: `#comment-container`（在 `.tabcontent-mod-page` 内）
- 每个评论: `li.comment`（置顶评论有 `comment-sticky` 类）
- 评论头部: `.comment-head`
  - 用户头像链接: `.comment-user > img`（`title` 属性含用户名）
  - 用户名: `.comment-name > a`
  - 用户详情: `.comment-details > ul > li`（含 premium 状态、kudos 数量）
- 评论内容区: `.comment-content`
  - 锁定标签: `.locked`（`id="locked-comment-label-{id}"`）
  - 置顶标签: `.sticky`（`id="sticky-comment-label-{id}"`）
  - 时间: `time.dst-date-adjust`（`data-date` 属性含时间戳）
  - 实际内容: `.comment-content-text`（`id="comment-content-{id}"`）
- 回复区域: `.comment-replies` 或 `.replies`

**提取要点**:
- 作者名优先使用 `.comment-name > a`，回退到 `.comment-user > img[title]`
- 日期从 `time` 元素提取，同时获取 `data-date` 属性（Unix 时间戳）
- 内容只取 `.comment-content-text`，排除 `.locked` / `.sticky` / `time` 标签的噪音
- Kudos 从 `.comment-details ul li` 中匹配 `/\d+\s*kudos/i`
- 回复数从 `.replies-count` 提取，或统计 `.comment-replies li.comment` 数量
- 置顶状态通过 `comment.classList.contains('comment-sticky')` 判断
- 嵌套回复提取使用相同的字段提取逻辑（作者、日期、内容、kudos）

**输出格式**:
```json
{
  "posts": [
    {
      "id": "comment-171607874",
      "author": "zhoudesheng258",
      "profileUrl": "https://next.nexusmods.com/profile/zhoudesheng258",
      "avatarUrl": "https://avatars.nexusmods.com/211242680/100",
      "userStatus": "member",
      "date": "29 Jun 2026, 5:28PM",
      "dateAttr": "1782725333",
      "dateFormat": "d M Y, g:iA",
      "content": "NICEEEEEEEEEEEE",
      "kudos": "0",
      "locked": false,
      "isSticky": false,
      "replies": "1",
      "nestedReplies": [
        {
          "id": "comment-171607900",
          "author": "SkryiMuhyo",
          "profileUrl": "https://next.nexusmods.com/profile/SkryiMuhyo",
          "avatarUrl": "https://avatars.nexusmods.com/2108379/100",
          "userStatus": "member",
          "date": "29 Jun 2026, 4:21PM",
          "dateAttr": "1782716461",
          "dateFormat": "d M Y, g:iA",
          "content": "It seems that if you build a bodyslide...",
          "kudos": "0",
          "locked": false,
          "isSticky": false,
          "replies": "0",
          "nestedReplies": []
        }
      ]
    }
  ],
  "count": 26,
  "keyword": "",
  "page": "1",
  "pagination": ["2", "3"]
}
```

**字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| `posts` | array | 顶层评论列表 |
| `posts[].id` | string | 评论 ID（格式 `comment-{数字}`） |
| `posts[].author` | string | 作者用户名 |
| `posts[].profileUrl` | string | 作者 Nexus Mods 个人主页 URL |
| `posts[].avatarUrl` | string | 作者头像图片 URL |
| `posts[].userStatus` | string | 用户身份：`member` / `premium` |
| `posts[].date` | string | 相对日期文本 |
| `posts[].dateAttr` | string | Unix 时间戳（`data-date` 属性） |
| `posts[].dateFormat` | string | 日期格式（如 `d M Y, g:iA`） |
| `posts[].content` | string | 评论正文（`<br>` 转为换行，HTML 标签已剥离，截断至 2000 字符） |
| `posts[].kudos` | string | 点赞数 |
| `posts[].locked` | boolean | 是否被锁定 |
| `posts[].isSticky` | boolean | 是否置顶 |
| `posts[].replies` | string | 回复数 |
| `posts[].nestedReplies` | array | 嵌套回复列表（结构与顶层评论相同） |
| `count` | number | 当前页评论数 |
| `keyword` | string | 搜索关键词 |
| `page` | string | 当前页码 |
| `pagination` | array | 可用页码列表 |

**注意事项**:
- 部分 MOD 可能没有启用 Posts tab，返回空数组是正常行为
- 评论内容可能包含空字符串（如用户只发了图片或表情）
- 锁定评论（`.locked`）仍显示内容，但用户无法回复
- 嵌套回复仅提取一级深度（直接回复），不支持多层嵌套
- 翻页通过 URL `?tab=posts&page=N` 实现；如果 URL 翻页不生效，需回退到点击 `.pagination a` 链接

### 功能9：搜索 BUGS TAB 报告

**目标**: 在 MOD 详情页的 BUGS TAB 中提取 BUG 报告列表，支持关键词搜索过滤。

**DOM 结构**（实测 2026-06-29）：
- 容器: `#mod_bugs` 或 `.tabcontent-mod-page`
- 表格: `table`（实际 class 可能为空或 `translation-table` 等，不能依赖 class）
- 每行: `tr.mod-issue-row`（含 `data-issue-id` 和 `id="issue_{id}"`）
- 标题列: `td.table-bug-title > a.issue-title`（点击展开详情，href 为 `javascript:;`）
  - 内联信息: `.table-inline-hidden` 含版本、状态、优先级
  - 修复版本: `span[id^="issueFixedInVersion_"]`
- 状态列: `td.table-bug-status > span.green/.red/.yellow`（如 Fixed, New issue, Being looked at）
- 回复列: `td.table-bug-replies`
- 版本列: `td.table-bug-version`
- 优先级列: `td.table-bug-priority`
- 最后回复列: `td.table-bug-post > time`

**提取要点**:
- 表格选择器不能依赖特定 class，应使用 `#mod_bugs table` 或 `.tabcontent-mod-page table`
- 行选择器使用 `tr[data-issue-id]` 或 `tr.mod-issue-row`
- Bug ID 使用 `data-issue-id` 或 `row.id.replace('issue_', '')`
- 标题链接 href 为 `javascript:;`，不是有效 URL，应设为 `null`
- 状态文本可能包含颜色标签（如 `<span class="green">Fixed</span>`），需提取 `textContent`

**输出格式**:
```json
{
  "bugs": [
    {
      "id": "1096566",
      "title": "Skirt Zap option causes errors with the texture sets",
      "status": "Fixed",
      "replies": "3",
      "version": "Shattered Royal Armor 4k - Version 1",
      "priority": "Not set",
      "lastPost": "09:31, 28 Jun 2026",
      "url": null
    }
  ],
  "count": 1,
  "keyword": ""
}
```

**注意事项**:
- 部分 MOD 可能没有启用 Bugs tab，返回空数组是正常行为
- 状态颜色含义：`.green`=已修复/关闭，`.red`=新问题，`.yellow`=处理中
- 标题列的 `.table-inline-hidden` 在桌面端隐藏，移动端显示，提取时可能重复

### 功能10：MOD 下载流程

**命令行用法**:
```bash
node nexus-automation.js download <modId> <fileName> <version> [downloadType]
# downloadType: "manual" (默认) 或 "modmanager"
# 示例：
node nexus-automation.js download 183263 "SkyUI Icons - Psychosteve Replacer" 1 manual
node nexus-automation.js download 183263 "SkyUI" "6.11" modmanager
```

**目标**: 根据 MOD ID + 文件名称 + 版本精确指定下载目标，执行下载并自动 Track + Endorse + Vote。

**步骤**:
1. 直接导航到 `?tab=files` URL
2. 等待 `dt.file-expander-header` 元素渲染
3. 调用 `extractAllFiles()` 提取完整文件列表（复用功能7的 `<download-modal>` 解析逻辑，含 `downloadUrl`, `vortexDownloadUrl`, `downloadLinks`, `isPremium`, `fileUid`, `dependencies` 等完整字段）
4. 按 `fileName` + `version` 精确匹配目标文件（回退到仅名称匹配）
5. 验证下载方式可用性（`hasModManager` / `hasManual` 来自 `<download-modal>` 解析）
6. 展开目标文件的 accordion
7. 查找并点击下载链接（`a` 元素文本 "Mod manager download" / "Manual download"）
8. ⚠️ 点击必须使用 `element.click()` 而非 `Input.dispatchMouseEvent`（Magnific Popup）
9. 等待下载弹窗 — 检测 `.mfp-wrap`
10. 在弹窗中点击 "Download" / "Slow download" 按钮
11. 自动执行 Track、Endorse、Vote（仅正向，不 toggle）

**输出格式**:
```json
{
  "file": { "id": "766549", "name": "SkyUI Icons - Psychosteve Replacer", "version": "1" },
  "availableFiles": [
    {
      "id": "766549", "name": "...", "version": "1",
      "hasModManager": true, "hasManual": true,
      "isPremium": true, "fileUid": "7318625038933",
      "downloadLinks": { "downloadUrl": "...", "vortexDownloadUrl": "...", "dependencies": [...] }
    }
  ],
  "downloadStarted": true,
  "popupResult": "clicked_Download",
  "trackResult": { "trackStatus": "already_Tracking", "endorseStatus": "...", "voteStatus": "..." }
}
```

**与功能7的关系**: 功能10 使用 `extractAllFiles()` 辅助函数，该函数与 `getFilesTab` 共享相同的 `<download-modal>` 解析逻辑。功能7 返回分类结构（mainFiles/optionalFiles/oldFiles），功能10 返回扁平化列表并增加了按名称+版本匹配和下载触发功能。

**关键发现**（2026-06-29 修复）:
- `<download-modal>` 自定义元素存储真正的下载链接（`download-links` JSON 属性），必须解析它以获得正确的 `hasModManager`/`hasManual`
- 只检查 `<a>` 文本会导致主文件判定为无下载方式（因为 accordion 未展开时链接不渲染）
- 弹窗由 Magnific Popup 创建（`.mfp-wrap`），不是 `#widget-download`
- `Input.dispatchMouseEvent` 对 Magnific Popup 无效，必须用 `element.click()`
- Track/Endorse/Vote 使用非 toggle 模式避免反转已存在状态

### 功能11：Tracking Centre 操作

**目标**: 访问 Tracking Centre，提取追踪 MOD 列表，支持翻页、关键字过滤和取消追踪操作。

**正确的 URL**:
```
https://www.nexusmods.com/skyrimspecialedition/mods/trackingcentre?tab=mods
```

⚠️ 路径是 `/mods/trackingcentre`，不是 `/users/trackingcentre`。

**命令行用法**:
```bash
# 获取追踪 MOD 列表（默认第1页）
node nexus-automation.js tracking

# 关键字过滤（客户端匹配 name + author + category）
node nexus-automation.js tracking list ui 1

# 翻页（共23页，446个追踪MOD）
node nexus-automation.js tracking list "" 2

# 取消追踪指定 MOD
node nexus-automation.js tracking untrack 151502 1
```

**DOM 结构**（实测 2026-06-29）:
- 表格: `table.mod-tracking-table`（无 id，靠 class 定位）
- 表头: Mod name, Game, Author, Category, Version, Last upload, Last download, Log, Tracking
- 翻页: `window.RH_TrackedModsTab.Send('page', 'N')` — AJAX 翻页，URL 参数不生效
- 追踪按钮: `<a class="toggle-track-mod" data-mod-id="151502" data-game-id="1704" data-do-track="0">Stop tracking</a>`
- 搜索: **无内置搜索**，需在提取后客户端过滤

**输出格式**:
```json
{
  "mods": [
    {
      "name": "SLO Aroused NG",
      "id": "151502",
      "author": "crajj",
      "category": "Immersion",
      "version": "3.2.1",
      "lastUpload": "29 Jun 2026",
      "lastDownload": "--",
      "isTracked": true,
      "trackingStatus": "Stop tracking",
      "url": "https://www.nexusmods.com/skyrimspecialedition/mods/151502"
    }
  ],
  "count": 20,
  "page": "1",
  "pagination": ["2", "3", "23"],
  "query": ""
}
```

### 功能12：Download History 操作

**目标**: 访问下载历史，提取下载记录，支持翻页、DataTables 关键字搜索和点赞/取消点赞。

**正确的 URL**:
```
https://www.nexusmods.com/users/myaccount?tab=download+history
```

⚠️ 路径是 `/users/myaccount?tab=download+history`，不是 `/users/downloadhistory`。

**命令行用法**:
```bash
# 获取下载历史（默认第1页，共2,996条记录，150页）
node nexus-automation.js history

# DataTables 关键字搜索
node nexus-automation.js history skyui 1 list

# 翻页
node nexus-automation.js history "" 3 list

# 点赞 MOD（modId 作为 query 参数）
node nexus-automation.js history 65530 1 endorse

# 取消点赞
node nexus-automation.js history 65530 1 unendorse
```

**DOM 结构**（实测 2026-06-29）:
- 表格: `#DataTables_Table_0.datatable`（DataTables 控件）
- 表头: Mod name, Last DL, Uploader, Category, Updated, Endorsement, Log
- 翻页: DataTables `.paginate_button[data-dt-idx="N"]` 按钮
- 搜索: `<input aria-controls="DataTables_Table_0">` DataTables 内置搜索
- 点赞按钮: `<a class="endorse-mod" data-positive="1" data-mod-id="183263">`（含 SVG 图标 `icon-endorse-active`/`icon-endorse-inactive`）

**输出格式**:
```json
{
  "mods": [
    {
      "name": "Crystalheart - SkyUI Icons",
      "id": "183263",
      "lastDownloaded": "29 June 2026, 6:33 pm",
      "uploader": "Myahn",
      "category": "User Interface",
      "updated": "23 June 2026, 8:25 am",
      "isEndorsed": true,
      "endorsed": "",
      "url": "https://www.nexusmods.com/skyrimspecialedition/mods/183263"
    }
  ],
  "count": 20,
  "pagination": {
    "info": "Showing 1 to 20 of 2,996 entries",
    "pages": ["1", "2", "3", "4", "5", "150"],
    "current": "1"
  },
  "query": ""
}
```

### 功能13：获取 Mod Organizer 2 API Keys（只读）

**目标**: 访问 API Keys 设置页面获取 MO2 的 API Key 值。⚠️ **只读操作** — 仅读取已存在的 Key，禁止创建新 Key（见安全协议第5条）。

**正确的 URL**:
```
https://www.nexusmods.com/settings/api-keys
```

⚠️ 路径是 `/settings/api-keys`，不是 `/settings/preferences` 或 `/users/settings`。`/settings/api-keys` 是专门的 API Keys 管理页面。

**命令行用法**:
```bash
# 获取 MO2 API Key 状态和值
node nexus-automation.js api-keys
```

**DOM 结构**（实测 2026-06-29）:
- 页面: `/settings/api-keys` 包含所有第三方应用集成
- MO2 定位: 通过 `<img alt="Mod Organizer 2" class="w-40 shrink-0">` 查找
- API Key 输入框: 在图片的祖先容器中查找 `input[type="text"]`
- 已配置时 input 的 `value` 包含加密的 API key 字符串
- 其他集成（如 Kortex, Automaton）显示 "Request Api Key" 而非输入框

**输出格式**:
```json
{
  "integrations": [],
  "mo2": {
    "name": "Mod Organizer 2",
    "keys": [
      {
        "label": "api key",
        "value": "TWluS2NxMDhja1o1ODhMWHZRT0oydlhzbXJCTFJpeTRNUzFpb0s4V2VGdDhY...",
        "hasValue": true
      }
    ]
  },
  "totalApiKeyInputs": 3,
  "hasApiKeys": true
}
```
- `mo2.keys[]` — 每个 API key（label 和 value）
- `hasValue` — key 是否已设置
- `totalApiKeyInputs` — 页面上的 API key 输入框总数

### 功能14：发表评论（Post Comment）

**目标**: 在 MOD 详情页的 POSTS TAB 发表新评论。⚠️ **这是写操作，会实际提交评论到 Nexus Mods。**

**命令行用法**:
```bash
node nexus-automation.js post 183637 "评论内容"
```

**DOM 结构**（实测 2026-06-29）：
- 表单默认可见：`#add-comment-form-0`（页面加载时即渲染）
- 文本输入：`textarea#add-comment-post-0`（hidden，WYSIWYG 自动同步）
- 富文本编辑：`.wysibb-body`（`contenteditable="true"`）
- 提交按钮：`A#submit-add-comment-0`，onclick=`addNewComment(userId, gameId, modId, 1, 0)`
- 错误提示：`#add-comment-error-box-0`（默认隐藏）
- 触发按钮：`A#add-comment`，onclick=`loadWYSIBBFor('add','0')`

**步骤**:
1. 导航到 `?tab=posts`
2. 等待 `#add-comment-form-0` 可见（轮询 10 秒）
3. 如果表单不可见，点击 `#add-comment` 触发
4. 填入内容到 `#add-comment-post-0` textarea
5. 触发 `input` + `change` 事件同步 WYSIWYG
6. 使用 `Input.dispatchMouseEvent` 点击 `#submit-add-comment-0`
7. 等待 3 秒后检查 `#add-comment-error-box-0` 确认成功/失败

**输出格式**:
```json
{
  "posted": true,
  "modId": "183637",
  "contentPreview": "Test comment"
}
```

**注意事项**:
- 评论长度上限 5000 字符
- 表单包含 CSRF token（在 `#submit-add-comment-0` 的 `data-csrf-token` 属性中）
- 提交后表单自动隐藏，新评论出现在列表中

### 功能15：获取 BUG 评论详情

**目标**: 在 BUGS TAB 中点击 BUG 标题后，提取完整的评论详情（报告内容和回复）。

**命令行用法**:
```bash
node nexus-automation.js bug-comments 182994
```

**实现方式**:
1. 导航到 `?tab=bugs`
2. 提取 `tr[data-issue-id]` 获取 BUG 列表（id, title, status, replies）
3. 对每个有回复（replies > 0）的 bug，调用 `loadIssueReplies(bugId)` AJAX 加载评论
4. 评论加载到 `td#mainissue_{bugId}` 内，等待 3 秒后提取
5. 从 `.comments ol li.comment` 遍历提取每条评论

**DOM 结构**（实测 2026-06-29）:
- 展开后的评论容器: `td#mainissue_{bugId} > div.comments > ol > li.comment`
- 每个评论的结构:
  - `.comment-head` — 头部信息
    - `.comment-user img[src]` — 头像
    - `.comment-name a` — 用户名 + 个人主页链接
    - `.comment-details ul li` — 用户身份（premium/supporter/staff 等）
  - `.comment-content` — 评论正文
    - `time[datetime]` — 发布时间
    - 纯文本内容（排除 time 和 .comment-reply 表单）
  - `.comment-reply`（隐藏）— 回复表单

**输出格式**:
```json
{
  "modId": "182994",
  "bugs": [
    {
      "id": "1096938",
      "title": "Mihail patch not installing",
      "status": "New issue",
      "replies": "1",
      "comments": [
        {
          "author": "kwinterhawk",
          "profileUrl": "https://www.nexusmods.com/skyrimspecialedition/users/61624396",
          "avatarUrl": "https://avatars.nexusmods.com/61624396/100",
          "date": "28 June 2026, 8:04AM",
          "dateAttr": "2026-06-28 08:04",
          "userStatus": "premium",
          "content": "When installing, choosing the patch..."
        }
      ]
    }
  ],
  "commentCount": 1
}
```

**字段说明**:
| 字段 | 说明 |
|------|------|
| `author` | 评论者用户名 |
| `profileUrl` | 评论者 Nexus Mods 个人主页 URL |
| `avatarUrl` | 评论者头像图片 URL |
| `date` | 评论时间（人类可读格式） |
| `dateAttr` | 评论时间 datetime 属性（ISO 格式） |
| `userStatus` | 用户身份：`member` / `premium` / `supporter` / `staff` |
| `content` | 评论正文（纯文本，截断至 3000 字符） |

**注意事项**:
- BUG 评论加载依赖 `loadIssueReplies()` 全局函数（Nexus 页面自带）
- 只有用户已登录才能查看完整评论内容
- 无回复的 bug 的 `comments` 字段为空数组 `[]`

## 安全协议

⚠️ **严格遵守以下安全规则**:

1. **不保存敏感信息**: 绝不保存用户的账号密码、API Keys、银行卡或信用卡信息等到任何文件或内存中。
2. **临时数据**: 所有操作数据仅在当前会话有效，会话结束后清除。
3. **用户确认**: 涉及下载、点赞、追踪等写操作前，必须获得用户明确确认。
4. **隐私保护**: 不收集或上传用户的个人数据到第三方。
5. **🛑 禁止注册/创建 API Keys**: 当用户请求**注册、创建、申请、生成** API Keys（包括但不限于 MO2 API Key、Kortex API Key、Automaton API Key 等任何第三方集成的 API Key）时，**必须拒绝操作**。API Key 的创建涉及账号安全与授权，应由用户**手动在 Nexus Mods 网站上操作**。Agent 仅可**读取**已存在的 API Key 状态和值（功能13），绝不可代为点击 "Request Api Key" 按钮或提交 API Key 创建请求。

   当用户请求注册 API Key 时的标准拒绝回复：
   > 🛑 无法代为注册 API Key。API Key 的创建涉及您的账号授权和安全，请手动操作：
   > 1. 打开 https://www.nexusmods.com/settings/api-keys
   > 2. 找到对应应用（如 Mod Organizer 2）
   > 3. 点击 "Request Api Key" 按钮
   > 4. 完成后我可以通过 `api-keys` 命令帮您确认状态

## 参考文档

- `references/cdp-pitfalls.md` — CDP 原生实现陷阱、Next.js 渲染等待、Tailwind 选择器适配、URL 格式陷阱、MOD 数据提取、React/Headless UI 搜索框交互失败、**evaluate() 模板字符串变量注入陷阱**等详细记录
- `references/nexus-dom-structure.md` — Nexus Mods 页面 DOM 结构参考，包含搜索 URL 参数大全（2025-06-29 实测）
- `references/mod-data-fields.md` — MOD 数据完整字段提取映射、innerText 行结构、翻页参数说明（2025-06-29）
- `references/tags-gallery-dom.md` — Tags 和 Gallery 区域 DOM 结构实测记录（2025-06-29）
- `references/description-tab-dom.md` — Description TAB 内容区域选择器、分区提取正则、usedBy 展开区域说明（2025-06-29）
- `references/description-accordion-dom.md` — Description TAB `dl.accordion` 完整章节结构、Requirements Web Component 解析、Translations 表格提取、Changelogs 列表提取、usedBy API 获取（2026-06-29）
- `references/files-tab-dom.md` — Files TAB `dl/dt/dd` accordion 结构、`<download-modal>` 自定义元素解析、下载链接和依赖提取（2026-06-29）
- `references/tracking-history-dom.md` — Tracking Centre 和 Download History 页面 DOM 结构、表格列映射、功能11-13 URL 修正（2026-06-29）
- **Nexus Mods API 文档**: https://api-docs.nexusmods.com
- **Nexus Mods Wiki**: https://wiki.nexusmods.com/index.php

## 异常处理

| 场景 | 处理方式 |
|------|----------|
| 未登录 | 提示用户先登录 |
| 页面加载超时 | 重试 3 次，每次间隔 5 秒 |
| 元素未找到 | 截图记录，提示用户页面结构可能变化 |
| 操作被拒绝 | 检查登录状态，提示重新登录 |
| 下载失败 | 检查网络连接，提供手动下载链接 |

## 浏览器行为模拟

- 使用真实 Chrome 浏览器（非 headless）
- 窗口大小 1920x1080
- 模拟人类点击延迟（随机 200-800ms）
- 模拟人类滚动行为（平滑滚动，随机停顿）
- 保留 Cookies 和 LocalStorage（登录态持久化）

## 维护说明

- 本技能依赖 Nexus Mods 网站 DOM 结构，若网站改版可能需要更新选择器
- 建议定期检查核心功能可用性
- 所有选择器应尽量使用稳定的属性（如 `data-*` 属性）而非易变的 class 名