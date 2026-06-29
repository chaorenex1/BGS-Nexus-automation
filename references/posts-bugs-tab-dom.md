# Posts & Bugs TAB DOM 结构实测记录

> 实测日期: 2026-06-29
> 测试页面: https://www.nexusmods.com/skyrimspecialedition/mods/12604?tab=posts, https://www.nexusmods.com/skyrimspecialedition/mods/183637?tab=bugs

## Posts TAB — 评论列表

### 容器结构
```html
<div class="tabcontent tabcontent-mod-page" aria-live="assertive" role="status">
  <div id="comment-container">
    <ol>
      <li class="comment comment-sticky" id="comment-167915186">
        <!-- 评论内容 -->
      </li>
    </ol>
  </div>
</div>
```

### 单条评论 DOM
```html
<li class="comment comment-sticky" id="comment-167915186">
  <div class="comment-head clearfix">
    <a class="comment-user" href="https://next.nexusmods.com/profile/ikonomov">
      <img src="..." title="ikonomov" alt="ikonomov" width="55" height="55">
    </a>
    <div class="comment-details">
      <span class="comment-name">
        <a href="https://next.nexusmods.com/profile/ikonomov">ikonomov</a>
      </span>
      <ul class="clearfix">
        <li><span class="status-premium">premium</span></li>
        <li>94 kudos</li>
      </ul>
    </div>
    <div class="comment-actions">
      <!-- Report, Reply, Collapse buttons -->
    </div>
  </div>
  
  <div class="comment-content">
    <div id="locked-comment-label-167915186" class="locked">Locked</div>
    <div id="sticky-comment-label-167915186" class="sticky">Sticky</div>
    <time class="dst-date-adjust" data-date="1775582045" data-date-format="d M Y, g:iA">
      08 Apr 2026, 1:14AM
    </time>
    <div class="comment-content-text" id="comment-content-167915186">
      实际评论内容...
    </div>
  </div>
  
  <!-- 回复区域（如有） -->
  <div class="comment-replies">
    <ol>...</ol>
  </div>
</li>
```

### 提取选择器
| 字段 | 选择器 | 备注 |
|------|--------|------|
| 作者 | `.comment-name a` | 回退: `.comment-user img[title]` |
| 日期 | `time.dst-date-adjust` | `data-date` 含 Unix 时间戳 |
| 内容 | `.comment-content-text` | 排除 `.locked`, `.sticky`, `time` |
| Kudos | `.comment-details ul li` | 匹配 `/\d+\s*kudos/i` |
| 置顶 | `li.comment-sticky` | classList 检查 |
| 回复数 | `.replies-count` | 或 `.comment-replies li.comment` 计数 |
| 评论ID | `li.comment[id]` | 格式: `comment-{数字}` |
| 搜索框 | `.comment-search input` | 评论搜索（如 DOM 搜索无效则 JS 层 case-insensitive 过滤 content + author） |
| 头像 | `.comment-user img[src]` | 用户头像 |
| 用户状态 | `.status-user, .status-premium` | member / premium |
| 锁定 | `.locked` | 检查 `style.display !== 'none'` |

### 嵌套回复（子评论）DOM

**实测（2026-06-29，MOD 12604/183637）**：嵌套回复容器是 `ol.comment-kids`，**不是** `.comment-replies`。

```html
<li class="comment" id="comment-170643506">
  <!-- 评论头部和内容 -->
  <ol class="comment-kids">
    <li class="comment" id="comment-170693849">
      <!-- 嵌套回复 -->
    </li>
    <li class="comment" id="comment-170806682">
      <!-- 嵌套回复 -->
    </li>
  </ol>
</li>
```

**选择器**: 嵌套容器 = `ol.comment-kids`（主选择器），备选 `.comment-replies`, `.replies`

### 分页 DOM

**实测（2026-06-29）**：分页使用 `.pagination.clearfix` 容器，链接 onclick 为 `return window.RH_CommentContainer.Send('page', 'N');`。

```html
<div class="comment-search">
  <!-- 搜索框 -->
</div>
<div class="pagination clearfix">
  <a class="page-selected mfp-prevent-close">1</a>
  <a class="mfp-prevent-close" href="javascript:;" 
     onclick="return window.RH_CommentContainer.Send('page', '2');">2</a>
  <a class="mfp-prevent-close" href="javascript:;"
     onclick="return window.RH_CommentContainer.Send('page', '3');">3</a>
</div>
```

