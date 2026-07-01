/**
 * Nexus Mods Automation Helper Script — 原生 CDP 实现
 * 不使用 puppeteer-core/playwright，直接通过 Chrome DevTools Protocol 操作浏览器
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

/**
 * 读取 game_domain，优先级: CLI arg (--game=xxx) > env BGS_NEXUS_GAME_DOMAIN > state file > 默认值
 */
function resolveGameDomain() {
  // 1. --game=<domain> CLI flag
  var cliGame = null;
  for (var a = 2; a < process.argv.length; a++) {
    var match = process.argv[a].match(/^--game=(.+)$/);
    if (match) { cliGame = match[1]; break; }
  }
  if (cliGame) return cliGame;

  // 2. BGS_NEXUS_GAME_DOMAIN env var
  if (process.env.BGS_NEXUS_GAME_DOMAIN) return process.env.BGS_NEXUS_GAME_DOMAIN;

  // 3. State file
  try {
    var stateFile = path.join(process.env.TEMP || '/tmp', 'BGS-Nexus-automation', 'game-domain.json');
    if (fs.existsSync(stateFile)) {
      var state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (state.game_domain) return state.game_domain;
    }
  } catch (e) { /* ignore */ }

  // 4. Default
  return 'skyrimspecialedition';
}

const TEMP_DIR = path.join(process.env.TEMP || '/tmp', 'BGS-Nexus-automation');

const CONFIG = {
  NEXUS_BASE_URL: 'https://www.nexusmods.com',
  GAME_DOMAIN: resolveGameDomain(),
  WS_ENDPOINT_FILE: path.join(process.env.TEMP || '/tmp', 'BGS-Nexus-automation', 'ws-endpoint.txt'),
  STATE_DIR: TEMP_DIR,
  GAME_DOMAIN_FILE: path.join(TEMP_DIR, 'game-domain.json'),
  DEBUG_PORT: process.env.BGS_NEXUS_DEBUG_PORT || '9222',
  DEFAULT_VIEWPORT: { width: 1920, height: 1080 }
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const humanDelay = async (min = 200, max = 800) => {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await delay(ms);
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function getWsEndpoint() {
  try {
    const data = await fetchJson(`http://127.0.0.1:${CONFIG.DEBUG_PORT}/json/version`);
    if (data && data.webSocketDebuggerUrl) {
      fs.writeFileSync(CONFIG.WS_ENDPOINT_FILE, data.webSocketDebuggerUrl);
      return data.webSocketDebuggerUrl;
    }
  } catch (error) {
    console.error('读取 WebSocket 端点失败:', error.message);
  }
  // 尝试从文件读取
  if (fs.existsSync(CONFIG.WS_ENDPOINT_FILE)) {
    return fs.readFileSync(CONFIG.WS_ENDPOINT_FILE, 'utf8').trim();
  }
  return null;
}

class CDPClient {
  constructor() {
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
    this.sessionId = null;
  }

  async connect(wsEndpoint) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsEndpoint);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (data) => this._onMessage(data));
    });
  }

  _onMessage(data) {
    const msg = JSON.parse(data.toString());
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      this.id += 1;
      const id = this.id;
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (this.sessionId) payload.sessionId = this.sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  async attachToTarget(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
  }

  async getPageTarget() {
    const { targetInfos } = await this.send('Target.getTargets');
    const page = targetInfos.find(t => t.type === 'page');
    return page;
  }

  async navigate(url) {
    // 先启用 Page 域事件
    try { await this.send('Page.enable'); } catch (e) {}
    const result = await this.send('Page.navigate', { url });
    // 不等待特定事件，直接等待固定时间让页面加载
    await delay(5000);
    return result?.frameId;
  }

  async waitForEvent(eventName, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待事件 ${eventName} 超时`)), timeout);
      const handler = (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.method === eventName) {
            clearTimeout(timer);
            this.ws.removeListener('message', handler);
            resolve(msg.params);
          }
        } catch (e) {}
      };
      this.ws.on('message', handler);
    });
  }

  async evaluate(expression) {
    // Remove CR chars via String.fromCharCode — avoids source-level \r corruption
    const sanitized = expression.replace(new RegExp(String.fromCharCode(13), 'g'), '');
    const response = await this.send('Runtime.evaluate', {
      expression: sanitized,
      returnByValue: true
    });
    if (response?.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || 'JS 执行错误');
    }
    return response?.result?.value;
  }

  async querySelector(selector) {
    const document = await this.evaluate('document');
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: document.nodeId, selector });
    return nodeId;
  }

  async click(selector) {
    // 通过 Runtime.evaluate 执行点击
    await this.evaluate(`
      (function() {
        var el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (el) { el.click(); return true; }
        return false;
      })()
    `);
    await humanDelay(500, 1000);
  }

  async type(selector, text) {
    await this.evaluate(`
      (function() {
        var el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return false;
        el.focus();
        el.value = '${text.replace(/'/g, "\\'")}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
    await humanDelay(300, 600);
  }

  async getUrl() {
    return this.evaluate('window.location.href');
  }

  async scrollTo(y) {
    await this.evaluate(`window.scrollTo({ top: ${y}, behavior: 'smooth' })`);
    await delay(500);
  }

  disconnect() {
    if (this.ws) this.ws.close();
  }
}

async function getPageWsEndpoint() {
  try {
    const targets = await fetchJson(`http://127.0.0.1:${CONFIG.DEBUG_PORT}/json/list`);
    const page = targets.find(t => t.type === 'page' && t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));
    if (page && page.webSocketDebuggerUrl) {
      return page.webSocketDebuggerUrl;
    }
  } catch (error) {
    console.error('获取 Page WebSocket 端点失败:', error.message);
  }
  return null;
}

async function connectToBrowser() {
  const wsEndpoint = await getPageWsEndpoint();
  if (!wsEndpoint) {
    throw new Error('未找到浏览器 Page WebSocket 端点。请先运行 init-browser.js。');
  }
  const client = new CDPClient();
  await client.connect(wsEndpoint);
  return client;
}

async function checkLoginState(client) {
  try {
    await client.navigate(`${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}`);
  } catch (error) {
    console.warn('导航超时，继续检查...');
  }
  await humanDelay(1000, 2000);

  const isLoggedIn = await client.evaluate(`
    (function() {
      var positiveSelectors = ['.user-name', '.account-menu', '[data-user-id]', '.avatar', '.user-avatar'];
      for (var i = 0; i < positiveSelectors.length; i++) {
        if (document.querySelector(positiveSelectors[i])) return true;
      }
      var signInLink = Array.from(document.querySelectorAll('a, button')).find(function(el) {
        return /sign in|log in/i.test((el.textContent || '').trim());
      });
      return !signInLink;
    })()
  `);

  const url = await client.getUrl();
  return { isLoggedIn, url };
}

async function getTrendingMods(client, page = 1) {
  // 访问 7 天 Trending 页面 - 使用正确的 URL 格式，支持翻页
  const trendingUrl = `${CONFIG.NEXUS_BASE_URL}/games/${CONFIG.GAME_DOMAIN}/mods?sort=endorsements&timeRange=7&page=${page}`;
  await client.navigate(trendingUrl);
  await delay(5000); // 等待 Next.js 客户端渲染

  const expr = `
(function() {
  var mods = [];
  var grid = document.querySelector('.mods-grid');
  if (!grid) return { error: 'mods-grid not found', mods: [] };
  
  var tiles = grid.children;
  for (var i = 0; i < tiles.length; i++) {
    var tile = tiles[i];
    
    var titleEl = tile.querySelector('[data-e2eid="mod-tile-title"]');
    var authorEl = tile.querySelector('[data-e2eid="user-link"]');
    var imgEl = tile.querySelector('img');
    var categoryEl = tile.querySelector('a[href*="categoryName"]');
    var timeEl = tile.querySelector('time');
    
    if (!titleEl) continue;
    
    var href = titleEl.getAttribute('href') || '';
    var modIdMatch = href.match(new RegExp('mods/(\\\\d+)'));
    var modId = modIdMatch ? modIdMatch[1] : 'unknown';
    
    var name = titleEl.textContent.trim();
    var author = authorEl ? authorEl.textContent.trim() : 'Unknown';
    var category = categoryEl ? categoryEl.textContent.trim() : 'Unknown';
    var uploadTime = timeEl ? timeEl.textContent.trim() : 'Unknown';
    var uploadDate = timeEl ? timeEl.getAttribute('datetime') : 'Unknown';
    var thumbnail = imgEl ? imgEl.src : null;
    
    // 从文本行提取下载数、点赞数、描述和成人内容标志
    var allText = tile.innerText.split(String.fromCharCode(10));
    var endorsements = 'N/A';
    var downloads = 'N/A';
    var fileSize = 'N/A';
    var description = '';
    var isAdult = false;
    
    for (var j = 0; j < allText.length; j++) {
      var text = allText[j].trim();
      
      // 检测成人内容标志
      if (text === 'Adult' || text.includes('Adult')) {
        // 排除 false positive（如 "Adult" 是作者名或标题的一部分）
        // 检查是否紧跟在分类后面
        if (text === 'Adult' || text.endsWith('Adult')) {
          isAdult = true;
        }
        continue;
      }
      
      // 提取点赞数
      if (text === 'Endorsements' && j + 1 < allText.length) {
        endorsements = allText[j + 1].trim();
        j++;
        continue;
      }
      
      // 提取下载数
      if (text === 'Downloads' && j + 1 < allText.length) {
        downloads = allText[j + 1].trim();
        j++;
        continue;
      }
      
      // 提取文件大小
      if (text === 'File size' && j + 1 < allText.length) {
        fileSize = allText[j + 1].trim();
        j++;
        continue;
      }
      
      // 提取描述（在日期和 Endorsements 之间的文本）
      if (text && text !== name && text !== author && text !== category && 
          text !== uploadTime && text !== uploadDate && 
          text !== 'Endorsements' && text !== 'Downloads' && text !== 'File size' &&
          text !== 'Updated since last downloaded' && text !== 'Update available' &&
          !text.match(/^\d+$/)) {
        // 检查是否是描述（通常在日期之后，Endorsements 之前）
        if (j > 3 && j < allText.length - 4 && text.length > 10) {
          description = text;
        }
      }
    }
    
    mods.push({
      id: modId,
      name: name,
      author: author,
      category: category,
      uploadTime: uploadTime,
      uploadDate: uploadDate,
      description: description,
      endorsements: endorsements,
      downloads: downloads,
      fileSize: fileSize,
      isAdult: isAdult,
      thumbnail: thumbnail,
      url: href.startsWith('http') ? href : 'https://www.nexusmods.com' + href
    });
  }
  
  return { mods: mods, count: tiles.length };
})()
  `.trim();

  const trendingMods = await client.evaluate(expr);
  return trendingMods && trendingMods.mods ? trendingMods.mods : trendingMods;
}

