# Tags & Gallery DOM 结构实测记录

> 日期: 2025-06-29
> 来源: MOD 183263 (Crystalheart - SkyUI Icons) 页面源码
> ⚠️ 本文档中的 `skyrimspecialedition` 域名是实测时的游戏域。实际操作中由 `game_domain` 配置决定。

---

## Tags 区域

### DOM 结构

```html
<div class="sideitem clearfix">
  <ul class="tags">
    <span>
      <li>
        <a class="btn inline-flex" href="/games/skyrimspecialedition/mods/?tags_yes[]=1069&tag=Anime" tabindex="0">
          <svg class="icon icon-tag"><use xlink:href="/assets/images/icons/icons.svg#icon-tag"></use></svg>
          <span class="flex-label">Anime</span>
        </a>
      </li>
      ...
    </span>
    <span class="js-hidable-tags hidden"></span>
  </ul>
  <a class="btn btnsmall popup-btn-ajax" href="/Core/Libs/Common/Widgets/ModTaggingPopUp?mod_id=183263&game_id=1704" ...>
    Tag this mod
  </a>
</div>
```

### 提取选择器

| 目标 | 选择器 |
|------|--------|
| 标签容器 | `ul.tags` |
| 标签链接 | `ul.tags li a` |
| 标签名称 | `ul.tags li a .flex-label` |
| 标签 URL | `ul.tags li a` 的 `href` 属性 |

### 标签链接格式

```
/games/skyrimspecialedition/mods/?tags_yes[]={tag_id}&tag={tag_name}
```

- `tag_id` 为数字（如 `1069`）
- `tag_name` 为 URL 编码后的标签名（如 `User+Interface`、`Visual+Effects%2FParticles`）
- 完整 URL 需补上前缀 `https://www.nexusmods.com`

---

## Gallery 区域

### DOM 结构

```html
<ul class="thumbgallery gallery clearfix" style="width: 1730px; height: 160px; transform: translate3d(0px, 0px, 0px);">
  <li class="thumb"
      data-src="https://staticdelivery.nexusmods.com/mods/1704/images/183263/183263-1782095895-1789389423.png"
      data-sub-html=""
      data-exthumbimage="https://staticdelivery.nexusmods.com/mods/1704/images/thumbnails/183263/183263-1782095895-1789389423.png"
      id="top-thumb-1868132"
      style="width: 230px; height: 130px; opacity: 1;">
    <figure style="height: 130px;">
      <a href="#">
        <img src="https://staticdelivery.nexusmods.com/mods/1704/images/thumbnails/183263/183263-1782095895-1789389423.png"
             title="" alt="" style="max-height: 130px;">
      </a>
    </figure>
  </li>
  ...
</ul>
```

### 提取选择器

| 目标 | 选择器 |
|------|--------|
| Gallery 容器 | `ul.thumbgallery.gallery.clearfix` |
| 每个图片项 | `ul.thumbgallery li.thumb` |
| 大图 URL | `li.thumb` 的 `data-src` 属性 |
| 缩略图 URL | `li.thumb` 的 `data-exthumbimage` 属性 |
| 备选图片 URL | `li.thumb img` 的 `src` 属性 |

### URL 结构

- 大图: `https://staticdelivery.nexusmods.com/mods/{game_id}/images/{mod_id}/{filename}`
- 缩略图: `https://staticdelivery.nexusmods.com/mods/{game_id}/images/thumbnails/{mod_id}/{filename}`
- 游戏 ID: Skyrim SE = `1704`

---

## 常见陷阱

1. **旧选择器失效**: 早期选择器 `.mod-tags .tag` 和 `.gallery-image img` 在 Nexus Mods 改版后已失效，必须使用 `ul.tags` 和 `ul.thumbgallery` 选择器。

2. **标签文本位置**: 标签文本在 `.flex-label` 子元素中，不在 `<a>` 的直接 textContent 中（因为 `<a>` 还包含 SVG 图标）。

3. **Gallery 图片双重 URL**: `li.thumb` 同时有 `data-src`（大图）和 `data-exthumbimage`（缩略图），优先使用这两个属性而非 `img.src`。

4. **ES5 语法约束**: CDP `Runtime.evaluate` 中必须使用传统 `function` 声明，不能用箭头函数。
