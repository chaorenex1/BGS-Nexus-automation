# Files TAB DOM 结构详解

> 实测日期: 2026-06-29
> 适用页面: Nexus Mods MOD 详情页 Files TAB
> 测试 MOD: 12604 (SkyUI)
> ⚠️ 本文档中的 `skyrimspecialedition` 域名是实测时的游戏域。实际操作中由 `game_domain` 配置决定。

## 整体结构

Files TAB 使用 `div#mod_files` 作为容器，内部按分类分为多个 `div.tabbed-section`：

```html
<div id="mod_files" data-game-id="1704" data-mod-id="12604" class="container tab-files condensed fill-file-stats" style="display: block;">
  <div id="file-container-main-files" class="tabbed-section tabbed-block files-tabs">
    <div class="file-category-header">Main files</div>
    <dl>
      <dt id="file-expander-header-749043" class="file-expander-header clearfix accopen"
          data-id="749043" data-name="SkyUI" data-size="2630" data-version="6.11"
          data-date="1778020881" data-dependencies-count="1">
        <div style="display: flex;">
          <div class="result safe inline-flex">...</div>
          <p style="margin: 5px 5px 0 0;">SkyUI</p>
          <i class="material-icons" title="You downloaded this mod file on 17 May 2026">cloud_download</i>
          <div class="file-download-stats clearfix">
            <ul style="float:right;" class="stats">
              <li class="stat-downloaded">...</li>
              <li class="stat-uploaddate">...</li>
            </ul>
          </div>
        </div>
      </dt>
      <dd class="clearfix open" data-id="749043">
        <div class="tabbed-block files-description">
          <p><a href="...">SkyUI 6 Update</a><br><br>Supports 1.5.97 and 1.6.1170...</p>
        </div>
        <div class="tabbed-block">
          <ul class="accordion-downloads clearfix">
            <li>
              <download-modal file-name="SkyUI" file-uid="7318625021427"
                show-vortex-button="true" is-premium="true"
                download-links="{&quot;name&quot;:&quot;SkyUI&quot;...}">
              </download-modal>
            </li>
          </ul>
        </div>
      </dd>
    </dl>
  </div>

  <div id="file-container-optional-files" class="tabbed-section tabbed-block files-tabs">
    <div class="file-category-header">Optional files</div>
    ...
  </div>

  <div id="file-container-old-files" class="tabbed-section tabbed-block files-tabs">
    <div class="file-category-header">Old files</div>
    ...
  </div>
</div>
```

## 关键元素

### 1. 容器

| 选择器 | 说明 |
|--------|------|
| `div#mod_files` | 主容器，含 `data-game-id`, `data-mod-id` |
| `div#file-container-main-files` | Main files 分类 |
| `div#file-container-optional-files` | Optional files 分类 |
| `div#file-container-old-files` | Old files 分类 |

### 2. 文件条目 (DT)

`dt.file-expander-header` 包含文件概要：

**data-* 属性**:
| 属性 | 说明 | 示例 |
|------|------|------|
| `data-id` | 文件 ID | `749043` |
| `data-name` | 文件名 | `SkyUI` |
| `data-version` | 版本 | `6.11` |
| `data-size` | 文件大小（KB） | `2630` |
| `data-date` | 上传时间戳 | `1778020881` |
| `data-dependencies-count` | 依赖数量 | `1` |

**子元素**:
- `p`: 文件名显示
- `i.material-icons[title*="downloaded"]`: 已下载标记（存在即表示已下载）
- `div.file-download-stats > ul.stats`: 统计信息

### 3. 统计信息 (ul.stats)

| class | 说明 |
|-------|------|
| `stat-downloaded` | 上次下载日期（含 `<time>` 元素） |
| `stat-uploaddate` | 上传日期（含 `<time>` 元素） |
| `stat-unique-dls` | 独立下载数 |
| `stat-total-dls` | 总下载数 |
| `stat-filesize` | 文件大小 |
| `stat-endorsements` | 点赞数 |

### 4. 文件详情 (DD)

`dd.clearfix` 是 `dt` 的下一个兄弟元素：

**子元素**:
| 选择器 | 说明 |
|--------|------|
| `div.files-description` | 文件描述 |
| `download-modal` | 下载按钮自定义元素 |
| `ul.accordion-downloads` | 下载按钮容器 |

### 5. Download Modal 自定义元素

```html
<download-modal
  file-name="SkyUI"
  file-uid="7318625021427"
  show-vortex-button="true"
  is-premium="true"
  eligible-for-free-trial="false"
  download-links="{JSON}"
  show-adult-content="true">
</download-modal>
```

**关键属性**:
| 属性 | 说明 |
|------|------|
| `file-name` | 文件名 |
| `file-uid` | 文件唯一 ID（用于下载） |
| `show-vortex-button` | 是否显示 Vortex/Mod Manager 下载按钮 |
| `is-premium` | 是否需要 Premium 会员 |
| `download-links` | JSON 字符串，包含下载 URL 和依赖信息 |

**download-links JSON 结构**:
```json
{
  "name": "SkyUI",
  "category": 1,
  "downloadUrl": "https://www.nexusmods.com/api/files/7318625021427/download",
  "vortexDownloadUrl": "https://www.nexusmods.com/api/files/7318625021427/download?nmm=1",
  "dependenciesCount": 1,
  "dependencies": [
    {
      "files": [
        {
          "uid": 7318624734761,
          "name": "Skyrim Script Extender (SKSE64) Steam",
          "version": "2.2.6",
          "downloadUrl": "...",
          "vortexDownloadUrl": "...",
          "dependencyCount": 0,
          "mod": {
            "name": "Skyrim Script Extender (SKSE64)",
            "url": "https://www.nexusmods.com/skyrimspecialedition/mods/30379",
            "thumbnailUrl": "...",
            "adultContent": false
          }
        }
      ]
    }
  ]
}
```

## 注意事项

1. **无传统表格**: Files TAB 不使用 `<table>`，而是使用 `dl/dt/dd` accordion 结构
2. **data-* 属性优先**: 文件元数据优先从 `dt` 的 `data-*` 属性获取，而非解析文本
3. **Custom Element**: 下载按钮使用 `<download-modal>` Web Component，数据在 `download-links` 属性中
4. **分类明确**: 文件按 Main/Optional/Old 分类，每个分类有独立的容器 div
5. **时间戳**: `data-date` 是 Unix 时间戳，需要转换；`time` 元素含已格式化的日期
6. **下载状态**: `i.material-icons[title*="downloaded"]` 存在表示用户已下载过此文件