async function searchMods(client, keyword, options = {}) {
  // Nexus Mods 搜索通过 URL 参数直接实现
  // 参考参数: keyword, sort, timeRange, sortDirection, count, categoryName, tag, excludedTag,
  //           title, description, author, uploader, adultContent
  const params = new URLSearchParams();
  params.set('keyword', keyword);

  // 可选参数
  if (options.sort) params.set('sort', options.sort);
  if (options.timeRange) params.set('timeRange', options.timeRange);
  if (options.sortDirection) params.set('sortDirection', options.sortDirection);
  if (options.count) params.set('count', String(options.count));
  if (options.categoryName) params.set('categoryName', options.categoryName);
  if (options.tag) params.set('tag', options.tag);
  if (options.excludedTag) params.set('excludedTag', options.excludedTag);
  if (options.title) params.set('title', options.title);
  if (options.description) params.set('description', options.description);
  if (options.author) params.set('author', options.author);
  if (options.uploader) params.set('uploader', options.uploader);
  if (options.adultContent !== undefined) params.set('adultContent', String(options.adultContent));

  const searchUrl = `${CONFIG.NEXUS_BASE_URL}/games/${CONFIG.GAME_DOMAIN}/mods?${params.toString()}`;
  await client.navigate(searchUrl);
  await delay(5000); // 等待 Next.js 客户端渲染

  // 使用与 getTrendingMods 相同的提取逻辑
  const expr = `
(function() {
  var mods = [];
  var grid = document.querySelector('.mods-grid');
  if (!grid) return { error: 'mods-grid not found', url: window.location.href, mods: [] };

  var tiles = grid.children;
  for (var i = 0; i < tiles.length; i++) {
    var tile = tiles[i];

    var titleEl = tile.querySelector('[data-e2eid="mod-tile-title"]');
    var authorEl = tile.querySelector('[data-e2eid="user-link"]');
    var imgEl = tile.querySelector('img');
    var categoryEl = tile.querySelector('a[href*="categoryName"]');
    var timeEl = tile.querySelector('time');

    if (!titleEl) continue;

    var href = titleEl.getAttribute('href') || '';
    var modIdMatch = href.match(new RegExp('mods/(\\\\d+)'));
    var modId = modIdMatch ? modIdMatch[1] : 'unknown';

    var name = titleEl.textContent.trim();
    var author = authorEl ? authorEl.textContent.trim() : 'Unknown';
    var category = categoryEl ? categoryEl.textContent.trim() : 'Unknown';
    var uploadTime = timeEl ? timeEl.textContent.trim() : 'Unknown';
    var uploadDate = timeEl ? timeEl.getAttribute('datetime') : 'Unknown';
    var thumbnail = imgEl ? imgEl.src : null;

    var allText = tile.innerText.split(String.fromCharCode(10));
    var endorsements = 'N/A';
    var downloads = 'N/A';
    var fileSize = 'N/A';
    var description = '';
    var isAdult = false;

    for (var j = 0; j < allText.length; j++) {
      var text = allText[j].trim();

      if (text === 'Adult' || text.includes('Adult')) {
        if (text === 'Adult' || text.endsWith('Adult')) {
          isAdult = true;
        }
        continue;
      }

      if (text === 'Endorsements' && j + 1 < allText.length) {
        endorsements = allText[j + 1].trim();
        j++;
        continue;
      }

      if (text === 'Downloads' && j + 1 < allText.length) {
        downloads = allText[j + 1].trim();
        j++;
        continue;
      }

      if (text === 'File size' && j + 1 < allText.length) {
        fileSize = allText[j + 1].trim();
        j++;
        continue;
      }

      if (text && text !== name && text !== author && text !== category &&
          text !== uploadTime && text !== uploadDate &&
          text !== 'Endorsements' && text !== 'Downloads' && text !== 'File size' &&
          text !== 'Updated since last downloaded' && text !== 'Update available' &&
          !text.match(/^\d+$/)) {
        if (j > 3 && j < allText.length - 4 && text.length > 10) {
          description = text;
        }
      }
    }

    mods.push({
      id: modId,
      name: name,
      author: author,
      category: category,
      uploadTime: uploadTime,
      uploadDate: uploadDate,
      description: description,
      endorsements: endorsements,
      downloads: downloads,
      fileSize: fileSize,
      isAdult: isAdult,
      thumbnail: thumbnail,
      url: href.startsWith('http') ? href : 'https://www.nexusmods.com' + href
    });
  }

  return { mods: mods, count: tiles.length, url: window.location.href };
})()
  `.trim();

  const searchResult = await client.evaluate(expr);
  return searchResult && searchResult.mods ? searchResult : { mods: [], error: '提取失败' };
}

async function getModDetails(client, modId) {
  const url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}`;
  await client.navigate(url);
  await humanDelay(1500, 2500);

  return client.evaluate(`
(function() {
  var pageTitle = document.querySelector('h1');
  pageTitle = pageTitle ? pageTitle.textContent.trim() : 'Unknown';
  
  var allText = document.body.innerText.split(String.fromCharCode(10));
  var version = 'Unknown';
  var uploaded = 'Unknown';
  var updated = 'Unknown';
  var author = 'Unknown';
  var uploader = 'Unknown';
  var endorsements = 'N/A';
  var uniqueDls = 'N/A';
  var totalDls = 'N/A';
  var totalViews = 'N/A';
  var summary = '';
  var isDownloaded = false;
  var lastDownloaded = null;
  
  // 检查下载历史
  var modhistory = document.querySelector('.modhistory');
  if (modhistory) {
    var historyText = modhistory.textContent.trim();
    var match = historyText.match(/You last downloaded a file from this mod on (.+)/);
    if (match) {
      isDownloaded = true;
      lastDownloaded = match[1];
    }
  }
  
  for (var i = 0; i < allText.length; i++) {
    var text = allText[i].trim();
    
    if (text === 'Version' && i + 1 < allText.length) {
      version = allText[i + 1].trim();
    }
    if (text === 'Original upload' && i + 1 < allText.length) {
      uploaded = allText[i + 1].trim();
    }
    if (text === 'Last updated' && i + 1 < allText.length) {
      updated = allText[i + 1].trim();
    }
    if (text === 'Created by' && i + 1 < allText.length) {
      author = allText[i + 1].trim();
    }
    if (text === 'Uploaded by' && i + 1 < allText.length) {
      uploader = allText[i + 1].trim();
    }
    if (text === 'Endorsements' && i + 1 < allText.length) {
      endorsements = allText[i + 1].trim();
    }
    if (text === 'Unique DLs' && i + 1 < allText.length) {
      uniqueDls = allText[i + 1].trim();
    }
    if (text === 'Total DLs' && i + 1 < allText.length) {
      totalDls = allText[i + 1].trim();
    }
    if (text === 'Total views' && i + 1 < allText.length) {
      totalViews = allText[i + 1].trim();
    }
  }
  
  // 查找描述摘要
  var descEl = document.querySelector('[data-e2eid="mod-description"], .mod-description');
  if (!descEl) {
    // 尝试从 About this mod 区域提取 - 找第一个有意义的 P 标签
    var headings = document.querySelectorAll('h2');
    for (var j = 0; j < headings.length; j++) {
      if (headings[j].textContent.includes('About this mod')) {
        var container = headings[j].parentElement;
        if (container) {
          var paragraphs = container.querySelectorAll('p');
          for (var k = 0; k < paragraphs.length; k++) {
            var pText = paragraphs[k].textContent.trim();
            if (pText.length > 10 && !pText.includes('last downloaded') && !pText.includes('You last')) {
              summary = pText;
              break;
            }
          }
        }
        break;
      }
    }
  } else {
    summary = descEl.textContent.trim();
  }
  
  return { 
    pageTitle, 
    version, 
    uploaded, 
    updated,
    author, 
    uploader,
    endorsements,
    uniqueDls,
    totalDls,
    totalViews,
    summary: summary.substring(0, 1000),
    isDownloaded,
    lastDownloaded
  };
})()
  `).then(details => ({ modId, url, ...details }));
}

async function trackMod(client, modId, action = 'toggle') {
  const url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}`;
  await client.navigate(url);
  await humanDelay(1500, 2500);

  const result = { status: null, clicked: false };

  // 启用 Input 域
  await client.send('Input.enable').catch(() => {});

  // Track 按钮:
  // 可见的按钮在 <li id="action-untrack-{gameId}-{modId}"> 中，文本 "Tracking" (已追踪)
  // 或 <li id="action-track-{gameId}-{modId}"> 中，文本 "Track" (未追踪)
  const trackResult = await client.evaluate(`
(function() {
  // 查找已追踪的可见按钮
  var trackedBtn = document.querySelector('li[id^="action-untrack-"] a.toggle-track-mod');
  if (trackedBtn) {
    var visible = window.getComputedStyle(trackedBtn.parentElement).display !== 'none';
    if (visible) return 'already_Tracking';
  }
  // 查找未追踪的可见按钮
  var trackBtn = document.querySelector('li[id^="action-track-"] a.toggle-track-mod');
  if (trackBtn) {
    var visible = window.getComputedStyle(trackBtn.parentElement).display !== 'none';
    if (visible) {
      trackBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
      return 'ready_to_click';
    }
  }
  return 'not_found';
})()
  `);
  
  if (trackResult === 'ready_to_click') {
    const trackRect = await client.evaluate(`
(function() {
  var btn = document.querySelector('li[id^="action-track-"] a.toggle-track-mod');
  var rect = btn.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()
    `);
    if (trackRect) {
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: trackRect.x, y: trackRect.y, button: 'left', clickCount: 1 });
      await delay(100);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: trackRect.x, y: trackRect.y, button: 'left', clickCount: 1 });
      await delay(2000);
    }
    result.status = 'clicked';
    result.clicked = true;
  } else if (trackResult === 'already_Tracking' && action === 'toggle') {
    // 取消追踪
    const trackRect = await client.evaluate(`
(function() {
  var btn = document.querySelector('li[id^="action-untrack-"] a.toggle-track-mod');
  var rect = btn.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()
    `);
    if (trackRect) {
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: trackRect.x, y: trackRect.y, button: 'left', clickCount: 1 });
      await delay(100);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: trackRect.x, y: trackRect.y, button: 'left', clickCount: 1 });
      await delay(2000);
    }
    result.status = 'clicked_untrack';
    result.clicked = true;
  } else {
    result.status = trackResult;
  }

  // 刷新页面验证状态
  if (result.clicked) {
    await client.navigate(url);
    await delay(3000);
    
    const verifyStatus = await client.evaluate(`
(function() {
  var trackedBtn = document.querySelector('li[id^="action-untrack-"] a.toggle-track-mod');
  if (trackedBtn) {
    var visible = window.getComputedStyle(trackedBtn.parentElement).display !== 'none';
    return visible ? 'Tracking' : 'Track';
  }
  return 'not_found';
})()
    `);
    
    result.verifyStatus = verifyStatus;
  }

  return result;
}

async function endorseMod(client, modId, action = 'toggle') {
  const url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}`;
  await client.navigate(url);
  await humanDelay(1500, 2500);

  const result = { status: null, clicked: false };

  // 启用 Input 域
  await client.send('Input.enable').catch(() => {});

  // Endorse 按钮:
  // 可见的按钮在 <li id="action-unendorse-{gameId}-{modId}"> 中，文本 "Endorsed" (已点赞)
  // 或 <li id="action-endorse-{gameId}-{modId}"> 中，文本 "Endorse" (未点赞)
  const endorseResult = await client.evaluate(`
(function() {
  // 查找已点赞的可见按钮
  var endorsedBtn = document.querySelector('li[id^="action-unendorse-"] a.endorse-mod');
  if (endorsedBtn) {
    var visible = window.getComputedStyle(endorsedBtn.parentElement).display !== 'none';
    if (visible) return 'already_Endorsed';
  }
  // 查找未点赞的可见按钮
  var endorseBtn = document.querySelector('li[id^="action-endorse-"] a.endorse-mod');
  if (endorseBtn) {
    var visible = window.getComputedStyle(endorseBtn.parentElement).display !== 'none';
    if (visible) return 'ready_to_click';
  }
  return 'not_found';
})()
  `);
  
  if (endorseResult === 'ready_to_click') {
    const endorseRect = await client.evaluate(`
