import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const elements = String(process.env.ELEMENTS || 'multi').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
const profileName = String(process.env.PROFILE || 'large').trim().toLowerCase();
const critMode = String(process.env.CRIT_MODE || 'crit').trim().toLowerCase();
if (!elements.length || (elements.includes('multi') && elements.length !== 1)) throw new RangeError('ELEMENTS must be multi or 1-3 comma-separated mono elements');
if (!['small', 'medium', 'large'].includes(profileName)) throw new RangeError(`Unsupported PROFILE=${profileName}`);
if (!['auto', 'crit', 'no_crit'].includes(critMode)) throw new RangeError(`Unsupported CRIT_MODE=${critMode}`);

async function allocatePorts() {
  const servers = [];
  const ports = [];
  try {
    for (let i = 0; i < 2; i++) {
      const server = createServer();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Dynamic local port unavailable');
      ports.push(address.port);
    }
    return ports;
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

function which(name) {
  if (!name) return null;
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

function browserLauncher() {
  for (const name of [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean)) {
    const command = which(name);
    if (command) return { command, prefix: [] };
  }
  const flatpak = which('flatpak');
  if (flatpak && spawnSync(flatpak, ['info', 'org.chromium.Chromium'], { encoding: 'utf8' }).status === 0) {
    return { command: flatpak, prefix: ['run', 'org.chromium.Chromium'] };
  }
  throw new Error('Chrome/Chromium unavailable');
}

async function waitFor(fn, label, timeout = 330_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timeout: ${label}`);
}

function release(child) {
  child?.stdin?.destroy?.();
  child?.stdout?.destroy?.();
  child?.stderr?.destroy?.();
}

async function stop(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode) return release(child);
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
      resolve();
    }, 1500);
    child.once('exit', () => { clearTimeout(timer); resolve(); }, { once: true });
    child.kill('SIGTERM');
  });
  release(child);
}

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connect timeout')), 8000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  command(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
    return result.result?.value;
  }
  close() { this.ws?.close(); }
}

const [httpPort, debugPort] = await allocatePorts();
const appUrl = `http://127.0.0.1:${httpPort}/`;
const debugUrl = `http://127.0.0.1:${debugPort}`;
const launcher = browserLauncher();
const browserProfile = mkdtempSync(join(tmpdir(), 'dofus-combined-crit-browser-'));
const server = spawn('python3', ['-m', 'http.server', String(httpPort), '--bind', '127.0.0.1'], { stdio: ['ignore', 'ignore', 'ignore'] });
const browser = spawn(launcher.command, [
  ...launcher.prefix,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${browserProfile}`, 'about:blank'
], { stdio: ['ignore', 'ignore', 'ignore'] });
let client = null;

try {
  await waitFor(async () => (await fetch(appUrl)).ok, 'local HTTP server', 20_000);
  await waitFor(async () => (await fetch(`${debugUrl}/json/version`)).ok, 'Chrome DevTools Protocol', 20_000);
  const targetResponse = await fetch(`${debugUrl}/json/new?${encodeURIComponent(appUrl)}`, { method: 'PUT' });
  if (!targetResponse.ok) throw new Error(`CDP tab creation failed: ${targetResponse.status}`);
  const target = await targetResponse.json();
  client = new Cdp(target.webSocketDebuggerUrl);
  await client.connect();
  await client.command('Runtime.enable');
  await waitFor(() => client.eval(`document.querySelector('#optimizer-data-status')?.dataset.state === 'ready'`), 'catalog ready', 30_000);

  const requested = JSON.stringify(elements);
  await client.eval(`(() => {
    const elements = ${requested};
    document.querySelector('[data-product-tab="optimizer"]').click();
    const literalMulti = elements.length === 1 && elements[0] === 'multi';
    document.querySelector('#optimizer-element-multi').checked = literalMulti;
    for (const input of document.querySelectorAll('[data-optimizer-element]')) input.checked = !literalMulti && elements.includes(input.value);
    for (const input of document.querySelectorAll('[data-optimizer-profile]')) input.checked = input.value === ${JSON.stringify(profileName)};
    for (const input of document.querySelectorAll('[data-optimizer-crit-mode]')) input.checked = input.value === ${JSON.stringify(critMode)};
    document.querySelector('#optimizer-min-ap').value = '12';
    document.querySelector('#optimizer-min-mp').value = '6';
    document.querySelector('#optimizer-run').click();
  })()`);

  await waitFor(() => client.eval(`['ready','empty','error'].includes(document.querySelector('#optimizer-results')?.dataset.state)`), 'optimizer result');
  const result = await client.eval(`(() => {
    const root = document.querySelector('#optimizer-results');
    const first = root.querySelector('[data-optimizer-result="0"]');
    const rows = [...(first?.querySelectorAll('.optimizer-result-stats li') || [])];
    const critRow = rows.find((row) => row.querySelector('span')?.textContent?.trim() === 'Crit');
    const text = first?.textContent || '';
    return {
      state: root?.dataset?.state || null,
      count: root?.querySelectorAll('[data-optimizer-result]')?.length || 0,
      crit: Number((critRow?.querySelector('strong')?.textContent || '0').replace(/[^0-9.-]/g, '')),
      kokulte: text.includes('Kokulte'),
      turquoise: text.includes('Dofus Turquoise'),
      appVersion: globalThis.DofusOptimizerRuntime?.appVersion || null,
      serviceWorkerCache: globalThis.DofusOptimizerRuntime?.serviceWorkerCache || null,
      serviceWorkerController: navigator.serviceWorker?.controller?.scriptURL || null,
      firstText: text.replace(/\\s+/g, ' ').trim()
    };
  })()`);

  console.log(`ELEMENTS=${elements.join(',')}`);
  console.log(`PROFILE=${profileName}`);
  console.log(`CRIT_MODE=${critMode}`);
  console.log(`BROWSER_STATE=${result.state}`);
  console.log(`BROWSER_RESULTS=${result.count}`);
  console.log(`BROWSER_TOP_CRIT=${result.crit}`);
  console.log(`BROWSER_TOP_KOKULTE=${result.kokulte ? 'YES' : 'NO'}`);
  console.log(`BROWSER_TOP_TURQUOISE=${result.turquoise ? 'YES' : 'NO'}`);
  console.log(`BROWSER_APP_VERSION=${result.appVersion}`);
  console.log(`BROWSER_SW_CACHE=${result.serviceWorkerCache}`);
  console.log(`BROWSER_SW_CONTROLLER=${result.serviceWorkerController || 'NONE'}`);
  console.log(`BROWSER_TOP_TEXT=${result.firstText}`);
  if (result.state !== 'ready' || !result.count) throw new Error(`Browser optimizer failed: ${JSON.stringify(result)}`);
} finally {
  client?.close();
  await Promise.all([stop(browser), stop(server)]);
  try { rmSync(browserProfile, { recursive: true, force: true, maxRetries: 6, retryDelay: 80 }); } catch {}
}
