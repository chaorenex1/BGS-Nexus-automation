# Tracking Centre & Download History DOM Reference

实测日期: 2026-06-29
> ⚠️ 本文档中的 `skyrimspecialedition` 域名是实测时的游戏域。实际操作中由 `game_domain` 配置决定。

## 功能11: Tracking Centre

### URL
```
https://www.nexusmods.com/skyrimspecialedition/mods/trackingcentre?tab=mods
```
⚠️ NOT `/users/trackingcentre` — that's a 404.

### Table
- 定位: `table.mod-tracking-table` (无 id)
- 表头: `Mod name | Game | Author | Category | Version | Last upload | Last download | Log | Tracking`
- 每页20条，共446个追踪MOD，23页

### Pagination
- 机制: `window.RH_TrackedModsTab.Send('page', 'N')` — JS AJAX 调用
- 分页链接 HTML:
```html
<a class="mfp-prevent-close" href="javascript:;" onclick="return window.RH_TrackedModsTab.Send('page', '2');">2</a>
<span class="empty extra">...</span>
```
- 当前页: `a.page-selected` 元素

### Track/Untrack button
```html
<a class="toggle-track-mod" data-mod-id="151502" data-game-id="1704" data-do-track="0" data-source-page="trackingcentre">Stop tracking</a>
```
- `data-do-track="0"` = 已追踪 → 点击取消
- `data-do-track="1"` = 未追踪 → 点击追踪
- 无 onclick — 使用事件委托
- 点击需 `Input.dispatchMouseEvent`

### Search
- **无内置搜索框** — 需客户端 `innerText` 关键字匹配

### Column class mapping
| Index | Class | Content |
|-------|-------|---------|
| 0 | `tracking-mod` | MOD name + status label + link to mod page |
| 1 | `tracking-game` | Game name (e.g. "Skyrim Special Edition") |
| 2 | `table-author` | Author name + link to profile |
| 3 | `table-category` | Category + link |
| 4 | `table-version` | Version + changelog link |
| 5 | `table-update` | Last upload date |
| 6 | `table-download` | Last download date ("--" if never) |
| 7 | `table-activity` | "View" action log link |
| 8 | `table-tracking` | Tracking toggle button |

---

## 功能12: Download History

### URL
```
https://www.nexusmods.com/users/myaccount?tab=download+history
```
⚠️ NOT `/users/downloadhistory`

### Table
- 定位: `#DataTables_Table_0.datatable` (DataTables 1.x)
- 表头: `Mod name | Last DL | Uploader | Category | Updated | Endorsement | Log`
- 2,996条总计，150页

### Pagination
- 机制: DataTables `.paginate_button` 按钮
```html
<a class="paginate_button current" data-dt-idx="1">1</a>
<a class="paginate_button" data-dt-idx="2">2</a>
<a class="paginate_button next" data-dt-idx="7">Next</a>
```
- 信息: `.dataTables_info` — "Showing 1 to 20 of 2,996 entries"

### Search
- 机制: DataTables 内置搜索
```html
<input type="search" aria-controls="DataTables_Table_0">
```
- 触发: `input` + `change` + `keyup(Enter)` 事件

### Endorse/Unendorse button
```html
<div id="endorsement-1704-183263">
  <a class="endorse-mod" title="Endorse this mod" data-positive="1" data-mod-id="183263" data-game-id="1704" data-mod-uid="7318624455647">
    <svg class="icon icon-endorse-active">  <!-- 或 icon-endorse-inactive -->
  </a>
  <a class="endorse-mod" title="Abstain from endorsing this mod" data-positive="0" data-mod-id="183263" data-game-id="1704" data-mod-uid="7318624455647">
  </a>
</div>
```
- `data-positive="1"` = 点赞; `"0"` = 取消点赞
- 状态: SVG `className.baseVal` 含 `"endorse-active"` 或 `"endorse-inactive"`
- 点击需 `Input.dispatchMouseEvent`

### Log link
```html
<a class="popup-btn-ajax" href="/Core/Libs/Common/Widgets/ModActionLogPopUp?mod_id=183263&game_id=1704">View</a>
```

---

## 功能13: MO2 API Keys

### URL
```
https://www.nexusmods.com/settings/api-keys
```
⚠️ NOT `/settings/preferences` or `/users/settings`

### Page structure
- 左侧导航: Preferences, Content blocking, Profile, Donations, **API Keys**, Notifications, Emails, Moderation, Security, Billing
- 内容区: "Manage the API keys for all your third-party apps."
- 集成列表 (每个一个 section):
  - Kortex Mod Manager — "Request Api Key"
  - Automaton — "Request Api Key"
  - **Mod Organizer 2** — 显示 `input[type="text"]` 含加密 key
  - ME3Tweaks Mod Manager — "Request Api Key"
  - ...

### MO2 section locator
```html
<img alt="Mod Organizer 2" class="w-40 shrink-0" src="https://images.nexusmods.com/oauth/applications/api_app_logo_1593769215_phpkxxf6l.jpeg">
```
- 向上遍历祖先容器找到 `input[type="text"]`
- API key 值已经过加密编码存储

### ES5 CDP Syntax Warning
追踪中心页面 (`/mods/trackingcentre`) 在 evaluate 中使用 `const`/`?.`/arrow function 会触发:
```
SyntaxError: Unexpected token 'const'
```
即使 Chrome 150 原生支持 ES6。必须严格使用 ES5 语法。
