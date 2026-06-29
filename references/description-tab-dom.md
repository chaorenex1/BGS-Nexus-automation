# Description TAB DOM 结构参考

## 内容区域选择器

Nexus Mods 的 Description TAB 使用以下结构：

```html
<div class="tabcontent tabcontent-mod-page" aria-live="assertive" role="status">
  <!-- 实际内容 -->
</div>
```

**推荐选择器**（优先级从高到低）：
1. `div.tabcontent.tabcontent-mod-page[aria-live="assertive"][role="status"]` — 最精确，直接定位 Description TAB 内容
2. `#description` — 传统 ID 选择器
3. `.tab-description` — 类名选择器
4. `.mod-description` — 通用类名

## Accordion 结构（dl.accordion）

Description 下方通常有折叠面板：

```html
<dl class="accordion">
  <dt class="clearfix">Permissions and credits <span class="acc-status">...</span></dt>
  <dd class="clearfix">...</dd>
  
  <dt class="clearfix">Translations <span class="acc-status">...</span></dt>
  <dd class="clearfix">...</dd>
  
  <dt class="clearfix">Changelogs</dt>
  <dd class="clearfix">...</dd>
  
  <dt class="clearfix">Mods using this mod (4)</dt>
  <dd class="clearfix">
    <div class="tabbed-block" data-lazy-url="/api/games/1704/mods/182994/required-by?show_adult_content=1" data-lazy-loaded="false">
      <p class="loading-text">Loading...</p>
    </div>
  </dd>
  
  <dt class="clearfix">Collections containing this mod</dt>
  <dd class="clearfix">...</dd>
</dl>
```

### 关键特征

- `DT` 元素包含标题文本和 `<span class="acc-status">` 箭头图标
- `DD` 元素包含内容，初始状态可能为 `display: none`
- 点击 `DT` 会切换 `DD` 的显示状态
- 部分区域（如 `Mods using this mod`）使用懒加载：`data-lazy-url` 属性

## 分区提取正则

用于 `extractSections()` 的正则模式：

```javascript
// 匹配标题及其后续内容，直到遇到下一个大标题
const regex = new RegExp(
  '(' + term + ')[\s\S]*?(?=(?:[A-Z][a-zA-Z\s]{2,50}\n|Permissions|Compatibility|Changelog|Translations|Description|Features|Dependencies|Requirements|Credits|License|Updates|Version History|Mods using this mod|Used by|Mods requiring this|$))',
  'i'
);
```

### 关键词映射

| 分区 key | 匹配标题 |
|----------|----------|
| `features` | Features, What this mod does, Overview |
| `compatibility` | Compatibility, Compatible, Requirements |
| `translation` | Translation, Translations, Localisation |
| `permissions` | Permissions, Credits, License |
| `changelog` | Changelog, Version History, Updates |
| `dependencies` | Dependencies, Required, Prerequisites |
| `usedBy` | Mods using this mod, Used by, Mods requiring this |

## "Mods using this mod" 懒加载处理

该区域通过 `data-lazy-url` 懒加载，直接点击无法获取内容。

**解决方案**：通过 API 直接获取：

```
GET https://www.nexusmods.com/api/games/{game_id}/mods/{mod_id}/required-by?show_adult_content=1
```

- `game_id`: 游戏 ID（Skyrim SE = 1704）
- `mod_id`: MOD ID
- 返回 HTML 表格，需在浏览器上下文中解析

### 返回格式

表格包含两列：
- `Mod name`: 使用此 MOD 的其他 MOD 名称（含链接）
- `Notes`: 备注说明

## 实测记录

- 测试 MOD: 182994 (Canidae - A Wolf Replacer)
- 测试日期: 2025-06-29
- 浏览器: Chrome 通过 @puppeteer/browsers 启动
- 登录状态: 已登录
