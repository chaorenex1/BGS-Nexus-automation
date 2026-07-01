# Description Accordion DOM 结构详解

> 实测日期: 2026-06-29
> 适用页面: Nexus Mods MOD 详情页 Description TAB
> ⚠️ 本文档中的 `skyrimspecialedition` 域名是实测时的游戏域。实际操作中由 `game_domain` 配置决定。

## 整体结构

Description TAB 使用 `dl.accordion` 包裹多个 `dt`/`dd` 章节对：

```html
<dl class="accordion">
  <dt>Requirements</dt>
  <dd class="clearfix">...内容...</dd>
  
  <dt>Permissions and credits</dt>
  <dd class="clearfix">...内容...</dd>
  
  <dt>Translations</dt>
  <dd class="clearfix">...内容...</dd>
  
  <dt>Changelogs</dt>
  <dd class="clearfix">...内容...</dd>
  
  <dt>Mods using this mod (1842)</dt>
  <dd class="clearfix open" style="overflow: hidden; display: block;">
    <div data-lazy-url="/api/games/1704/mods/12604/required-by?show_adult_content=1">Loading...</div>
  </dd>
  
  <dt>Donations</dt>
  <dd class="clearfix">...内容...</dd>
  
  <dt>Collections containing this mod</dt>
  <dd class="clearfix">...内容...</dd>
</dl>
```

## 各章节详解

### 1. Requirements

**特点**: 使用自定义 Web Component `<main-file-requirements>`

```html
<dd class="clearfix">
  <div class="tabbed-block">
    <main-file-requirements 
      file-name="SkyUI" 
      file-uid="7318625021427"
      download-links="{&quot;name&quot;:&quot;SkyUI&quot;,&quot;category&quot;:1,...}"
      show-adult-content="true">
    </main-file-requirements>
  </div>
</dd>
```

**提取方法**:
```javascript
var reqEl = dd.querySelector('main-file-requirements');
var downloadLinks = reqEl.getAttribute('download-links');
var parsed = JSON.parse(downloadLinks);
// parsed.dependencies[0].files[] 包含依赖文件列表
```

**数据结构**:
```json
{
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
          "downloadUrl": "https://www.nexusmods.com/api/files/.../download",
          "vortexDownloadUrl": "https://www.nexusmods.com/api/files/.../download?nmm=1",
          "dependencyCount": 0,
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
```

**注意**: `textContent` 为空，必须通过 `getAttribute('download-links')` 提取 JSON。

### 2. Permissions and credits

**特点**: 包含权限列表和作者备注

```html
<dd class="clearfix">
  <div class="permissions-table">
    <ul>
      <li>Other user's assets: Some assets in this file belong to other authors...</li>
      <li>Upload permission: You are not allowed to upload this file...</li>
      <li>Modification permission: You are allowed to modify my files...</li>
      ...
    </ul>
  </div>
  <div class="author-notes">...</div>
  <div class="file-credits">...</div>
</dd>
```

**提取方法**: `dd.querySelectorAll('ul li')` 获取权限列表

### 3. Translations

**特点**: 包含翻译表格，表格中有 MOD 链接

```html
<dd class="clearfix">
  <table>
    <thead>
      <tr><th>Language</th><th>Name</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <a href="/skyrimspecialedition/mods/95367">French</a>
          <div>Author:Wunduniik Team</div>
        </td>
        <td>SkyUI - Traduction Francaise</td>
      </tr>
    </tbody>
  </table>
</dd>
```

**提取方法**: 遍历 `table tr`，提取 `td` 中的 `a[href*="/mods/"]` 链接

### 4. Changelogs

**特点**: 包含版本历史和变更列表

```html
<dd class="clearfix">
  <div class="changelog-version">
    <h3>Version 6.11</h3>
    <ul>
      <li>Fixed some RaceMenu buttons...</li>
    </ul>
  </div>
  ...
</dd>
```

**提取方法**: `dd.querySelectorAll('ul li')` 获取变更条目

### 5. Mods using this mod (懒加载)

**特点**: 使用 `data-lazy-url` 属性，初始显示 "Loading..."

```html
<dd class="clearfix open" style="overflow: hidden; display: block;">
  <div data-lazy-url="/api/games/1704/mods/12604/required-by?show_adult_content=1">
    Loading...
  </div>
</dd>
```

**提取方法**: 不等待懒加载，直接通过 API 获取：
```javascript
// API URL: https://www.nexusmods.com/api/games/{gameId}/mods/{modId}/required-by?show_adult_content=1
// 返回 HTML 表格
```

