const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const TEMP_DIR = path.join(process.env.TEMP || '/tmp', 'BGS-Nexus-automation');
const WS_ENDPOINT_FILE = path.join(TEMP_DIR, 'ws-endpoint.txt');
const PID_FILE = path.join(TEMP_DIR, 'browser.pid');
const BROWSER_INFO_FILE = path.join(TEMP_DIR, 'browser-info.json');
const DEBUG_PORT = process.env.BGS_NEXUS_DEBUG_PORT || '9222';

for (const dir of [TEMP_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function checkBrowsersInstalled() {
  return new Promise((resolve) => {
    const check = spawn('npx', ['@puppeteer/browsers', '--version'], {
      shell: true,
      stdio: 'pipe'
    });

    let output = '';
    check.stdout.on('data', (data) => {
      output += data.toString();
    });
    check.stderr.on('data', (data) => {
      output += data.toString();
    });

    check.on('close', (code) => {
      resolve(code === 0 && output.trim().length > 0);
    });

    check.on('error', () => {
      resolve(false);
    });
  });
}

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
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.setTimeout(2000, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

async function discoverWsEndpoint() {
  try {
    const data = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    if (data && data.webSocketDebuggerUrl) {
      fs.writeFileSync(WS_ENDPOINT_FILE, data.webSocketDebuggerUrl);
      return data.webSocketDebuggerUrl;
    }
  } catch (error) {
    // Browser not ready yet.
  }

  return null;
}

async function waitForWsEndpoint(retries = 30, intervalMs = 1000) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const wsEndpoint = await discoverWsEndpoint();
    if (wsEndpoint) {
      return wsEndpoint;
    }
    await delay(intervalMs);
  }

  throw new Error(`无法从 http://127.0.0.1:${DEBUG_PORT}/json/version 获取 WebSocket 端点`);
}

/**
 * 解析 @puppeteer/browsers install 的输出，提取浏览器路径和版本。
 * 输出格式示例:
 *   chrome@131.0.6778.85 C:\Users\...\chrome\win64-131.0.6778.85\chrome-win64\chrome.exe
 */
function parseInstallOutput(output) {
  const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      const browserPath = parts[parts.length - 1];
      const browserSpec = parts[0];
      if (browserPath.endsWith('.exe') && browserSpec.includes('@')) {
        return {
          spec: browserSpec,
          version: browserSpec.split('@')[1],
          path: browserPath
        };
      }
    }
  }
  return null;
}

async function runInstallCommand(args) {
  return new Promise((resolve, reject) => {
    let output = '';
    const proc = spawn('npx', ['-y', '@puppeteer/browsers', 'install', ...args], {
      shell: true,
      stdio: 'pipe'
    });

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`安装失败 (exit ${code}): ${output}`));
        return;
      }
      const info = parseInstallOutput(output);
      if (!info) {
        reject(new Error(`无法从安装输出解析浏览器路径: ${output}`));
        return;
      }
      resolve(info);
    });

    proc.on('error', reject);
  });
}

async function installBrowsers() {
  console.log('正在安装 @puppeteer/browsers...');

  const chromeInfo = await runInstallCommand(['chrome@stable']);
  console.log(`Chrome 安装成功: ${chromeInfo.spec} -> ${chromeInfo.path}`);

  try {
    const driverInfo = await runInstallCommand(['chromedriver']);
    console.log(`ChromeDriver 安装成功: ${driverInfo.spec} -> ${driverInfo.path}`);
  } catch (error) {
    console.warn('ChromeDriver 安装失败（可选）:', error.message);
  }

  fs.writeFileSync(BROWSER_INFO_FILE, JSON.stringify(chromeInfo, null, 2));
  return chromeInfo;
}

function getChromeExecutablePath() {
  if (fs.existsSync(BROWSER_INFO_FILE)) {
    try {
      const info = JSON.parse(fs.readFileSync(BROWSER_INFO_FILE, 'utf8'));
      if (info.path && fs.existsSync(info.path)) {
        return info.path;
      }
    } catch (error) {
      console.warn('读取 browser-info.json 失败:', error.message);
    }
  }
  return null;
}

async function launchBrowser() {
  const existingEndpoint = await discoverWsEndpoint();
  if (existingEndpoint) {
    console.log('检测到现有 Chrome 调试会话，直接复用。');
    return { wsEndpoint: existingEndpoint, pid: null, reused: true };
  }

  console.log('正在启动 Chrome 浏览器...');

  const chromeExecutable = getChromeExecutablePath();
  if (!chromeExecutable) {
    throw new Error('未找到已安装的 chrome.exe，请运行安装流程。');
  }

  console.log(`使用浏览器: ${chromeExecutable}`);

  const launch = spawn(
    chromeExecutable,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--remote-debugging-address=127.0.0.1',
      '--window-size=1920,1080',
      '--no-first-run',
      '--no-default-browser-check',
      'https://www.nexusmods.com'
    ],
    { detached: true, stdio: 'ignore' }
  );

  await new Promise((resolve, reject) => {
    launch.once('spawn', resolve);
    launch.once('error', reject);
  });

  launch.unref();

  if (launch.pid) {
    fs.writeFileSync(PID_FILE, String(launch.pid));
  }

  const wsEndpoint = await waitForWsEndpoint();
  fs.writeFileSync(WS_ENDPOINT_FILE, wsEndpoint);
  return { wsEndpoint, pid: launch.pid, reused: false };
}

async function main() {
  try {
    let browserInfo = null;
    const isInstalled = await checkBrowsersInstalled();
    if (!isInstalled) {
      console.log('@puppeteer/browsers 未安装，开始安装...');
      browserInfo = await installBrowsers();
    } else {
      console.log('@puppeteer/browsers 已安装');
      browserInfo = getChromeExecutablePath();
      if (!browserInfo) {
        console.log('已安装但路径信息缺失，重新安装...');
        browserInfo = await installBrowsers();
      }
    }

    const { wsEndpoint, reused } = await launchBrowser();

    console.log('');
    console.log('========================================');
    console.log(reused ? '已复用现有浏览器会话。' : '浏览器已启动！');
    console.log(`WebSocket 端点: ${wsEndpoint}`);
    console.log(`WebSocket 端点已保存到: ${WS_ENDPOINT_FILE}`);
    console.log('');
    console.log('请在打开的 Chrome 窗口中访问 https://www.nexusmods.com 并登录您的账号。');
    console.log('登录完成后直接回复我“已登录”即可，无需在脚本里按 Enter。');
    console.log('========================================');
    console.log('');
  } catch (error) {
    console.error('初始化失败:', error.message);
    process.exit(1);
  }
}

main();
