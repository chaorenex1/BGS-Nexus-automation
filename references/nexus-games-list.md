# Nexus Mods Games 列表参考

> 来源: `https://www.nexusmods.com/games` (首页第1页, 2026-07-01)
> DOM 选择器: `[data-e2eid="game-tile-title"]` + `img[alt]`
> ⚠️ 本文档中的域名示例是首页抓取的快照数据。

## 页面结构

- **URL 格式**: `https://www.nexusmods.com/games/{game_domain}`
- **图片 CDN**: `https://images.nexusmods.com/images/games/v2/{game_id}/tile.jpg`
- 页面使用 Next.js App Router (RSC 流渲染)，共宣称 4,824 个游戏，首页显示 20 个
- 分页通过无限滚动触发 GraphQL 请求（`api-router.nexusmods.com/graphql`）

## 字段映射

| 字段 | 说明 | 提取方式 |
|------|------|----------|
| `name` | 游戏名称 | `[data-e2eid="game-tile-title"]` innerText |
| `domain` | URL 域名片段 | 从 href 提取 `/games/{domain}` 部分 |
| `url` | 完整游戏页面 URL | `[data-e2eid="game-tile-title"]` href 属性 |
| `game_id` | 游戏数字 ID | 从封面图 URL 提取 `images/games/v2/{game_id}/` |
| `image` | 封面图 URL | `img[alt="{name}"]` src 属性 |

## 首页游戏列表 (Page 1, 20 games)

```json
[
  {"name":"Skyrim Special Edition","domain":"skyrimspecialedition","game_id":"1704","url":"https://www.nexusmods.com/games/skyrimspecialedition","image":"https://images.nexusmods.com/images/games/v2/1704/tile.jpg"},
  {"name":"Fallout 4","domain":"fallout4","game_id":"1151","url":"https://www.nexusmods.com/games/fallout4","image":"https://images.nexusmods.com/images/games/v2/1151/tile.jpg"},
  {"name":"Skyrim","domain":"skyrim","game_id":"110","url":"https://www.nexusmods.com/games/skyrim","image":"https://images.nexusmods.com/images/games/v2/110/tile.jpg"},
  {"name":"Cyberpunk 2077","domain":"cyberpunk2077","game_id":"3333","url":"https://www.nexusmods.com/games/cyberpunk2077","image":"https://images.nexusmods.com/images/games/v2/3333/tile.jpg"},
  {"name":"Fallout New Vegas","domain":"newvegas","game_id":"130","url":"https://www.nexusmods.com/games/newvegas","image":"https://images.nexusmods.com/images/games/v2/130/tile.jpg"},
  {"name":"Stardew Valley","domain":"stardewvalley","game_id":"1303","url":"https://www.nexusmods.com/games/stardewvalley","image":"https://images.nexusmods.com/images/games/v2/1303/tile.jpg"},
  {"name":"Baldur's Gate 3","domain":"baldursgate3","game_id":"3474","url":"https://www.nexusmods.com/games/baldursgate3","image":"https://images.nexusmods.com/images/games/v2/3474/tile.jpg"},
  {"name":"Oblivion","domain":"oblivion","game_id":"101","url":"https://www.nexusmods.com/games/oblivion","image":"https://images.nexusmods.com/images/games/v2/101/tile.jpg"},
  {"name":"The Witcher 3","domain":"witcher3","game_id":"952","url":"https://www.nexusmods.com/games/witcher3","image":"https://images.nexusmods.com/images/games/v2/952/tile.jpg"},
  {"name":"Fallout 3","domain":"fallout3","game_id":"120","url":"https://www.nexusmods.com/games/fallout3","image":"https://images.nexusmods.com/images/games/v2/120/tile.jpg"},
  {"name":"Starfield","domain":"starfield","game_id":"4187","url":"https://www.nexusmods.com/games/starfield","image":"https://images.nexusmods.com/images/games/v2/4187/tile.jpg"},
  {"name":"Mount & Blade II: Bannerlord","domain":"mountandblade2bannerlord","game_id":"3174","url":"https://www.nexusmods.com/games/mountandblade2bannerlord","image":"https://images.nexusmods.com/images/games/v2/3174/tile.jpg"},
  {"name":"Morrowind","domain":"morrowind","game_id":"100","url":"https://www.nexusmods.com/games/morrowind","image":"https://images.nexusmods.com/images/games/v2/100/tile.jpg"},
  {"name":"Modding Tools","domain":"site","game_id":"2295","url":"https://www.nexusmods.com/games/site","image":"https://images.nexusmods.com/images/games/v2/2295/tile.jpg"},
  {"name":"Monster Hunter: World","domain":"monsterhunterworld","game_id":"2531","url":"https://www.nexusmods.com/games/monsterhunterworld","image":"https://images.nexusmods.com/images/games/v2/2531/tile.jpg"},
  {"name":"Blade & Sorcery","domain":"bladeandsorcery","game_id":"2673","url":"https://www.nexusmods.com/games/bladeandsorcery","image":"https://images.nexusmods.com/images/games/v2/2673/tile.jpg"},
  {"name":"Dragon Age: Origins","domain":"dragonage","game_id":"140","url":"https://www.nexusmods.com/games/dragonage","image":"https://images.nexusmods.com/images/games/v2/140/tile.jpg"},
  {"name":"Red Dead Redemption 2","domain":"reddeadredemption2","game_id":"3024","url":"https://www.nexusmods.com/games/reddeadredemption2","image":"https://images.nexusmods.com/images/games/v2/3024/tile.jpg"},
  {"name":"Elden Ring","domain":"eldenring","game_id":"4333","url":"https://www.nexusmods.com/games/eldenring","image":"https://images.nexusmods.com/images/games/v2/4333/tile.jpg"},
  {"name":"Stellar Blade","domain":"stellarblade","game_id":"7804","url":"https://www.nexusmods.com/games/stellarblade","image":"https://images.nexusmods.com/images/games/v2/7804/tile.jpg"}
]
```

## CDP 提取代码模板

```javascript
// ES5 兼容 — Nexus 页面安全
var titles = document.querySelectorAll('[data-e2eid="game-tile-title"]');
var games = [];
for (var i = 0; i < titles.length; i++) {
  var a = titles[i];
  var name = a.innerText.trim();
  var url = a.href;
  var img = document.querySelector('img[alt="' + name + '"]');
  var image = img ? img.src : '';
  games.push({name: name, url: url, image: image});
}
JSON.stringify(games);
```

## 注意事项

1. Nexus Mods 使用 Cloudflare 保护，curl/wget 无法直接抓取 — 必须用真实 Chrome CDP
2. `/games` 页面无 `__NEXT_DATA__`，数据通过 RSC 流 (`__next_f`) 传入
3. 首页默认按热度排序显示 20 个游戏；更多通过无限滚动 + GraphQL 加载
4. `game_id` 是关键参数 — 所有 MOD API 调用都需要 `game_id`（如 Skyrim SE = 1704）
5. Nexus API (`api.nexusmods.com/v1/games.json`) 需要注册的 API Key，匿名不可用