**API 返回格式**:
```html
<table>
  <tr><th>Mod name</th><th>Notes</th></tr>
  <tr>
    <td><a href="/skyrimspecialedition/mods/182994">Canidae - A Wolf Replacer</a></td>
    <td></td>
  </tr>
</table>
```

### 6. Donations

**特点**: 简单的捐赠按钮

```html
<dd class="clearfix">
  <div>Straight donations accepted</div>
  <a href="...">Donate</a>
</dd>
```

### 7. Collections containing this mod

**特点**: 通常为空或显示收藏集列表

```html
<dd class="clearfix">
  <!-- 空或包含收藏集列表 -->
</dd>
```

## 通用提取代码

```javascript
// 提取所有 accordion 章节
var result = {};
var accordion = document.querySelector('dl.accordion');
if (!accordion) return result;

var dts = accordion.querySelectorAll('dt');
for (var i = 0; i < dts.length; i++) {
  var dt = dts[i];
  var dd = dt.nextElementSibling;
  if (!dd || dd.tagName !== 'DD') continue;
  
  var headingText = dt.textContent.trim();
  var sectionKey = headingText;
  
  // 标准化 key
  if (headingText.indexOf('Permissions') !== -1) sectionKey = 'permissions';
  else if (headingText.indexOf('Translations') !== -1) sectionKey = 'translations';
  else if (headingText.indexOf('Changelogs') !== -1) sectionKey = 'changelogs';
  else if (headingText.indexOf('Mods using this mod') !== -1) sectionKey = 'usedBy';
  else if (headingText.indexOf('Collections') !== -1) sectionKey = 'collections';
  
  result[sectionKey] = {
    heading: headingText,
    isOpen: dd.style.display !== 'none' && !dd.classList.contains('hidden'),
    text: dd.textContent.trim().substring(0, 3000)
  };
  
  // 提取表格
  var tables = dd.querySelectorAll('table');
  if (tables.length > 0) {
    result[sectionKey].tables = [];
    for (var t = 0; t < tables.length; t++) {
      var tableData = [];
      var rows = tables[t].querySelectorAll('tr');
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].querySelectorAll('td, th');
        var rowData = [];
        for (var c = 0; c < cells.length; c++) {
          var cellText = cells[c].textContent.trim();
          var link = cells[c].querySelector('a[href*="/mods/"]');
          if (link) {
            var modUrl = link.getAttribute('href');
            var modIdMatch = modUrl ? modUrl.match(/\/mods\/(\d+)/) : null;
            rowData.push({
              text: cellText,
              modName: link.textContent.trim(),
              modId: modIdMatch ? modIdMatch[1] : null,
              modUrl: modUrl.startsWith('http') ? modUrl : 'https://www.nexusmods.com' + modUrl
            });
          } else {
            rowData.push(cellText);
          }
        }
        tableData.push(rowData);
      }
      result[sectionKey].tables.push(tableData);
    }
  }
  
  // 提取 main-file-requirements
  var reqEl = dd.querySelector('main-file-requirements');
  if (reqEl) {
    var downloadLinks = reqEl.getAttribute('download-links');
    if (downloadLinks) {
      try {
        result[sectionKey].requirements = JSON.parse(downloadLinks);
      } catch (e) {
        result[sectionKey].requirementsRaw = downloadLinks.substring(0, 2000);
      }
    }
  }
  
  // 提取列表
  var lists = dd.querySelectorAll('ul, ol');
  if (lists.length > 0) {
    result[sectionKey].lists = [];
    for (var l = 0; l < lists.length; l++) {
      var items = lists[l].querySelectorAll('li');
      var listData = [];
      for (var li = 0; li < items.length; li++) {
        listData.push(items[li].textContent.trim());
      }
      result[sectionKey].lists.push(listData);
    }
  }
}

return result;
```

## 注意事项

1. **懒加载区域**: "Mods using this mod" 使用 `data-lazy-url` 懒加载，点击 `dt` 后通过 AJAX 获取内容。直接提取 `textContent` 只能得到 "Loading..."。
2. **Web Components**: Requirements 使用 `<main-file-requirements>` 自定义元素，数据存储在属性中而非 DOM 文本中。
3. **表格链接**: Translations 表格中的 MOD 链接包含作者信息，需要解析 `a` 标签的 `href` 获取 MOD ID。
4. **章节顺序**: 不同 MOD 的章节顺序可能不同，不要依赖固定索引。