(function() {
  var btn = document.querySelector('li[id^="action-endorse-"] a.endorse-mod');
  var rect = btn.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()
    `);
    if (endorseRect) {
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: endorseRect.x, y: endorseRect.y, button: 'left', clickCount: 1 });
      await delay(100);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endorseRect.x, y: endorseRect.y, button: 'left', clickCount: 1 });
      await delay(2000);
    }
    result.status = 'clicked';
    result.clicked = true;
  } else if (endorseResult === 'already_Endorsed' && action === 'toggle') {
    // 取消点赞
    const endorseRect = await client.evaluate(`
(function() {
  var btn = document.querySelector('li[id^="action-unendorse-"] a.endorse-mod');
  var rect = btn.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()
    `);
    if (endorseRect) {
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: endorseRect.x, y: endorseRect.y, button: 'left', clickCount: 1 });
      await delay(100);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endorseRect.x, y: endorseRect.y, button: 'left', clickCount: 1 });
      await delay(2000);
    }
    result.status = 'clicked_unendorse';
    result.clicked = true;
  } else {
    result.status = endorseResult;
  }

  // 刷新页面验证状态
  if (result.clicked) {
    await client.navigate(url);
    await delay(3000);
    
    const verifyStatus = await client.evaluate(`
(function() {
  var endorsedBtn = document.querySelector('li[id^="action-unendorse-"] a.endorse-mod');
  if (endorsedBtn) {
    var visible = window.getComputedStyle(endorsedBtn.parentElement).display !== 'none';
    return visible ? 'Endorsed' : 'Endorse';
  }
  return 'not_found';
})()
    `);
    
    result.verifyStatus = verifyStatus;
  }

  return result;
}

async function voteMod(client, modId, action = 'toggle') {
  const url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}`;
  await client.navigate(url);
  await humanDelay(1500, 2500);

  const result = { status: null, clicked: false };

  // 启用 Input 域
  await client.send('Input.enable').catch(() => {});

  // Vote 按钮:
  // 可见的按钮在 <li id="action-novote-{gameId}-{modId}"> 中，文本 "Voted" (已投票)
  // 或 <li id="action-vote-{gameId}-{modId}"> 中，文本 "Vote" (未投票)
  const voteResult = await client.evaluate(`
(function() {
  // 查找已投票的可见按钮
  var votedBtn = document.querySelector('li[id^="action-novote-"] a.vote-mod');
  if (votedBtn) {
    var visible = window.getComputedStyle(votedBtn.parentElement).display !== 'none';
    if (visible) return 'already_Voted';
  }
  // 查找未投票的可见按钮
  var voteBtn = document.querySelector('li[id^="action-vote-"] a.vote-mod');
  if (voteBtn) {
    var visible = window.getComputedStyle(voteBtn.parentElement).display !== 'none';
    if (visible) return 'ready_to_click';
  }
  return 'not_found';
})()
  `);
  
  if (voteResult === 'ready_to_click') {
    const voteRect = await client.evaluate(`
(function() {
  var btn = document.querySelector('li[id^="action-vote-"] a.vote-mod');
  var rect = btn.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()
    `);
    if (voteRect) {
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: voteRect.x, y: voteRect.y, button: 'left', clickCount: 1 });
      await delay(100);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: voteRect.x, y: voteRect.y, button: 'left', clickCount: 1 });
      await delay(2000);
    }
    result.status = 'clicked';
    result.clicked = true;
  } else if (voteResult === 'already_Voted' && action === 'toggle') {
    // 取消投票
    const voteRect = await client.evaluate(`
(function() {
  var btn = document.querySelector('li[id^="action-novote-"] a.vote-mod');
  var rect = btn.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()
    `);
    if (voteRect) {
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: voteRect.x, y: voteRect.y, button: 'left', clickCount: 1 });
      await delay(100);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: voteRect.x, y: voteRect.y, button: 'left', clickCount: 1 });
      await delay(2000);
    }
    result.status = 'clicked_unvote';
    result.clicked = true;
  } else {
    result.status = voteResult;
  }

  // 刷新页面验证状态
  if (result.clicked) {
    await client.navigate(url);
    await delay(3000);
    
    const verifyStatus = await client.evaluate(`
(function() {
  var votedBtn = document.querySelector('li[id^="action-novote-"] a.vote-mod');
  if (votedBtn) {
    var visible = window.getComputedStyle(votedBtn.parentElement).display !== 'none';
    return visible ? 'Voted' : 'Vote';
  }
  return 'not_found';
})()
    `);
    
    result.verifyStatus = verifyStatus;
  }

  return result;
}

// 保持向后兼容的 trackAndEndorse 函数
async function trackAndEndorse(client, modId, action = 'toggle') {
  const results = { tracked: false, endorsed: false, voted: false, trackStatus: null, endorseStatus: null, voteStatus: null };
  
  // Track
  const trackResult = await trackMod(client, modId, action);
  results.trackStatus = trackResult.status;
  results.tracked = trackResult.clicked && trackResult.status === 'clicked';
  if (trackResult.verifyStatus) results.verifyStatus = { track: trackResult.verifyStatus };
  
  // Endorse
  const endorseResult = await endorseMod(client, modId, action);
  results.endorseStatus = endorseResult.status;
  results.endorsed = endorseResult.clicked && endorseResult.status === 'clicked';
  if (endorseResult.verifyStatus) {
    if (!results.verifyStatus) results.verifyStatus = {};
    results.verifyStatus.endorse = endorseResult.verifyStatus;
  }
  
  // Vote
  const voteResult = await voteMod(client, modId, action);
  results.voteStatus = voteResult.status;
  results.voted = voteResult.clicked && voteResult.status === 'clicked';
  if (voteResult.verifyStatus) {
    if (!results.verifyStatus) results.verifyStatus = {};
    results.verifyStatus.vote = voteResult.verifyStatus;
  }
  
  return results;
}

async function getTags(client, modId) {
  const url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}`;
  await client.navigate(url);
  await humanDelay(1500, 2500);

  return client.evaluate(`
    (function() {
      var tags = Array.from(document.querySelectorAll('ul.tags li a')).map(function(tag) {
        var labelEl = tag.querySelector('.flex-label');
        var name = labelEl ? labelEl.textContent.trim() : tag.textContent.trim();
        var href = tag.getAttribute('href') || '';
        return {
          name: name,
          url: href.startsWith('http') ? href : 'https://www.nexusmods.com' + href
        };
      }).filter(function(item) { return item.name; });
      return { tags: tags };
    })()
  `);
}

async function getGallery(client, modId) {
  const url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}`;
  await client.navigate(url);
  await humanDelay(1500, 2500);

  return client.evaluate(`
    (function() {
      var gallery = Array.from(document.querySelectorAll('ul.thumbgallery li.thumb')).map(function(li) {
        var fullUrl = li.getAttribute('data-src');
        var thumbUrl = li.getAttribute('data-exthumbimage');
        var img = li.querySelector('img');
        return {
          type: 'image',
          url: fullUrl || (img ? img.src : null),
          thumbnail: thumbUrl || (img ? img.src : null)
        };
      }).filter(function(item) { return item.url; });
      
      var videos = Array.from(document.querySelectorAll('.gallery-video, iframe[src*="youtube"]'))
        .map(function(vid) { return { type: 'video', url: vid.src || vid.dataset.src }; });
      
      return { gallery: gallery.concat(videos) };
    })()
  `);
}

function extractSections(text) {
  const sections = {};
  const keywords = {
    features: ['Features', '功能', 'What this mod does', 'Overview'],
    compatibility: ['Compatibility', '兼容', 'Compatible', 'Requirements'],
    translation: ['Translation', '翻译', 'Localisation', 'Localization'],
    permissions: ['Permissions', '权限', 'Credits', 'License'],
    changelog: ['Changelog', '更改日志', 'Version History', 'Updates'],
    dependencies: ['Dependencies', '依赖', 'Required', 'Prerequisites'],
    usedBy: ['Mods using this mod', 'Used by', '被使用', 'Mods requiring this']
  };
  for (const [key, terms] of Object.entries(keywords)) {
    for (const term of terms) {
      // 使用多行模式，匹配标题及其后续内容，直到遇到下一个大标题或空行
      const regex = new RegExp('(' + term + ')[\\s\\S]*?(?=(?:[A-Z][a-zA-Z\\s]{2,50}\n|Permissions|Compatibility|Changelog|Translations|Description|Features|Dependencies|Requirements|Credits|License|Updates|Version History|Mods using this mod|Used by|Mods requiring this|$))', 'i');
      const match = text.match(regex);
      if (match) { sections[key] = match[0].substring(0, 1500).trim(); break; }
    }
  }
  return sections;
}

