# MOD 数据字段提取参考（2025-06-29）

## 完整字段列表

从 `mods-grid` 的每个 tile 中提取以下字段：

| 字段 | 来源 | 提取方式 | 示例 |
|------|------|---------|------|
| `id` | 标题链接 href | `/mods/(\d+)/` 正则 | `182994` |
| `name` | 标题元素 | `[data-e2eid="mod-tile-title"]` | `Canidae - A Wolf Replacer` |
| `author` | 作者元素 | `[data-e2eid="user-link"]` | `sothasimp` |
| `category` | 分类链接 | `a[href*="categoryName"]` | `Creatures and Mounts` |
| `uploadTime` | 相对时间 | `<time>` 元素 textContent | `1 day ago` |
| `uploadDate` | 绝对时间 | `<time>` 元素 `datetime` 属性 | `2026-06-28T00:10:36.000Z` |
| `description` | 描述文本 | innerText 中日期和 Endorsements 之间的长文本 | `A mesh and texture replacer...` |
| `endorsements` | 点赞数 | innerText 行 `"Endorsements"` 后的下一行 | `396` |
| `downloads` | 下载数 | innerText 行 `"Downloads"` 后的下一行 | `13.1k` |
| `fileSize` | 文件大小 | innerText 行 `"File size"` 后的下一行 | `24.6MB` |
| `isAdult` | 成人内容 | innerText 中是否有 `"Adult"` 行 | `false` |
| `thumbnail` | 封面缩略图 | `tile.querySelector('img')` 的 `src` | `https://staticdelivery.nexusmods.com/...` |
| `url` | MOD 页面链接 | 标题链接的完整 href | `https://www.nexusmods.com/skyrimspecialedition/mods/182994` |

## innerText 行结构

每个 tile 的 `innerText.split('\n')` 产生以下行：

```
[0]  Mod Name
[1]  AuthorName
[2]  Category Name
[3]  (空行)
[4]  1 day ago          <- uploadTime
[5]  (空行)
[6]  23 Jun 2026        <- 日期（非 ISO 格式）
[7]  (空行)
[8]  Description text...  <- 描述
[9]  (空行)
[10] Endorsements
[11] 396                <- endorsements
[12] (空行)
[13] Downloads
[14] 13.1k              <- downloads
[15] (空行)
[16] File size
[17] 24.6MB             <- fileSize
```

## 成人内容检测

### 问题与修复（2025-06-29）

**原始问题**: `isAdult` 始终为 `false`，因为检测代码使用 `text === 'Adult'`，但 Adult 标志在 innerText 中和分类文本连在一起。

**实际 innerText 表现**:
```
Followers & CompanionsAdult    <- 分类 + Adult 连在一起（无空格）
ArmourAdult                    <- 分类 + Adult 连在一起（无空格）
```

**DOM 中的实际结构**:
```html
<span class="text-body-sm text-danger-strong"><span>Adult</span></span>
```

**正确检测方式**:
```javascript
// ❌ 错误 - 永远不会匹配
if (text === 'Adult') {
  isAdult = true;
}

// ✅ 正确 - 检测包含 Adult 的文本
if (text === 'Adult' || text.includes('Adult')) {
  // 排除 false positive（如 "Adult" 是作者名或标题的一部分）
  // 检查是否紧跟在分类后面（以 Adult 结尾）
  if (text === 'Adult' || text.endsWith('Adult')) {
    isAdult = true;
  }
}
```

**检测逻辑说明**:
1. 遍历 tile 的 `innerText.split('\n')` 产生的每一行
2. 检查行文本是否包含 `"Adult"`
3. 如果是精确匹配 `"Adult"` 或以 `"Adult"` 结尾（如 `"ArmourAdult"`），则标记为成人内容
4. 这避免了 false positive（如 MOD 标题或描述中包含 "Adult" 字样）

**示例数据**:
| MOD 名称 | 分类文本 | isAdult |
|---------|---------|---------|
| Mia UBE Follower | `Followers & CompanionsAdult` | ✅ true |
| Savage Shamaness | `ArmourAdult` | ✅ true |
| Smart Player Voice System | `Audio` | ❌ false |

## 翻页参数

Trending 7 days 页面支持 `&page=N` 参数：

```
https://www.nexusmods.com/games/{game_domain}/mods?sort=endorsements&timeRange=7&page=2
```

每页显示 20 个 MOD。

## 注意事项

1. **空行处理**：innerText 中有大量空行（`""`），遍历时要跳过
2. **"Updated since last downloaded"**：部分 tile 有这个标记，位于标题之前，需要忽略
3. **描述提取**：描述文本长度通常 > 10 字符，位于日期之后、Endorsements 之前
4. **数字行过滤**：`!text.match(/^\d+$/)` 用于过滤纯数字行（如日期中的数字部分）

## MOD 详情页字段

从 MOD 详情页 (`/mods/{mod_id}`) 提取以下字段：

| 字段 | 来源 | 提取方式 | 示例 |
|------|------|---------|------|
| `pageTitle` | 页面标题 | `document.querySelector('h1')` | `Crystalheart - SkyUI Icons` |
| `version` | 版本号 | innerText 行 `"Version"` 后的下一行 | `1` |
| `uploaded` | 上传时间 | innerText 行 `"Original upload"` 后的下一行 | `22 June 2026, 11:07AM` |
| `updated` | 更新时间 | innerText 行 `"Last updated"` 后的下一行 | `23 June 2026, 8:25AM` |
| `author` | 作者 | innerText 行 `"Created by"` 后的下一行 | `Myahn` |
| `uploader` | 上传者 | innerText 行 `"Uploaded by"` 后的下一行 | `Myahn` |
| `endorsements` | 点赞数 | innerText 行 `"Endorsements"` 后的下一行 | `13` |
| `uniqueDls` | 独立下载数 | innerText 行 `"Unique DLs"` 后的下一行 | `202` |
| `totalDls` | 总下载数 | innerText 行 `"Total DLs"` 后的下一行 | `351` |
| `totalViews` | 总浏览数 | innerText 行 `"Total views"` 后的下一行 | `2,684` |
| `summary` | 描述摘要 | "About this mod" 区域的第一个 `<p>` 标签 | `Replace SkyUI's category icons...` |
| `isDownloaded` | 是否已下载 | `.modhistory` 元素是否存在 | `true` |
| `lastDownloaded` | 上次下载时间 | `.modhistory` 文本正则提取 | `27 Jun 2026` |

### 下载状态提取

```javascript
// 检查是否有下载历史
var modhistory = document.querySelector('.modhistory');
if (modhistory) {
  var historyText = modhistory.textContent.trim();
  // 文本格式: "You last downloaded a file from this mod on 27 Jun 2026"
  var match = historyText.match(/You last downloaded a file from this mod on (.+)/);
  if (match) {
    isDownloaded = true;
    lastDownloaded = match[1];  // "27 Jun 2026"
  }
}
```

### 下载历史 DOM 结构

```html
<div class="modhistory inline-flex">
  <svg class="icon icon-tick-blue">
    <use xlink:href="/assets/images/icons/icons.svg#icon-tick-blue"></use>
  </svg>
  <span class="flex-copy">You last downloaded a file from this mod on 27 Jun 2026</span>
</div>
```

- `icon-tick-blue` 表示已下载过该 MOD
- 下载历史文本格式：`"You last downloaded a file from this mod on {date}"`
- 如果未下载过，页面不会显示 `.modhistory` 元素