**翻页实现**: 
- URL 参数 `?tab=posts&page=N` **不生效**（Next.js 忽略）
- 必须通过 CDP 调用 `window.RH_CommentContainer.Send('page', 'N')` 触发 AJAX 翻页
- 翻页后等待 3 秒让评论 DOM 更新

### 常见陷阱

### 发帖表单 DOM（2026-06-29 实测 MOD 183637）

**容器**: `DIV#add-comment-form-0.comment-reply.clearfix`，表单默认可见，无需点击 add-comment 按钮。

```html
<div class="wysibb"><div class="wysibb-toolbar">...</div>
  <div class="wysibb-text">
    <textarea id="add-comment-post-0" style="display:none"></textarea>
    <div class="wysibb-body" contenteditable="true"></div>
  </div>
</div>
<a id="submit-add-comment-0" onclick="addNewComment(userId, gameId, modId, 1, 0)">Submit</a>
```

**关键选择器**: `#add-comment-post-0` (textarea), `#submit-add-comment-0` (提交按钮), `#add-comment-error-box-0` (错误提示)

---

## Bugs TAB — Bug 报告列表

### 容器结构
```html
<div class="tabcontent tabcontent-mod-page" aria-live="assertive" role="status">
  <div id="mod_bugs">
    <table>
      <thead>...</thead>
      <tbody>
        <tr id="issue_1096566" data-issue-id="1096566" class="mod-issue-row">
          <!-- bug 内容 -->
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

### 单行 Bug DOM
```html
<tr id="issue_1096566" data-issue-id="1096566" class="mod-issue-row">
  <td class="table-bug-title">
    <a class="issue-title" href="javascript:;" onclick="loadIssueReplies(1096566);"
       id="issueClickLink_1096566">
      Skirt Zap option causes errors with the texture sets
    </a>
    <span class="table-inline-hidden">Version: <i>Shattered Royal Armor 4k</i> - Version 1</span>
    <span class="table-inline-hidden inline-status"><span class="green">Fixed</span></span>
    <span class="table-inline-hidden">Priority: Not set</span>
    <span id="issueFixedInVersion_1096566">Fixed in version: 1.1</span>
  </td>
  <td id="issueStatus_1096566" class="table-bug-status">
    <span class="green">Fixed</span>
  </td>
  <td class="table-bug-replies">3</td>
  <td class="table-bug-version">
    <i>Shattered Royal Armor 4k</i> - Version 1
  </td>
  <td id="issuePriority_1096566" class="table-bug-priority">Not set</td>
  <td id="placeRepliesAfterMe_1096566" class="table-bug-post">
    <time class="dst-date-adjust" data-date="1782610260" data-date-format="G:i, j M Y">
      09:31, 28 Jun 2026
    </time>
  </td>
</tr>
```

### 提取选择器
| 字段 | 选择器 | 备注 |
|------|--------|------|
| Bug ID | `tr[data-issue-id]` | 或 `tr.id.replace('issue_', '')` |
| 标题 | `td.table-bug-title a.issue-title` | href 为 `javascript:;` |
| 状态 | `td.table-bug-status` | 含 `.green`/`.red`/`.yellow` |
| 回复数 | `td.table-bug-replies` | 纯数字文本 |
| 版本 | `td.table-bug-version` | 可能含 `<i>` 标签 |
| 优先级 | `td.table-bug-priority` | 如 "Not set" |
| 最后回复 | `td.table-bug-post time` | `data-date` 含时间戳 |

### 常见陷阱
- 表格不能依赖特定 class（如 `bugs-table`），实际 class 可能为空或 `translation-table`
- 行选择器应使用 `tr[data-issue-id]` 而非 `tr[data-bug-id]`
- 标题链接 href 为 `javascript:;`，不是有效 URL
- 状态列含颜色标签（`<span class="green">Fixed</span>`），需提取 `textContent`
- 标题列的 `.table-inline-hidden` 在桌面端隐藏，但 textContent 仍会包含其文本
- 部分 MOD 没有 Bugs tab，返回空数组是正常行为

---

## 通用注意事项

1. **Next.js 渲染等待**: Posts 和 Bugs tab 都是客户端渲染，导航后需等待 5-6 秒
2. **Cloudflare 验证**: 频繁访问可能触发 Cloudflare challenge，使用 CDP 连接真实浏览器（带登录态）可降低触发概率
3. **空结果处理**: 有些 MOD 作者关闭了 Posts 或 Bugs tab，空数组是正常结果，不是错误
4. **ES5 语法**: CDP `Runtime.evaluate` 中必须使用传统 `var` 和 `function`，禁用箭头函数、可选链、模板字符串嵌套