async function summarizeDescription(client, modId) {
  const url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}`;
  await client.navigate(url);
  await humanDelay(1500, 2500);

  // 点击 Description tab
  await client.evaluate(`
    (function() {
      var tab = document.querySelector('a[href="#description"], [data-tab="description"], .tab-description');
      if (tab) tab.click();
    })()
  `);
  await humanDelay(1000, 2000);

  // 等待 Description tab 内容区域渲染完成
  await client.evaluate(`
    (function() {
      var maxWait = 10000;
      var start = Date.now();
      while (Date.now() - start < maxWait) {
        var content = document.querySelector('div.tabcontent.tabcontent-mod-page[aria-live="assertive"][role="status"]');
        if (content && content.innerText.trim().length > 50) return true;
      }
      return false;
    })()
  `);
  await humanDelay(500, 1000);

  const description = await client.evaluate(`
    (function() {
      var content = document.querySelector('div.tabcontent.tabcontent-mod-page[aria-live="assertive"][role="status"]');
      if (content && content.innerText.trim().length > 0) {
        return content.innerText;
      }
      var fallback = document.querySelector('#description, .tab-description, .mod-description');
      return fallback ? fallback.innerText : document.body.innerText;
    })()
  `);

  // 提取 dl.accordion 所有章节详情
  const accordionDetails = await client.evaluate(`
    (function() {
      var result = {};
      var accordion = document.querySelector('dl.accordion');
      if (!accordion) return result;
      
      var dts = accordion.querySelectorAll('dt');
      for (var i = 0; i < dts.length; i++) {
        var dt = dts[i];
        var dd = dt.nextElementSibling;
        if (!dd || dd.tagName !== 'DD') continue;
        
        var headingText = dt.textContent.trim();
        // 标准化章节名称
        var sectionKey = headingText;
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
        
        // 提取表格数据
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
                  var modIdMatch = modUrl ? modUrl.match(new RegExp('mods/(\\\\d+)')) : null;
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
        
        // 提取 main-file-requirements 自定义元素的依赖数据
        var reqEl = dd.querySelector('main-file-requirements');
        if (reqEl) {
          var downloadLinks = reqEl.getAttribute('download-links');
          if (downloadLinks) {
            try {
              var parsed = JSON.parse(downloadLinks);
              result[sectionKey].requirements = parsed;
            } catch (e) {
              result[sectionKey].requirementsRaw = downloadLinks.substring(0, 2000);
            }
          }
        }
        
        // 提取列表数据
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
    })()
  `);

  // 对于懒加载的 "Mods using this mod"，通过 API 获取数据
  let usedByList = [];
  try {
    const gameId = await client.evaluate(`
      (function() {
        var match = window.location.href.match(new RegExp('/games/(\\\\d+)'));
        if (match) return match[1];
        // 尝试从页面 meta 或脚本中获取 gameId
        var scripts = document.querySelectorAll('script');
        for (var i = 0; i < scripts.length; i++) {
          var text = scripts[i].textContent;
          var gameMatch = text.match(new RegExp('gameId["\\'']?\\\\s*[:=]\\\\s*(\\\\d+)'));
          if (gameMatch) return gameMatch[1];
        }
        return '1704'; // Skyrim SE default
      })()
    `);
    
    const apiUrl = `${CONFIG.NEXUS_BASE_URL}/api/games/${gameId}/mods/${modId}/required-by?show_adult_content=1`;
    await client.navigate(apiUrl);
    await delay(3000);
    
    const apiText = await client.evaluate(`
      (function() {
        var text = document.body.innerText;
        var lines = text.split(String.fromCharCode(10)).filter(function(l) { return l.trim(); });
        var result = [];
        var inTable = false;
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line === 'Mod name' || line === 'Notes' || line === 'SEARCH') {
            inTable = true;
            continue;
          }
          if (inTable && line && line !== '\t') {
            var parts = line.split('\t');
            if (parts.length >= 1 && parts[0]) {
              result.push({
                name: parts[0].trim(),
                notes: parts[1] ? parts[1].trim() : ''
              });
            }
          }
        }
        return result;
      })()
    `);
    
    usedByList = apiText || [];
  } catch (e) {
    console.warn('获取 usedByList 失败:', e.message);
  }
  
  // 返回 MOD 详情页
  await client.navigate(url);
  await delay(3000);

  return { modId, rawText: description.substring(0, 10000), sections: extractSections(description), accordion: accordionDetails, usedByList };
}

async function getFilesTab(client, modId) {
  const url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}?tab=files`;
  await client.navigate(url);
  await humanDelay(2000, 3500);

  // 点击 Files tab
  await client.evaluate(`
    (function() {
      var tab = document.querySelector('a[href="#files"], [data-tab="files"], .tab-files, a[href="#mod_files"]');
      if (tab) {
        tab.click();
        return true;
      }
      // 如果找不到 tab 链接，尝试直接显示 #mod_files 容器
      var filesContainer = document.getElementById('mod_files');
      if (filesContainer) {
        filesContainer.style.display = 'block';
        return true;
      }
      return false;
    })()
  `);
  await humanDelay(1500, 2500);

  // 等待文件列表区域渲染
  await client.evaluate(`
    (function() {
      var maxWait = 8000;
      var start = Date.now();
      while (Date.now() - start < maxWait) {
        var container = document.getElementById('mod_files');
        if (container && container.style.display !== 'none') {
          var expanders = container.querySelectorAll('dt.file-expander-header');
          if (expanders.length > 0) return true;
        }
      }
      return false;
    })()
  `);
  await humanDelay(500, 1000);

  // 提取文件列表 — 适配 Nexus Mods Files TAB 的 dl/dt/dd accordion 结构
  const files = await client.evaluate(`
    (function() {
      var container = document.getElementById('mod_files');
      if (!container) return { error: 'mod_files container not found', files: [] };

      var result = {
        mainFiles: [],
        optionalFiles: [],
        oldFiles: []
      };

      function extractFiles(fileContainer) {
        var files = [];
        var expanders = fileContainer.querySelectorAll('dt.file-expander-header');

        for (var i = 0; i < expanders.length; i++) {
          var dt = expanders[i];
          var fileId = dt.getAttribute('data-id') || dt.id.replace('file-expander-header-', '');
          var fileName = dt.getAttribute('data-name') || '';
          var fileSize = dt.getAttribute('data-size') || '';
          var fileVersion = dt.getAttribute('data-version') || '';
          var fileDate = dt.getAttribute('data-date') || '';
          var dependenciesCount = dt.getAttribute('data-dependencies-count') || '0';

          // Fallback: get name from <p> tag inside DT
          if (!fileName) {
            var pEl = dt.querySelector('p');
            if (pEl) fileName = pEl.textContent.trim();
          }

          // Get DD sibling
          var dd = dt.nextElementSibling;
          if (!dd || dd.tagName !== 'DD') continue;

          // Extract stats from DT's ul.stats
          var stats = dt.querySelector('ul.stats');
          var uploaded = 'N/A';
          var downloaded = 'N/A';
          var totalDownloads = 'N/A';
          var uniqueDownloads = 'N/A';

          if (stats) {
            var statItems = stats.querySelectorAll('li');
            for (var j = 0; j < statItems.length; j++) {
              var item = statItems[j];
              var text = item.textContent.trim();
              if (item.classList.contains('stat-uploaddate')) {
                var timeEl = item.querySelector('time');
                uploaded = timeEl ? timeEl.textContent.trim() : text;
              }
              else if (item.classList.contains('stat-downloaded')) {
                var timeEl = item.querySelector('time');
                downloaded = timeEl ? timeEl.textContent.trim() : text;
              }
              else if (item.classList.contains('stat-unique-dls')) {
                uniqueDownloads = text;
              }
              else if (item.classList.contains('stat-total-dls')) {
                totalDownloads = text;
              }
            }
          }

          // Extract description from DD
          var descEl = dd.querySelector('.files-description');
          var description = descEl ? descEl.textContent.trim() : '';

          // Check for download-modal custom element
          var downloadModal = dd.querySelector('download-modal');
          var hasModManager = false;
          var hasManual = false;
          var downloadLinks = null;
          var fileUid = null;
          var isPremium = false;

          if (downloadModal) {
            hasModManager = downloadModal.getAttribute('show-vortex-button') === 'true';
            isPremium = downloadModal.getAttribute('is-premium') === 'true';
            fileUid = downloadModal.getAttribute('file-uid') || '';
            var linksAttr = downloadModal.getAttribute('download-links');
            if (linksAttr) {
              try {
                downloadLinks = JSON.parse(linksAttr);
              } catch (e) {
                downloadLinks = linksAttr.substring(0, 500);
              }
            }
            // Manual download is always available if download-modal exists
            hasManual = true;
          }

          // Check for preview link
          var hasPreview = !!dd.querySelector('a[href*="preview"], .preview-link');

          // Check if user has downloaded this file (cloud_download icon)
          var isDownloaded = !!dt.querySelector('i.material-icons[title*="downloaded"]');

          files.push({
            id: fileId,
            name: fileName,
            version: fileVersion,
            size: fileSize,
            date: fileDate,
            uploaded: uploaded,
            downloaded: downloaded,
            uniqueDownloads: uniqueDownloads,
            totalDownloads: totalDownloads,
            dependenciesCount: dependenciesCount,
            description: description,
            hasModManager: hasModManager,
            hasManual: hasManual,
            hasPreview: hasPreview,
            isDownloaded: isDownloaded,
            isPremium: isPremium,
            fileUid: fileUid,
            downloadLinks: downloadLinks
          });
        }

        return files;
      }

      var mainContainer = document.getElementById('file-container-main-files');
      if (mainContainer) result.mainFiles = extractFiles(mainContainer);

      var optionalContainer = document.getElementById('file-container-optional-files');
      if (optionalContainer) result.optionalFiles = extractFiles(optionalContainer);

      var oldContainer = document.getElementById('file-container-old-files');
      if (oldContainer) result.oldFiles = extractFiles(oldContainer);

      return result;
    })()
  `);

  // 尝试点击第一个文件的 "Preview file contents" 链接
  let preview = null;
  const hasPreviewLink = await client.evaluate(`
    (function() {
      var container = document.getElementById('mod_files');
      if (!container) return false;
      var link = container.querySelector('a[href*="preview"], .preview-link');
      return !!link;
    })()
  `);

  if (hasPreviewLink) {
    await client.evaluate(`
      (function() {
        var container = document.getElementById('mod_files');
        var link = container.querySelector('a[href*="preview"], .preview-link');
        if (link) {
          link.scrollIntoView({ behavior: 'instant', block: 'center' });
          link.click();
        }
      })()
    `);
    await humanDelay(2000, 3000);

    preview = await client.evaluate(`
      (function() {
        var content = document.querySelector('.preview-content, .file-preview, pre, .file-tree, .preview-modal, .modal-body');
        if (content) return content.textContent.substring(0, 5000);

        var iframe = document.querySelector('iframe[src*="preview"]');
        if (iframe && iframe.contentDocument) {
          return iframe.contentDocument.body.innerText.substring(0, 5000);
        }

        return null;
      })()
    `);
  }

  return { files, preview };
}

