import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HTTP_PORT = 4174;
const DEBUG_PORT = 9223;
const APP_URL = `http://127.0.0.1:${HTTP_PORT}/`;
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;

function findChrome() {
  for (const name of [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean)) {
    const check = spawnSync('which', [name], { encoding: 'utf8' });
    if (check.status === 0 && check.stdout.trim()) return check.stdout.trim();
  }
  throw new Error('Chrome/Chromium introuvable.');
}

async function waitFor(fn, { timeout = 60_000, interval = 80, label = 'condition' } = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timeout: ${label}${lastError ? ` · ${lastError.message}` : ''}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => { if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL'); resolve(); }, 1500);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

class CdpClient {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout connexion CDP')), 8000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Connexion CDP impossible')); }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
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
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const result = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate');
    return result.result?.value;
  }
  close() { this.socket?.close(); }
}

const profile = mkdtempSync(join(tmpdir(), 'dofus-stop-audit-'));
const server = spawn('python3', ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1'], { stdio: ['ignore', 'ignore', 'pipe'] });
const browser = spawn(findChrome(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let client = null;
try {
  await waitFor(async () => (await fetch(APP_URL)).ok, { label: 'serveur' });
  await waitFor(async () => (await fetch(`${DEBUG_URL}/json/version`)).ok, { label: 'CDP' });
  const target = await (await fetch(`${DEBUG_URL}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' })).json();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.command('Runtime.enable');
  await waitFor(() => client.evaluate(`document.querySelector('#optimizer-data-status')?.dataset.state === 'ready'`), { timeout: 30_000, label: 'données prêtes' });

  await client.evaluate(`(() => {
    document.querySelector('[data-product-tab="optimizer"]').click();
    const cls = document.querySelector('#optimizer-class');
    cls.value = [...cls.options].find(o => o.value)?.value || '';
    cls.dispatchEvent(new Event('change', { bubbles: true }));
    const el = document.querySelector('#optimizer-element');
    el.value = [...el.options].find(o => o.value === 'earth')?.value || [...el.options].find(o => o.value)?.value || '';
    document.querySelector('#optimizer-turn-mode').value = 't1';
    document.querySelector('#optimizer-min-ap').value = '12';
    document.querySelector('#optimizer-min-mp').value = '6';
    document.querySelector('#optimizer-min-initiative').value = '0';
  })()`);

  await client.evaluate(`document.querySelector('#optimizer-run').click()`);
  const signalA = await waitFor(() => client.evaluate(`(() => {
    const text = document.querySelector('#optimizer-diagnostics')?.textContent || '';
    const match = text.match(/meilleur score\s+([\d\s.,]+)/i);
    if (!match) return null;
    const score = Number(match[1].replace(/\s/g, '').replace(',', '.'));
    return score > 0 ? { text, score } : null;
  })()`), { timeout: 90_000, label: 'premier meilleur score certifié' });

  const stoppedA = await client.evaluate(`(async () => {
    document.querySelector('#optimizer-run').click();
    await new Promise(r => setTimeout(r, 120));
    const root = document.querySelector('#optimizer-results');
    return {
      state: root.dataset.state,
      cards: root.querySelectorAll('.optimizer-v2-result-card').length,
      score: root.querySelector('.optimizer-v2-result-card header strong')?.textContent || '',
      items: root.querySelectorAll('.optimizer-v2-result-card:first-child .optimizer-v2-gear li').length,
      classDisabled: document.querySelector('#optimizer-class').disabled,
      searching: document.querySelector('#optimizer-run').classList.contains('is-searching'),
      diagnostics: document.querySelector('#optimizer-diagnostics').textContent
    };
  })()`);

  const beforeB = await client.evaluate(`(() => ({
    state: document.querySelector('#optimizer-results').dataset.state,
    cards: document.querySelectorAll('.optimizer-v2-result-card').length,
    score: document.querySelector('.optimizer-v2-result-card header strong')?.textContent || ''
  }))()`);

  const duringB = await client.evaluate(`(async () => {
    const el = document.querySelector('#optimizer-element');
    const next = [...el.options].find(o => o.value && o.value !== el.value);
    if (next) el.value = next.value;
    document.querySelector('#optimizer-run').click();
    await new Promise(r => setTimeout(r, 0));
    const root = document.querySelector('#optimizer-results');
    return { state: root.dataset.state, cards: root.querySelectorAll('.optimizer-v2-result-card').length, diagnostics: document.querySelector('#optimizer-diagnostics').textContent };
  })()`);
  const stoppedB = await client.evaluate(`(async () => {
    document.querySelector('#optimizer-run').click();
    await new Promise(r => setTimeout(r, 100));
    const root = document.querySelector('#optimizer-results');
    return {
      state: root.dataset.state,
      cards: root.querySelectorAll('.optimizer-v2-result-card').length,
      classDisabled: document.querySelector('#optimizer-class').disabled,
      searching: document.querySelector('#optimizer-run').classList.contains('is-searching'),
      diagnostics: document.querySelector('#optimizer-diagnostics').textContent
    };
  })()`);

  console.log('SEARCH_COHERENCE_STOP_AUDIT_BEGIN');
  console.log(JSON.stringify({ signalA, stoppedA, beforeB, duringB, stoppedB }, null, 2));
  console.log('SEARCH_COHERENCE_STOP_AUDIT_END');

  if (stoppedA.state !== 'results' || stoppedA.cards < 1 || stoppedA.items !== 16 || stoppedA.classDisabled || stoppedA.searching || !/conserv/i.test(stoppedA.diagnostics)) {
    throw new Error(`Scenario A failed: ${JSON.stringify(stoppedA)}`);
  }
  if (beforeB.cards < 1 || duringB.state !== 'loading' || duringB.cards !== 0 || stoppedB.state !== 'empty' || stoppedB.cards !== 0 || stoppedB.classDisabled || stoppedB.searching || !/sans résultat validé/i.test(stoppedB.diagnostics)) {
    throw new Error(`Scenario B failed: ${JSON.stringify({ beforeB, duringB, stoppedB })}`);
  }
} finally {
  client?.close();
  await Promise.all([stopProcess(browser), stopProcess(server)]);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 80 }); } catch {}
}
