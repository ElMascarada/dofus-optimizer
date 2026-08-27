import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HTTP_PORT = 4173;
const DEBUG_PORT = 9222;
const APP_URL = `http://127.0.0.1:${HTTP_PORT}/`;
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;
const timeoutMs = 45_000;

function findChrome() {
  const names = [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean);
  for (const name of names) {
    const check = spawnSync('which', [name], { encoding: 'utf8' });
    if (check.status === 0 && check.stdout.trim()) return check.stdout.trim();
  }
  throw new Error('Chrome/Chromium introuvable pour la recette navigateur V2.');
}

async function waitFor(fn, { timeout = timeoutMs, interval = 100, label = 'condition' } = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timeout: ${label}${lastError ? ` · ${lastError.message}` : ''}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout connexion CDP')), 8_000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Connexion CDP impossible'));
      }, { once: true });
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Erreur Runtime.evaluate');
    return result.result?.value;
  }

  close() {
    this.socket?.close();
  }
}

const chrome = findChrome();
const profile = mkdtempSync(join(tmpdir(), 'dofus-optimizer-recipe-'));
const server = spawn('python3', ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1'], {
  stdio: ['ignore', 'ignore', 'pipe']
});
const browser = spawn(chrome, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let client = null;

try {
  await waitFor(async () => {
    const response = await fetch(APP_URL);
    return response.ok;
  }, { label: 'serveur HTTP local' });

  await waitFor(async () => {
    const response = await fetch(`${DEBUG_URL}/json/version`);
    return response.ok;
  }, { label: 'Chrome DevTools Protocol' });

  const targetResponse = await fetch(`${DEBUG_URL}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' });
  if (!targetResponse.ok) throw new Error(`Création onglet CDP: ${targetResponse.status}`);
  const target = await targetResponse.json();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.command('Page.enable');
  await client.command('Runtime.enable');

  const ready = await waitFor(() => client.evaluate(`(() => {
    const classSelect = document.querySelector('#optimizer-class');
    const workshopClass = document.querySelector('#workshop-class-select');
    return Boolean(classSelect && workshopClass && !classSelect.disabled && !workshopClass.disabled && document.querySelector('#optimizer-data-status')?.dataset.state === 'ready');
  })()`), { timeout: 30_000, label: 'catalogues V2 chargés' });
  if (!ready) throw new Error('Les catalogues V2 ne sont pas prêts.');

  const shell = await client.evaluate(`(() => ({
    workshopVisible: !document.querySelector('#workshop-view').hidden,
    optimizerHidden: document.querySelector('#optimizer-view').hidden,
    activeTab: document.querySelector('[data-product-tab].is-active')?.dataset.productTab,
    version: document.querySelector('#version')?.textContent,
    progress: document.querySelector('#workshop-slot-progress')?.textContent
  }))()`);
  if (!shell.workshopVisible || !shell.optimizerHidden || shell.activeTab !== 'workshop') throw new Error('État initial Atelier incorrect.');
  if (!shell.version?.startsWith('v0.14.2')) throw new Error(`Version UI inattendue: ${shell.version}`);
  if (shell.progress?.trim() !== '0 / 16') throw new Error(`Progression Atelier initiale inattendue: ${shell.progress}`);

  const keyboardOpen = await client.evaluate(`(async () => {
    const slot = document.querySelector('[data-workshop-slot]');
    slot.focus();
    slot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const browser = document.querySelector('#workshop-item-browser');
    return Boolean(browser && !browser.hidden && browser.querySelector('[data-browser-item]'));
  })()`);
  if (!keyboardOpen) throw new Error('Ouverture clavier du catalogue Atelier impossible.');

  const equipped = await client.evaluate(`(async () => {
    document.querySelector('#workshop-item-browser [data-browser-item]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      progress: document.querySelector('#workshop-slot-progress')?.textContent,
      browserHidden: document.querySelector('#workshop-item-browser')?.hidden,
      filled: document.querySelectorAll('.workshop-slot.is-filled').length
    };
  })()`);
  if (equipped.filled < 1 || equipped.progress?.trim() !== '1 / 16' || !equipped.browserHidden) throw new Error('Équipement Atelier / progression incohérents.');

  const optimizerReady = await client.evaluate(`(async () => {
    document.querySelector('[data-product-tab="optimizer"]').click();
    const select = document.querySelector('#optimizer-class');
    select.value = [...select.options].find((option) => option.value)?.value || '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      optimizerVisible: !document.querySelector('#optimizer-view').hidden,
      workshopHidden: document.querySelector('#workshop-view').hidden,
      runEnabled: !document.querySelector('#optimizer-run').disabled,
      initialState: document.querySelector('#optimizer-results')?.dataset.state
    };
  })()`);
  if (!optimizerReady.optimizerVisible || !optimizerReady.workshopHidden || !optimizerReady.runEnabled) throw new Error('Navigation / activation Optimiseur incorrectes.');

  await client.evaluate(`document.querySelector('#optimizer-run').click()`);
  const searchState = await waitFor(() => client.evaluate(`(() => {
    const button = document.querySelector('#optimizer-run');
    const root = document.querySelector('#optimizer-results');
    if (button.classList.contains('is-searching')) return null;
    return {
      state: root.dataset.state,
      cards: root.querySelectorAll('[data-open-build]').length,
      text: root.textContent.slice(0, 240)
    };
  })()`), { timeout: 40_000, interval: 150, label: 'optimisation V2 terminée' });
  if (searchState.state === 'error') throw new Error(`Optimiseur en erreur: ${searchState.text}`);
  if (searchState.cards < 1) throw new Error(`Aucun résultat ouvrable dans la recette: ${searchState.text}`);

  const roundTrip = await client.evaluate(`(async () => {
    document.querySelector('[data-open-build]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      workshopVisible: !document.querySelector('#workshop-view').hidden,
      optimizerHidden: document.querySelector('#optimizer-view').hidden,
      feedback: document.querySelector('#workshop-feedback')?.textContent,
      filled: document.querySelectorAll('.workshop-slot.is-filled').length
    };
  })()`);
  if (!roundTrip.workshopVisible || !roundTrip.optimizerHidden || roundTrip.filled !== 16) throw new Error('Round-trip Optimiseur → Atelier incomplet.');
  if (!roundTrip.feedback?.includes('Optimiseur')) throw new Error(`Feedback round-trip absent: ${roundTrip.feedback}`);

  console.log('V2_BROWSER_RECIPE_PASS');
  console.log(JSON.stringify({ shell, equipped, optimizerReady, searchState, roundTrip }, null, 2));
} finally {
  client?.close();
  browser.kill('SIGTERM');
  server.kill('SIGTERM');
  rmSync(profile, { recursive: true, force: true });
}