async function searchPosts(client, modId, keyword = '', page = 1) {
  // 始终先导航到 posts tab（不带 page 参数）
  var url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}?tab=posts`;
  await client.navigate(url);
  await humanDelay(2000, 3500);

  // 等待 Posts tab 内容区域渲染
  await client.evaluate(`
    (function() {
      var maxWait = 10000;
      var start = Date.now();
      while (Date.now() - start < maxWait) {
        var container = document.getElementById('comment-container');
        if (container) {
          var comments = container.querySelectorAll('li.comment');
          if (comments.length > 0) return true;
        }
        var ol = document.querySelector('ol.comment-list, ol.comments');
        if (ol && ol.querySelectorAll('li').length > 0) return true;
      }
      return false;
    })()
  `);

  // 翻页: 使用 RH_CommentContainer.Send() AJAX（URL page 参数不生效）
  if (page > 1) {
    var pageResult = await client.evaluate(`
      (function() {
        if (typeof window.RH_CommentContainer !== 'undefined' && window.RH_CommentContainer.Send) {
          window.RH_CommentContainer.Send('page', '${page}');
          return 'sent';
        }
        return 'not_found';
      })()
    `);
    if (pageResult === 'sent') {
      // 等待 AJAX 加载完成
      await delay(3000);
      // 再次等待评论渲染
      await client.evaluate(`
        (function() {
          var maxWait = 10000;
          var start = Date.now();
          while (Date.now() - start < maxWait) {
            var container = document.getElementById('comment-container');
            if (container) {
              var comments = container.querySelectorAll('li.comment');
              if (comments.length > 0) return true;
            }
          }
          return false;
        })()
      `);
    } else {
      console.warn('RH_CommentContainer.Send not available, pagination may not work');
    }
  }

  // 如果有搜索关键词，使用 .comment-search 中的输入框
  if (keyword) {
    const searchInput = await client.evaluate(`
      (function() {
        var input = document.querySelector('.comment-search input, input[type="search"], input[name="search"], .posts-search input, #search-posts');
        if (input) return { found: true, id: input.id || '' };
        return { found: false };
      })()
    `);
    if (searchInput && searchInput.found) {
      await client.send('Input.enable').catch(function(){});
      await client.evaluate(`
        (function() {
          var input = document.querySelector('.comment-search input, input[type="search"], input[name="search"], .posts-search input, #search-posts');
          if (input) { input.focus(); input.value = '${keyword.replace(/'/g, "\\\\'")}'; return true; }
          return false;
        })()
      `);
      await humanDelay(300, 600);
      await client.evaluate(`
        (function() {
          var input = document.querySelector('.comment-search input, input[type="search"], input[name="search"], .posts-search input, #search-posts');
          if (input) {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            var form = input.closest('form');
            if (form) {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            } else {
              var ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
              input.dispatchEvent(ev);
            }
          }
        })()
      `);
      await humanDelay(2000, 3500);
    }
  }

  // 提取评论列表 — 完整字段提取
  const posts = await client.evaluate(`
    (function() {
      var container = document.getElementById('comment-container');
      if (!container) {
        container = document.querySelector('.tabcontent.tabcontent-mod-page[aria-live="assertive"][role="status"]');
      }
      if (!container) return { error: 'comment-container not found', posts: [] };

      var comments = container.querySelectorAll('li.comment');
      if (comments.length === 0) {
        var ol = container.querySelector('ol');
        if (ol) comments = ol.querySelectorAll('li');
      }

      function extractComment(c, skipNested) {
        if (skipNested) {
          var parent = c.parentElement ? c.parentElement.closest('li.comment') : null;
          if (parent) return null;
        }
        var authorEl = c.querySelector('.comment-name a');
        var author = authorEl ? authorEl.textContent.trim() : 'Unknown';
        var profileUrl = authorEl ? authorEl.getAttribute('href') : '';
        if (author === 'Unknown') {
          var uImg = c.querySelector('.comment-user img');
          if (uImg && uImg.getAttribute('title')) author = uImg.getAttribute('title').trim();
        }
        var avatarImg = c.querySelector('.comment-user img');
        var avatarUrl = avatarImg ? avatarImg.getAttribute('src') : '';
        var userStatus = '';
        var stEl = c.querySelector('.status-user, .status-premium');
        if (stEl) userStatus = stEl.textContent.trim();
        var dateEl = c.querySelector('time');
        var date = dateEl ? dateEl.textContent.trim() : 'Unknown';
        var dateAttr = dateEl ? dateEl.getAttribute('data-date') : null;
        var dateFormat = dateEl ? dateEl.getAttribute('data-date-format') : '';
        var content = '';
        var contentEl = c.querySelector('.comment-content-text');
        if (contentEl) {
          content = contentEl.innerHTML.replace(new RegExp('<br\\\\s*\\\\/?>', 'gi'), '\\n').replace(new RegExp('<[^>]+>', 'g'), '').trim();
        } else {
          var cc = c.querySelector('.comment-content');
          if (cc) {
            var cl = cc.cloneNode(true);
            var le = cl.querySelector('.locked'); if (le) le.remove();
            var se = cl.querySelector('.sticky'); if (se) se.remove();
            var te = cl.querySelector('time'); if (te) te.remove();
            content = cl.innerHTML.replace(new RegExp('<br\\\\s*\\\\/?>', 'gi'), '\\n').replace(new RegExp('<[^>]+>', 'g'), '').trim();
          }
        }
        var kudos = '0';
        var dLi = c.querySelectorAll('.comment-details ul li');
        for (var li = 0; li < dLi.length; li++) {
          var lt = dLi[li].textContent.trim();
          if (lt.indexOf('kudos') !== -1 || lt.indexOf('Kudos') !== -1) {
            var km = lt.match(new RegExp('(\\\\d+)\\\\s*kudos', 'i'));
            if (km) kudos = km[1]; break;
          }
        }
        var lEl = c.querySelector('.locked');
        var locked = lEl ? lEl.style.display !== 'none' : false;
        var isSticky = c.classList.contains('comment-sticky');
        var replies = '0';
        var rEl = c.querySelector('.replies-count, .reply-count');
        if (rEl) {
          var rm = rEl.textContent.trim().match(new RegExp('(\\\\d+)'));
          if (rm) replies = rm[1];
        }
        if (replies === '0') {
          var kc = c.querySelector('ol.comment-kids');
          if (kc) {
            var cnt = kc.querySelectorAll('li.comment').length;
            if (cnt > 0) replies = String(cnt);
          }
        }
        var nestedReplies = [];
        var rc = c.querySelector('ol.comment-kids, .comment-replies, .replies, [class*="comment-kid"]');
        if (rc) {
          var ncs = rc.querySelectorAll('li.comment');
          for (var r = 0; r < ncs.length; r++) {
            var nr = extractComment(ncs[r], false);
            if (nr) nestedReplies.push(nr);
          }
        }
        return {
          id: c.id || '', author: author, profileUrl: profileUrl, avatarUrl: avatarUrl,
          userStatus: userStatus, date: date, dateAttr: dateAttr, dateFormat: dateFormat,
          content: content.substring(0, 2000), kudos: kudos, locked: locked,
          isSticky: isSticky, replies: replies, nestedReplies: nestedReplies
        };
      }

      var result = [];
      for (var i = 0; i < comments.length; i++) {
        var item = extractComment(comments[i], true);
        if (item) result.push(item);
      }

      var pagination = [];
      var pl = document.querySelectorAll('.pagination.clearfix a, .pagination a');
      for (var p = 0; p < pl.length; p++) {
        var onclickRaw = (pl[p].getAttribute("onclick") || "");
        var pm = onclickRaw.match(new RegExp("Send\\\\('page',\\\\s*'(\\\\d+)'\\\\)"));
        if (pm && pagination.indexOf(pm[1]) === -1) pagination.push(pm[1]);
        if (!pm) {
          var href = pl[p].getAttribute("href") || "";
          var hm = href.match(new RegExp('[?&]page=(\\\\d+)'));
          if (hm && pagination.indexOf(hm[1]) === -1) pagination.push(hm[1]);
        }
      }

      var kw = '${keyword.replace(/'/g, "\\\\\'")}';
      var pg = '${page}';

      // 关键词过滤（如果搜索框不可用，在 JS 层过滤）
      if (kw) {
        var filtered = [];
        for (var fi = 0; fi < result.length; fi++) {
          var p = result[fi];
          if (p.content.toLowerCase().indexOf(kw.toLowerCase()) !== -1 ||
              p.author.toLowerCase().indexOf(kw.toLowerCase()) !== -1) {
            filtered.push(p);
          }
        }
        result = filtered;
      }

      return { posts: result, count: result.length, keyword: kw, page: pg, pagination: pagination };
    })()
  `);

  return posts && posts.posts ? posts : { posts: [], count: 0, keyword: keyword, page: String(page), pagination: [] };
}

async function searchBugs(client, modId, keyword = '') {
  const url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}?tab=bugs`;
  await client.navigate(url);
  await humanDelay(2000, 3500);

  // 等待 Bugs tab 内容区域渲染
  const bugsReady = await client.evaluate(`
    (function() {
      var maxWait = 10000;
      var start = Date.now();
      while (Date.now() - start < maxWait) {
        var table = document.querySelector('table.bugs-table, .bugs-list, .bug-reports');
        if (table) {
          var rows = table.querySelectorAll('tr[data-bug-id], tr.issue');
          if (rows.length > 0) return true;
        }
        var issues = document.querySelectorAll('[id^="issue_"], .bug-item');
        if (issues.length > 0) return true;
      }
      return false;
    })()
  `);

  // 如果有搜索关键词，尝试使用搜索框
  if (keyword) {
    const searchInput = await client.evaluate(`
      (function() {
        var input = document.querySelector('input[type="search"], input[name="search"], .bugs-search, #search-bugs');
        if (input) return { found: true, selector: input.id ? '#' + input.id : input.className ? '.' + input.className.split(' ')[0] : 'input[type="search"]' };
        return { found: false };
      })()
    `);
    if (searchInput && searchInput.found) {
      await client.type(searchInput.selector, keyword);
      await client.evaluate(`
        (function() {
          var el = document.querySelector('input[type="search"], input[name="search"], .bugs-search, #search-bugs');
          if (el) {
            var ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
            el.dispatchEvent(ev);
          }
        })()
      `);
      await humanDelay(2000, 3500);
    }
  }

  // 提取 BUG 报告列表 — 适配 Nexus Mods Bugs TAB 实际 DOM 结构
  const bugs = await client.evaluate(`
    (function() {
      var result = [];
      var keyword = '` + keyword + `';

      // 方法1: 通过 table 结构提取
      var table = document.querySelector('table.bugs-table, .bugs-list, .bug-reports, #mod_bugs table, .tabcontent-mod-page table');
      if (table) {
        var rows = table.querySelectorAll('tr[data-issue-id], tr.mod-issue-row, tbody tr');
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          // 跳过表头行
          if (row.querySelector('th')) continue;

          var cells = row.querySelectorAll('td');
          if (cells.length < 2) continue;

          var titleCell = cells[0];
          var titleEl = titleCell.querySelector('a.issue-title, a');
          var title = titleEl ? titleEl.textContent.trim() : titleCell.textContent.trim();
          var bugUrl = titleEl ? titleEl.getAttribute('href') : null;
          var bugId = row.getAttribute('data-issue-id') || row.id.replace('issue_', '') || '';

          var status = cells[1] ? cells[1].textContent.trim() : 'Unknown';
          var replies = cells[2] ? cells[2].textContent.trim() : '0';
          var version = cells[3] ? cells[3].textContent.trim() : '';
          var priority = cells[4] ? cells[4].textContent.trim() : '';
          var lastPost = cells[5] ? cells[5].textContent.trim() : '';

          // 如果有搜索关键词，进行过滤
          if (keyword && !title.toLowerCase().includes(keyword.toLowerCase())) continue;

          result.push({
            id: bugId,
            title: title,
            status: status,
            replies: replies,
            version: version,
            priority: priority,
            lastPost: lastPost,
            url: bugUrl && bugUrl !== 'javascript:;' ? (bugUrl.startsWith('http') ? bugUrl : 'https://www.nexusmods.com' + bugUrl) : null
          });
        }
      }

      // 方法2: 通过 issue ID 锚点提取（如果 table 方法失败）
      if (result.length === 0) {
        var issueEls = document.querySelectorAll('[id^="issue_"]');
        for (var j = 0; j < issueEls.length; j++) {
          var issue = issueEls[j];
          var titleEl = issue.querySelector('.bug-title, .title, a');
          var title = titleEl ? titleEl.textContent.trim() : issue.textContent.trim().substring(0, 200);
          var statusEl = issue.querySelector('.status, .bug-status');
          var status = statusEl ? statusEl.textContent.trim() : 'Unknown';

          if (keyword && !title.toLowerCase().includes(keyword.toLowerCase())) continue;

          result.push({
            id: issue.id.replace('issue_', ''),
            title: title,
            status: status,
            replies: '0',
            version: '',
            priority: '',
            lastPost: ''
          });
        }
      }

      return { bugs: result, count: result.length, keyword: keyword };
    })()
  `);

  return bugs && bugs.bugs ? bugs : { bugs: [], count: 0, keyword: keyword };
}

