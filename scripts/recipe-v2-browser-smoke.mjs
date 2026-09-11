import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

await import('../js/runtime-meta.js');
const EXPECTED_VERSION = globalThis.DofusOptimizerRuntime?.appVersion;
if (!EXPECTED_VERSION) throw new Error('Version runtime introuvable.');

const HTTP_PORT = 4173;
const DEBUG_PORT = 9222;
const APP_URL = `http://127.0.0.1:${HTTP_PORT}/`;
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;

function findChrome() {
  const names = [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean);
  for (const name of names) {
    const check = spawnSync('which', [name], { encoding: 'utf8' });
    if (check.status === 0 && check.stdout.trim()) return check.stdout.trim();
  }
  throw new Error('Chrome/Chromium introuvable pour la recette navigateur Equipment-Only.');
}

async function waitFor(fn, { timeout = 240_000, interval = 150, label = 'condition' } = {}) {
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

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
      resolve();
    }, 1_500);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

class CdpClient {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout connexion CDP')), 8_000);
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Erreur Runtime.evaluate');
    return result.result?.value;
  }
  close() { this.socket?.close(); }
}

const profile = mkdtempSync(join(tmpdir(), 'dofus-equipment-only-recipe-'));
const server = spawn('python3', ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1'], { stdio: ['ignore', 'ignore', 'pipe'] });
const browser = spawn(findChrome(), [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let client = null;

try {
  await waitFor(async () => (await fetch(APP_URL)).ok, { timeout: 20_000, label: 'serveur HTTP local' });
  await waitFor(async () => (await fetch(`${DEBUG_URL}/json/version`)).ok, { timeout: 20_000, label: 'Chrome DevTools Protocol' });

  const targetResponse = await fetch(`${DEBUG_URL}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' });
  if (!targetResponse.ok) throw new Error(`Création onglet CDP: ${targetResponse.status}`);
  const target = await targetResponse.json();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.command('Page.enable');
  await client.command('Runtime.enable');

  await waitFor(() => client.evaluate(`document.querySelector('#optimizer-data-status')?.dataset.state === 'ready'`), {
    timeout: 30_000, label: 'catalogue équipement chargé'
  });

  const contract = await client.evaluate(`(() => ({
    classSelector: Boolean(document.querySelector('#optimizer-class')),
    turnSelector: Boolean(document.querySelector('#optimizer-turn-mode')),
    spellFm: Boolean(document.querySelector('#optimizer-fm-spell-damage, #optimizer-fm-crit-damage')),
    appScript: [...document.scripts].some((script) => script.src.includes('/js/optimizer-app.js'))
  }))()`);
  if (contract.classSelector || contract.turnSelector || contract.spellFm || !contract.appScript) {
    throw new Error(`Contrat Equipment-Only invalide: ${JSON.stringify(contract)}`);
  }

  await client.evaluate(`(() => {
    document.querySelector('[data-product-tab="optimizer"]').click();
    for (const input of document.querySelectorAll('[data-optimizer-element]')) input.checked = input.value === 'earth';
    document.querySelector('#optimizer-element-multi').checked = false;
    for (const input of document.querySelectorAll('[data-optimizer-profile]')) input.checked = input.value === 'large';
    document.querySelector('#optimizer-min-ap').value = '12';
    document.querySelector('#optimizer-min-mp').value = '6';
    document.querySelector('#optimizer-min-range').value = '0';
    document.querySelector('#optimizer-min-vit').value = '0';
    document.querySelector('#optimizer-min-initiative').value = '0';
    document.querySelector('#optimizer-fm-exo-ap').value = '0';
    document.querySelector('#optimizer-fm-exo-mp').value = '0';
    document.querySelector('#optimizer-run').click();
  })()`);

  await waitFor(() => client.evaluate(`['ready','empty','error'].includes(document.querySelector('#optimizer-results')?.dataset.state)`), {
    timeout: 240_000, label: 'recherche Equipment-First 12/6'
  });

  const result = await client.evaluate(`(() => {
    const root = document.querySelector('#optimizer-results');
    const first = root.querySelector('[data-optimizer-result="0"]');
    return {
      state: root.dataset.state,
      ap: Number(first?.dataset.resultAp || 0),
      mp: Number(first?.dataset.resultMp || 0),
      items: Number(first?.dataset.resultItems || 0),
      hasOpenWorkshop: Boolean(first?.querySelector('[data-open-workshop]'))
    };
  })()`);

  if (result.state !== 'ready' || result.ap !== 12 || result.mp !== 6 || result.items !== 16 || !result.hasOpenWorkshop) {
    throw new Error(`Résultat Equipment-First 12/6 invalide: ${JSON.stringify(result)}`);
  }

  await client.evaluate(`document.querySelector('[data-optimizer-result="0"] [data-open-workshop]').click()`);
  await waitFor(() => client.evaluate(`document.querySelector('#workshop-slot-progress')?.textContent?.trim() === '16 / 16'`), {
    timeout: 10_000, label: 'round-trip Optimizer → Workshop'
  });

  const workshop = await client.evaluate(`(() => ({
    visible: !document.querySelector('#workshop-view').hidden,
    progress: document.querySelector('#workshop-slot-progress')?.textContent,
    findBetterEnabled: !document.querySelector('#workshop-find-better')?.disabled
  }))()`);
  if (!workshop.visible || workshop.progress?.trim() !== '16 / 16' || !workshop.findBetterEnabled) {
    throw new Error(`Round-trip Workshop invalide: ${JSON.stringify(workshop)}`);
  }

  console.log('EQUIPMENT_ONLY_UI=PASS');
  console.log('CLASS_DEPENDENCY_REMOVED=PASS');
  console.log('TURN_DEPENDENCY_REMOVED=PASS');
  console.log('SPELL_DATA_DEPENDENCY_REMOVED=PASS');
  console.log('ACTIVE_WORKER_EQUIPMENT_FIRST=PASS');
  console.log('REAL_BROWSER_12_6_FOUND=YES');
  console.log('WORKSHOP_ROUNDTRIP=PASS');
} finally {
  client?.close();
  await Promise.all([stopProcess(browser), stopProcess(server)]);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 80 }); } catch {}
}