async function bugComments(client, modId) {
  // 先获取 bug 列表，识别有回复的 bug
  const url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}?tab=bugs`;
  await client.navigate(url);
  await humanDelay(2000, 3500);

  // 等待 bugs tab 渲染
  const ready = await client.evaluate(`(function() {
    var maxWait = 10000;
    var start = Date.now();
    while (Date.now() - start < maxWait) {
      var rows = document.querySelectorAll('tr[data-issue-id]');
      if (rows.length > 0) return true;
    }
    return false;
  })()`);

  if (!ready) {
    return { bugs: [], commentCount: 0 };
  }

  // 提取 bug 列表和回复计数
  const bugList = JSON.parse(await client.evaluate(`(function() {
    var result = [];
    var rows = document.querySelectorAll('tr[data-issue-id]');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var id = row.getAttribute('data-issue-id');
      var titleEl = row.querySelector('a.issue-title');
      var title = titleEl ? titleEl.textContent.trim() : '';
      var statusEl = row.querySelector('td.table-bug-status span');
      var status = statusEl ? statusEl.textContent.trim() : '';
      var repliesEl = row.querySelector('td.table-bug-replies');
      var replies = repliesEl ? repliesEl.textContent.trim() : '0';
      result.push({ id: id, title: title, status: status, replies: replies });
    }
    return JSON.stringify(result);
  })()`));

  // 为每个有回复的 bug 加载评论
  for (const bug of bugList) {
    if (parseInt(bug.replies) <= 0) {
      bug.comments = [];
      continue;
    }

    // 调用 loadIssueReplies 加载评论
    await client.evaluate(`(function(){ if(typeof loadIssueReplies === 'function') loadIssueReplies(${bug.id}); })()`);
    await humanDelay(2000, 3500);

    // 提取评论
    const comments = await client.evaluate(`(function() {
      var result = [];
      var mainissue = document.getElementById('mainissue_' + ${bug.id});
      if (!mainissue) return JSON.stringify([]);

      var commentItems = mainissue.querySelectorAll('li.comment');
      for (var i = 0; i < commentItems.length; i++) {
        var li = commentItems[i];
        var authorEl = li.querySelector('.comment-name a');
        var author = authorEl ? authorEl.textContent.trim() : '';
        var profileUrl = authorEl ? authorEl.getAttribute('href') : '';

        var avatarEl = li.querySelector('.comment-user img');
        var avatarUrl = avatarEl ? avatarEl.getAttribute('src') : '';

        var timeEl = li.querySelector('.comment-content time');
        var date = timeEl ? timeEl.textContent.trim() : '';
        var dateAttr = timeEl ? timeEl.getAttribute('datetime') : '';

        var statusEl = li.querySelector('.status-premium, .status-supporter, .status-staff, .status-moderator');
        var userStatus = statusEl ? statusEl.textContent.trim() : 'member';

        var contentEl = li.querySelector('.comment-content');
        var content = '';
        if (contentEl) {
          // 排除 time 标签文本和 reply form
          var clone = contentEl.cloneNode(true);
          var timeNode = clone.querySelector('time');
          if (timeNode) timeNode.remove();
          var replyForm = clone.querySelector('.comment-reply');
          if (replyForm) replyForm.remove();
          content = clone.textContent.trim();
        }

        result.push({
          author: author,
          profileUrl: profileUrl ? (profileUrl.startsWith('http') ? profileUrl : 'https://www.nexusmods.com' + profileUrl) : '',
          avatarUrl: avatarUrl,
          date: date,
          dateAttr: dateAttr,
          userStatus: userStatus,
          content: content ? content.substring(0, 3000) : ''
        });
      }
      return JSON.stringify(result);
    })()`);

    bug.comments = JSON.parse(comments || '[]');
  }

  return { modId: modId, bugs: bugList, commentCount: bugList.length };
}

async function postComment(client, modId, content) {
  // 导航到 posts tab
  const url = `${CONFIG.NEXUS_BASE_URL}/${CONFIG.GAME_DOMAIN}/mods/${modId}?tab=posts`;
  await client.navigate(url);
  await humanDelay(2000, 3500);

  // 等待评论区加载（#add-comment-form-0 出现即表示编辑器已就绪）
  const formReady = await client.evaluate(`
    (function() {
      var maxWait = 10000;
      var start = Date.now();
      while (Date.now() - start < maxWait) {
        var form = document.getElementById('add-comment-form-0');
        if (form && form.style.display !== 'none') return true;
      }
      return false;
    })()
  `);

  if (!formReady) {
    // 尝试点击 add-comment 按钮触发
    await client.evaluate(`document.getElementById('add-comment').click()`);
    await humanDelay(2000, 3500);
  }

  // 在 textarea 和 contenteditable 中填入内容
  const escapedContent = content.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  
  // 直接设置 textarea 值（WYSIWYG 会同步）
  await client.evaluate(`
    (function() {
      var ta = document.getElementById('add-comment-post-0');
      if (ta) {
        ta.value = '${escapedContent}';
        // 触发 input 事件让 WYSIWYG 同步
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    })()
  `);
  await humanDelay(500, 1000);

  // 同时填入 contenteditable（如果存在）
  await client.evaluate(`
    (function() {
      var ce = document.querySelector('#add-comment-form-0 .wysibb-body');
      if (ce) {
        ce.innerHTML = '${escapedContent.replace(new RegExp('\\\\n', 'g'), '<br>')}';
        ce.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      return false;
    })()
  `);
  await humanDelay(300, 600);

  // 点击 Submit
  await client.send('Input.enable').catch(() => {});
  const submitRect = await client.evaluate(`
    (function() {
      var btn = document.getElementById('submit-add-comment-0');
      if (!btn) return null;
      btn.scrollIntoView({ behavior: 'instant', block: 'center' });
      var rect = btn.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `);

  if (!submitRect) {
    return { error: 'Submit button not found', posted: false };
  }

  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: submitRect.x, y: submitRect.y, button: 'left', clickCount: 1 });
  await delay(100);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: submitRect.x, y: submitRect.y, button: 'left', clickCount: 1 });
  
  // 等待提交完成
  await delay(3000);

  // 检查是否成功（查找错误提示）
  const result = await client.evaluate(`
    (function() {
      var errorBox = document.getElementById('add-comment-error-box-0');
      var errorMsg = document.getElementById('add-comment-error-message-0');
      if (errorBox && errorBox.style.display !== 'none') {
        return { posted: false, error: errorMsg ? errorMsg.textContent.trim() : 'Unknown error' };
      }
      // 检查是否有新评论出现（表单可能隐藏了，说明提交成功）
      var form = document.getElementById('add-comment-form-0');
      if (form && form.style.display === 'none') {
        return { posted: true };
      }
      return { posted: true };
    })()
  `);

  return { posted: result.posted, error: result.error, modId, contentPreview: content.substring(0, 100) };
}

// 从 getFilesTab 复用的文件提取辅助函数（提取所有文件含 download-modal 信息）
async function extractAllFiles(client) {
  return client.evaluate(`
(function() {
  var container = document.getElementById('mod_files');
  if (!container) return [];

  function extractFiles(fileContainer) {
    var files = [];
    var expanders = fileContainer.querySelectorAll('dt.file-expander-header');
    for (var i = 0; i < expanders.length; i++) {
      var dt = expanders[i];
      var fileId = dt.getAttribute('data-id') || '';
      var fileName = dt.getAttribute('data-name') || '';
      var fileVersion = dt.getAttribute('data-version') || '';
      var fileSize = dt.getAttribute('data-size') || '';
      var fileDate = dt.getAttribute('data-date') || '';
      var dependenciesCount = dt.getAttribute('data-dependencies-count') || '0';

      if (!fileName) {
        var pEl = dt.querySelector('p');
        if (pEl) fileName = pEl.textContent.trim();
      }

      var dd = dt.nextElementSibling;
      if (!dd || dd.tagName !== 'DD') continue;

      // Stats from DT
      var stats = dt.querySelector('ul.stats');
      var uploaded = 'N/A';
      var downloaded = 'N/A';
      if (stats) {
        var statItems = stats.querySelectorAll('li');
        for (var j = 0; j < statItems.length; j++) {
          var item = statItems[j];
          if (item.classList.contains('stat-uploaddate')) {
            var timeEl = item.querySelector('time');
            uploaded = timeEl ? timeEl.textContent.trim() : item.textContent.trim();
          } else if (item.classList.contains('stat-downloaded')) {
            var timeEl = item.querySelector('time');
            downloaded = timeEl ? timeEl.textContent.trim() : item.textContent.trim();
          }
        }
      }

      // Description from DD
      var descEl = dd.querySelector('.files-description');
      var description = descEl ? descEl.textContent.trim() : '';

      // download-modal parsing (same as getFilesTab)
      var downloadModal = dd.querySelector('download-modal');
      var hasModManager = false;
      var hasManual = false;
      var downloadLinks = null;
      var fileUid = null;
      var isPremium = false;

      if (downloadModal) {
        hasModManager = downloadModal.getAttribute('show-vortex-button') === 'true';
        isPremium = downloadModal.getAttribute('is-premium') === 'true';
        fileUid = downloadModal.getAttribute('file-uid') || '';
        var linksAttr = downloadModal.getAttribute('download-links');
        if (linksAttr) {
          try { downloadLinks = JSON.parse(linksAttr); } catch (e) {}
        }
        hasManual = true;
      }

      files.push({
        id: fileId, name: fileName, version: fileVersion, size: fileSize,
        date: fileDate, dependenciesCount: dependenciesCount,
        uploaded: uploaded, downloaded: downloaded,
        description: description,
        hasModManager: hasModManager, hasManual: hasManual,
        isPremium: isPremium, fileUid: fileUid, downloadLinks: downloadLinks
      });
    }
    return files;
  }

  var allFiles = [];
  var mainContainer = document.getElementById('file-container-main-files');
  if (mainContainer) allFiles = allFiles.concat(extractFiles(mainContainer));
  var optContainer = document.getElementById('file-container-optional-files');
  if (optContainer) allFiles = allFiles.concat(extractFiles(optContainer));
  var oldContainer = document.getElementById('file-container-old-files');
  if (oldContainer) allFiles = allFiles.concat(extractFiles(oldContainer));
  return allFiles;
})()
  `);
}

async function downloadMod(client, modId, fileName, version, downloadType) {
  downloadType = downloadType || 'manual';

  // 直接导航到 Files TAB
  var url = CONFIG.NEXUS_BASE_URL + '/' + CONFIG.GAME_DOMAIN + '/mods/' + modId + '?tab=files';
  await client.navigate(url);
  await humanDelay(2000, 3500);

  // 等待 dt.file-expander-header 渲染
  await client.evaluate(`
(function() {
  var maxWait = 10000;
  var start = Date.now();
  while (Date.now() - start < maxWait) {
    var expanders = document.querySelectorAll('dt.file-expander-header');
    if (expanders.length > 0) return;
  }
})()
  `);

  // 提取完整文件列表（含 download-modal 信息）
  var allFiles = await extractAllFiles(client);

  if (allFiles.length === 0) {
    return { error: 'No files found', files: [] };
  }

  // 匹配文件：按名称 + 版本
  var targetFile = null;
  for (var i = 0; i < allFiles.length; i++) {
    var f = allFiles[i];
    if (f.name === fileName && f.version === version) {
      targetFile = f;
      break;
    }
  }
  if (!targetFile) {
    // 宽松匹配：仅名称匹配
    for (var j = 0; j < allFiles.length; j++) {
      if (allFiles[j].name === fileName) {
        targetFile = allFiles[j];
        break;
      }
    }
  }
  if (!targetFile) {
    return { error: 'File not found: ' + fileName + ' v' + version, availableFiles: allFiles };
  }

  // 检查下载方式是否可用
  var dlAvailable = downloadType === 'modmanager' ? targetFile.hasModManager : targetFile.hasManual;
  if (!dlAvailable) {
    return {
      error: 'Download type ' + downloadType + ' not available for this file',
      file: targetFile,
      availableFiles: allFiles
    };
  }

  // 展开目标文件的 accordion
  await client.evaluate(`
(function() {
  var expanders = document.querySelectorAll('dt.file-expander-header');
  for (var i = 0; i < expanders.length; i++) {
    if (expanders[i].getAttribute('data-id') === '` + targetFile.id + `') {
      expanders[i].click();
      return;
    }
  }
})()
  `);
  await humanDelay(2000, 3000);

  // 查找并点击下载链接 — 使用 element.click() 触发 Magnific Popup
  var linkText = downloadType === 'modmanager' ? 'Mod manager download' : 'Manual download';
  var downloadClicked = await client.evaluate(`
(function() {
  var links = document.querySelectorAll('a');
  for (var i = 0; i < links.length; i++) {
    if (links[i].textContent.trim() === '` + linkText + `' && links[i].offsetParent !== null) {
      links[i].scrollIntoView({ behavior: 'instant', block: 'center' });
      links[i].click();
      return true;
    }
  }
  return false;
})()
  `);

  if (!downloadClicked) {
    return { error: 'Download link not found after expand', file: targetFile, availableFiles: allFiles };
  }

  // 等待下载弹窗出现并检测 Magnific Popup (.mfp-wrap)
  await delay(3000);

  // 在弹窗中检测并点击 Download 按钮
  var popupResult = await client.evaluate(`
(function() {
  var mfpWrap = document.querySelector('.mfp-wrap');
  if (!mfpWrap) return 'no_popup';
  var buttons = mfpWrap.querySelectorAll('a, button');
  for (var i = 0; i < buttons.length; i++) {
    var text = buttons[i].textContent.trim();
    if (text === 'Download' || text === 'Slow download') {
      buttons[i].click();
      return 'clicked_' + text;
    }
  }
  return 'popup_no_dl_button';
})()
  `);

  await humanDelay(3000, 5000);

  // 自动执行 Track + Endorse + Vote（仅正向操作，不 toggle）
  var trackR = await trackMod(client, modId, 'track');
  var endorseR = await endorseMod(client, modId, 'endorse');
  var voteR = await voteMod(client, modId, 'vote');

  return {
    file: { id: targetFile.id, name: targetFile.name, version: targetFile.version },
    availableFiles: allFiles,
    downloadStarted: downloadClicked,
    popupResult: popupResult,
    trackResult: {
      trackStatus: trackR.status,
      endorseStatus: endorseR.status,
      voteStatus: voteR.status
    }
  };
}

async function accessTrackingCentre(client, action, query, page) {
  action = action || 'list';
  query = query || '';
  page = parseInt(page) || 1;

  // Navigate with tab=mods
  var url = CONFIG.NEXUS_BASE_URL + '/' + CONFIG.GAME_DOMAIN + '/mods/trackingcentre?tab=mods';
  await client.navigate(url);
  await humanDelay(2000, 3500);

  // Wait for table
  await client.evaluate(
    "(function() {\n" +
    "  var maxWait = 10000;\n" +
    "  var start = Date.now();\n" +
    "  while (Date.now() - start < maxWait) {\n" +
    "    var rows = document.querySelectorAll('table.mod-tracking-table tbody tr');\n" +
    "    if (rows.length > 0) return;\n" +
    "  }\n" +
    "})()"
  );

  // Pagination via RH_TrackedModsTab
  if (page > 1) {
    await client.evaluate(
      "(function() {\n" +
      "  if (typeof window.RH_TrackedModsTab !== 'undefined' && window.RH_TrackedModsTab.Send) {\n" +
      "    window.RH_TrackedModsTab.Send('page', '" + page + "');\n" +
      "  }\n" +
      "})()"
    );
    await delay(3000);
  }

  // Track/Untrack action
  if (action === 'untrack' && query) {
    // query = modId to untrack
    await client.send('Input.enable').catch(function(){});
    var btnRect = await client.evaluate(
      "(function() {\n" +
      "  var links = document.querySelectorAll('.toggle-track-mod');\n" +
      "  for (var i = 0; i < links.length; i++) {\n" +
      "    if (links[i].getAttribute('data-mod-id') === '" + query + "') {\n" +
      "      if (links[i].getAttribute('data-do-track') === '0') {\n" +
      "        links[i].scrollIntoView({ behavior: 'instant', block: 'center' });\n" +
      "        var rect = links[i].getBoundingClientRect();\n" +
      "        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };\n" +
      "      }\n" +
      "      return null;\n" +
      "    }\n" +
      "  }\n" +
      "  return null;\n" +
      "})()"
    );
    if (btnRect) {
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btnRect.x, y: btnRect.y, button: 'left', clickCount: 1 });
      await delay(100);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btnRect.x, y: btnRect.y, button: 'left', clickCount: 1 });
      await delay(2000);
      // Refresh table
      await client.evaluate(
        "(function() {\n" +
        "  if (typeof window.RH_TrackedModsTab !== 'undefined' && window.RH_TrackedModsTab.Send) {\n" +
        "    window.RH_TrackedModsTab.Send('page', '" + page + "');\n" +
        "  }\n" +
        "})()"
      );
      await delay(3000);
    }
  }

  // Extract table data with client-side keyword filtering
  return client.evaluate(
    "(function() {\n" +
    "  var result = [];\n" +
    "  var pagination = [];\n" +
    "  var table = document.querySelector('table.mod-tracking-table, table.mod-table');\n" +
    "  if (!table) return { mods: [], pagination: [], page: '" + page + "', query: '" + query + "' };\n" +
    "  var rows = table.querySelectorAll('tbody tr');\n" +
    "  var kw = '" + query.replace(/'/g, "\\'") + "'.toLowerCase();\n" +
    "  for (var i = 0; i < rows.length; i++) {\n" +
    "    var cells = rows[i].querySelectorAll('td');\n" +
    "    if (cells.length < 8) continue;\n" +
    "    var nameCell = cells[0];\n" +
    "    var link = nameCell.querySelector('a[href*=\"/mods/\"]');\n" +
    "    var name = link ? link.textContent.trim() : nameCell.textContent.trim().split('\\n')[0].trim();\n" +
    "    var href = link ? link.href : '';\n" +
    "    var id = '';\n" +
    "    if (href) { var m = href.match(/\\/mods\\/(\\d+)/); id = m ? m[1] : ''; }\n" +
    "    if (!name || !id) continue;\n" +
    "    // Client-side keyword filter\n" +
    "    if (kw) {\n" +
    "      var rowText = (name + ' ' + cells[2].textContent + ' ' + cells[3].textContent).toLowerCase();\n" +
    "      if (rowText.indexOf(kw) === -1) continue;\n" +
    "    }\n" +
    "    var trackBtn = cells[8].querySelector('.toggle-track-mod');\n" +
    "    result.push({\n" +
    "      name: name,\n" +
    "      id: id,\n" +
    "      author: cells[2].textContent.trim(),\n" +
    "      category: cells[3].textContent.trim(),\n" +
    "      version: cells[4].textContent.trim(),\n" +
    "      lastUpload: cells[5].textContent.trim(),\n" +
    "      lastDownload: cells[6].textContent.trim(),\n" +
    "      isTracked: trackBtn ? trackBtn.getAttribute('data-do-track') === '0' : false,\n" +
    "      trackingStatus: cells[8].textContent.trim(),\n" +
    "      url: href\n" +
    "    });\n" +
    "  }\n" +
    "  // Pagination info\n" +
    "  var pagLinks = document.querySelectorAll('.pagination a[onclick*=\"Send\"]');\n" +
    "  var currentPage = document.querySelector('.pagination .page-selected');\n" +
    "  for (var p = 0; p < pagLinks.length; p++) {\n" +
    "    var t = pagLinks[p].textContent.trim();\n" +
    "    if (t && !isNaN(parseInt(t))) pagination.push(t);\n" +
    "  }\n" +
    "  return {\n" +
    "    mods: result,\n" +
    "    count: result.length,\n" +
    "    page: currentPage ? currentPage.textContent.trim() : '" + page + "',\n" +
    "    pagination: pagination,\n" +
    "    query: '" + query.replace(/'/g, "\\'") + "'\n" +
    "  };\n" +
    "})()"
  );
}

async function accessDownloadHistory(client, query, page, action) {
  query = query || '';
  page = parseInt(page) || 1;
  action = action || 'list';

  await client.navigate(CONFIG.NEXUS_BASE_URL + '/users/myaccount?tab=download+history');
  await humanDelay(2000, 3500);

  // Wait for DataTable
  await client.evaluate(
    "(function() {\n" +
    "  var maxWait = 10000;\n" +
    "  var start = Date.now();\n" +
    "  while (Date.now() - start < maxWait) {\n" +
    "    var rows = document.querySelectorAll('table.datatable tbody tr');\n" +
    "    if (rows.length > 0) return;\n" +
    "  }\n" +
    "})()"
  );

  // DataTables search
  if (query && action === 'list') {
    await client.evaluate(
      "(function() {\n" +
      "  var input = document.querySelector('input[aria-controls=\"DataTables_Table_0\"]');\n" +
      "  if (input) {\n" +
      "    input.focus();\n" +
      "    input.value = '" + query.replace(/'/g, "\\'") + "';\n" +
      "    input.dispatchEvent(new Event('input', { bubbles: true }));\n" +
      "    input.dispatchEvent(new Event('change', { bubbles: true }));\n" +
      "    var ev = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true });\n" +
      "    input.dispatchEvent(ev);\n" +
      "  }\n" +
      "})()"
    );
    await humanDelay(1500, 2500);
  }

  // DataTables pagination
  if (page > 1) {
    await client.evaluate(
      "(function() {\n" +
      "  var btn = document.querySelector('.paginate_button[data-dt-idx=\"' + page + '\"]');\n" +
      "  if (btn) btn.click();\n" +
      "})()"
    );
    await delay(3000);
  }

  // Endorse/Unendorse action
  if ((action === 'endorse' || action === 'unendorse') && query) {
    // query = modId
    await client.send('Input.enable').catch(function(){});
    var positive = action === 'endorse' ? '1' : '0';
    var btnRect = await client.evaluate(
      "(function() {\n" +
      "  var link = document.querySelector('.endorse-mod[data-mod-id=\"' + query + '\"][data-positive=\"' + positive + '\"]');\n" +
      "  if (link) {\n" +
      "    link.scrollIntoView({ behavior: 'instant', block: 'center' });\n" +
      "    var rect = link.getBoundingClientRect();\n" +
      "    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };\n" +
      "  }\n" +
      "  return null;\n" +
      "})()"
    );
    if (btnRect) {
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btnRect.x, y: btnRect.y, button: 'left', clickCount: 1 });
      await delay(100);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btnRect.x, y: btnRect.y, button: 'left', clickCount: 1 });
      await delay(2000);
      // Refresh
      await client.evaluate(
        "(function() {\n" +
        "  var btn = document.querySelector('.paginate_button[data-dt-idx=\"' + page + '\"]');\n" +
        "  if (btn) btn.click();\n" +
        "})()"
      );
      await delay(3000);
    }
  }

  // Parse download history table
  return client.evaluate(
    "(function() {\n" +
    "  var result = [];\n" +
    "  var table = document.querySelector('table.datatable, #DataTables_Table_0, table.dataTable');\n" +
    "  if (!table) return { mods: [], pagination: {} };\n" +
    "  var rows = table.querySelectorAll('tbody tr');\n" +
    "  for (var i = 0; i < rows.length; i++) {\n" +
    "    var cells = rows[i].querySelectorAll('td');\n" +
    "    if (cells.length < 6) continue;\n" +
    "    var nameCell = cells[0];\n" +
    "    var link = nameCell.querySelector('a[href*=\"/mods/\"]');\n" +
    "    var name = link ? link.textContent.trim() : nameCell.textContent.trim();\n" +
    "    var href = link ? link.href : '';\n" +
    "    var id = '';\n" +
    "    if (href) { var m = href.match(/\\/mods\\/(\\d+)/); id = m ? m[1] : ''; }\n" +
    "    if (!name) continue;\n" +
    "    // Check endorse state from SVG icon class\n" +
    "    var endorseDiv = cells[5].querySelector('[class*=\"endorse\"]');\n" +
    "    var isEndorsed = false;\n" +
    "    if (endorseDiv) {\n" +
    "      var svg = endorseDiv.querySelector('svg');\n" +
    "      if (svg && svg.className && svg.className.baseVal) {\n" +
    "        isEndorsed = svg.className.baseVal.indexOf('endorse-active') !== -1;\n" +
    "      }\n" +
    "    }\n" +
    "    result.push({\n" +
    "      name: name,\n" +
    "      id: id,\n" +
    "      lastDownloaded: cells[1].textContent.trim(),\n" +
    "      uploader: cells[2].textContent.trim(),\n" +
    "      category: cells[3].textContent.trim(),\n" +
    "      updated: cells[4].textContent.trim(),\n" +
    "      isEndorsed: isEndorsed,\n" +
    "      endorsed: cells[5].textContent.trim(),\n" +
    "      url: href\n" +
    "    });\n" +
    "  }\n" +
    "  // Pagination info\n" +
    "  var infoEl = document.querySelector('.dataTables_info');\n" +
    "  var pagDiv = document.querySelector('.dataTables_paginate');\n" +
    "  var pages = [];\n" +
    "  if (pagDiv) {\n" +
    "    var btns = pagDiv.querySelectorAll('.paginate_button[data-dt-idx]');\n" +
    "    for (var p = 0; p < btns.length; p++) {\n" +
    "      var t = btns[p].textContent.trim();\n" +
    "      if (t && !isNaN(parseInt(t))) pages.push(t);\n" +
    "    }\n" +
    "  }\n" +
    "  return {\n" +
    "    mods: result,\n" +
    "    count: result.length,\n" +
    "    pagination: { info: infoEl ? infoEl.textContent.trim() : '', pages: pages, current: '" + page + "' },\n" +
    "    query: '" + query.replace(/'/g, "\\'") + "'\n" +
    "  };\n" +
    "})()"
  );
}

async function getMO2ApiKeys(client) {
  await client.navigate(CONFIG.NEXUS_BASE_URL + '/settings/api-keys');
  await humanDelay(1500, 2500);

  // Find MO2 section and extract API key values
  return client.evaluate(
    "(function() {\n" +
    "  var result = { integrations: [] };\n" +
    "  \n" +
    "  // Find all integration sections with API keys\n" +
    "  // Each app section has a flex-row div with img + text + key\n" +
    "  var sections = document.querySelectorAll('.flex.flex-col.items-center, [class*=\"gap-y-8\"]');\n" +
    "  \n" +
    "  // Alternative: find MO2 by its image alt text\n" +
    "  var imgs = document.querySelectorAll('img');\n" +
    "  for (var i = 0; i < imgs.length; i++) {\n" +
    "    var alt = imgs[i].alt || '';\n" +
    "    if (alt.indexOf('Mod Organizer') !== -1 || alt.indexOf('MO2') !== -1) {\n" +
    "      // Find the parent container that has the input\n" +
    "      var parent = imgs[i];\n" +
    "      for (var p = 0; p < 10; p++) {\n" +
    "        parent = parent.parentElement;\n" +
    "        if (!parent) break;\n" +
    "        var inputs = parent.querySelectorAll('input[type=\"text\"]');\n" +
    "        if (inputs.length > 0) {\n" +
    "          result.mo2 = { name: alt };\n" +
    "          result.mo2.keys = [];\n" +
    "          for (var k = 0; k < inputs.length; k++) {\n" +
    "            var inp = inputs[k];\n" +
    "            var labelEl = inp.closest('label') || inp.previousElementSibling;\n" +
    "            var label = labelEl ? labelEl.textContent.trim().substring(0, 50) : '';\n" +
    "            result.mo2.keys.push({\n" +
    "              label: label,\n" +
    "              value: inp.value,\n" +
    "              hasValue: inp.value && inp.value.length > 0\n" +
    "            });\n" +
    "          }\n" +
    "          break;\n" +
    "        }\n" +
    "      }\n" +
    "      break;\n" +
    "    }\n" +
    "  }\n" +
    "  \n" +
    "  // Also check for all integration sections with API keys\n" +
    "  var allInputs = document.querySelectorAll('input[type=\"text\"]');\n" +
    "  result.totalApiKeyInputs = allInputs.length;\n" +
    "  result.hasApiKeys = allInputs.length > 0;\n" +
    "  \n" +
    "  // If MO2 found but no keys in parent, do broader search\n" +
    "  if (!result.mo2 || !result.mo2.keys) {\n" +
    "    // Check page text for any API key context\n" +
    "    var bodyText = document.body.innerText;\n" +
    "    var mo2Idx = bodyText.indexOf('Mod Organizer 2');\n" +
    "    if (mo2Idx !== -1) {\n" +
    "      result.mo2Found = true;\n" +
    "      result.mo2Context = bodyText.substring(mo2Idx, mo2Idx + 200);\n" +
    "    }\n" +
    "    // Find all text inputs with values\n" +
    "    result.allKeyInputs = [];\n" +
    "    for (var j = 0; j < Math.min(allInputs.length, 10); j++) {\n" +
    "      var inp = allInputs[j];\n" +
    "      if (inp.value && inp.value.length > 10) {\n" +
    "        // Find associated label/app name\n" +
    "        var parentDiv = inp;\n" +
    "        var appName = '';\n" +
    "        for (var u = 0; u < 6; u++) {\n" +
    "          parentDiv = parentDiv.parentElement;\n" +
    "          if (!parentDiv) break;\n" +
    "          var heading = parentDiv.querySelector('h3, h4, h5, strong');\n" +
    "          if (heading) { appName = heading.textContent.trim(); break; }\n" +
    "        }\n" +
    "        result.allKeyInputs.push({\n" +
    "          appName: appName,\n" +
    "          id: inp.id,\n" +
    "          valueLength: inp.value.length\n" +
    "        });\n" +
    "      }\n" +
    "    }\n" +
    "  }\n" +
    "  \n" +
    "  return result;\n" +
    "})()"
  );
}

async function searchGame(client, keyword) {
  if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
    return { error: '请提供游戏搜索关键词' };
  }

  const encodedKeyword = encodeURIComponent(keyword.trim());
  const searchUrl = `${CONFIG.NEXUS_BASE_URL}/games?keyword=${encodedKeyword}`;
  await client.navigate(searchUrl);
  await delay(8000); // Next.js RSC hydration 需要较长时间

  const expr = `
(function() {
  var titles = document.querySelectorAll('[data-e2eid="game-tile-title"]');
  var games = [];
  for (var i = 0; i < titles.length; i++) {
    var a = titles[i];
    var name = a.innerText.trim();
    var href = a.href;

    // 从 URL 提取 domain
    var domain = '';
    var parts = href.split('/games/');
    if (parts.length > 1) domain = parts[1];

    // 根据 alt 属性查找封面图 — 在 tile 卡片容器中查找
    var container = a.parentElement;
    var img = null;
    for (var depth = 0; depth < 5 && !img; depth++) {
      img = container.querySelector('img');
      if (!img) container = container.parentElement;
    }
    var image = img ? img.src : '';

    // 从封面图 URL 提取 game_id
    var gameId = '';
    if (image) {
      var segments = image.split('/');
      for (var j = 0; j < segments.length; j++) {
        if (segments[j] === 'v2' && j + 1 < segments.length) {
          gameId = segments[j + 1];
          break;
        }
      }
    }

    games.push({
      name: name,
      domain: domain,
      game_id: gameId,
      url: href,
      image: image
    });
  }

  // 提取搜索结果总数文本
  var bodyText = document.body.innerText;
  var countMatch = bodyText.match(/(\\d+)\\s+results?/);
  var totalResults = countMatch ? parseInt(countMatch[1]) : games.length;

  return {
    keyword: new URLSearchParams(window.location.search).get('keyword') || '',
    totalResults: totalResults,
    returnedCount: games.length,
    url: window.location.href,
    games: games
  };
})()
  `.trim();

  const result = await client.evaluate(expr);
  return result || { error: '搜索失败', keyword, games: [] };
}

/**
 * 保存 game_domain 到状态文件，后续所有命令自动使用。
 */
function setGameDomain(domain) {
  if (!domain || typeof domain !== 'string') {
    throw new Error('domain 必须是非空字符串');
  }
  if (!fs.existsSync(CONFIG.STATE_DIR)) {
    fs.mkdirSync(CONFIG.STATE_DIR, { recursive: true });
  }
  // 原子写入：先写临时文件，再重命名
  var tmpFile = CONFIG.GAME_DOMAIN_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify({ game_domain: domain.trim() }), 'utf8');
  fs.renameSync(tmpFile, CONFIG.GAME_DOMAIN_FILE);
  return { saved: true, game_domain: domain.trim(), file: CONFIG.GAME_DOMAIN_FILE };
}

/**
 * 读取当前 game_domain（无 CLI/env 时从 state 文件读取）
 */
function getGameDomain() {
  return CONFIG.GAME_DOMAIN;
}

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  if (!command) {
    console.log('Usage: node nexus-automation.js <command> [args]');
    console.log('Commands: login-state, trending, search, details, track, endorse, vote, tags, gallery, description, files, posts, bugs, bug-comments, post, download <modId> <fileName> <version> [downloadType], tracking [action] [query] [page], history [query] [page] [action], api-keys, game-search <keyword>, set-game <domain>, get-game');
    process.exit(1);
  }

  let client;
  try {
    client = await connectToBrowser();

    const loginState = await checkLoginState(client);
    if (command === 'login-state' || command === 'status') {
      console.log(JSON.stringify(loginState, null, 2));
      return;
    }

    if (!loginState.isLoggedIn) {
      console.log(JSON.stringify({ error: '用户未登录，请先登录 Nexus Mods 账号', loginState }, null, 2));
      return;
    }

    let result;
    switch (command) {
      case 'trending': result = await getTrendingMods(client, parseInt(args[0]) || 1); break;
      case 'search': {
        const keyword = args[0];
        const options = {};
        // 解析可选参数 key=value 格式
        for (let i = 1; i < args.length; i++) {
          const [key, value] = args[i].split('=');
          if (key && value !== undefined) {
            if (value === 'true') options[key] = true;
            else if (value === 'false') options[key] = false;
            else if (/^\d+$/.test(value)) options[key] = parseInt(value);
            else options[key] = value;
          }
        }
        result = await searchMods(client, keyword, options);
        break;
      }
      case 'details': result = await getModDetails(client, args[0]); break;
      case 'track': result = await trackMod(client, args[0], args[1] || 'toggle'); break;
      case 'endorse': result = await endorseMod(client, args[0], args[1] || 'toggle'); break;
      case 'vote': result = await voteMod(client, args[0], args[1] || 'toggle'); break;
      case 'tags': result = await getTags(client, args[0]); break;
      case 'gallery': result = await getGallery(client, args[0]); break;
      case 'description': result = await summarizeDescription(client, args[0]); break;
      case 'files': result = await getFilesTab(client, args[0]); break;
      case 'posts': result = await searchPosts(client, args[0], args[1] || '', parseInt(args[2]) || 1); break;
      case 'bugs': result = await searchBugs(client, args[0], args[1]); break;
      case 'bug-comments': result = await bugComments(client, args[0]); break;
      case 'download': result = await downloadMod(client, args[0], args[1], args[2], args[3] || 'manual'); break;
      case 'post': result = await postComment(client, args[0], args.slice(1).join(' ')); break;
      case 'tracking': result = await accessTrackingCentre(client, args[0], args[1], args[2]); break;
      case 'history': result = await accessDownloadHistory(client, args[0], args[1], args[2]); break;
      case 'api-keys': result = await getMO2ApiKeys(client); break;
      case 'game-search': result = await searchGame(client, args[0]); break;
      case 'set-game': result = setGameDomain(args[0]); break;
      case 'get-game': result = { game_domain: getGameDomain() }; break;
      default:
        console.log(JSON.stringify({ error: `未知命令: ${command}` }));
        return;
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  } finally {
    if (client) client.disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  connectToBrowser,
  checkLoginState,
  getTrendingMods,
  searchMods,
  getModDetails,
  trackMod,
  endorseMod,
  voteMod,
  trackAndEndorse,
  getTags,
  getGallery,
  summarizeDescription,
  getFilesTab,
  searchPosts,
  searchBugs,
  bugComments,
  extractAllFiles,
  downloadMod,
  postComment,
  accessTrackingCentre,
  accessDownloadHistory,
  getMO2ApiKeys,
  searchGame,
  setGameDomain,
  getGameDomain
};
