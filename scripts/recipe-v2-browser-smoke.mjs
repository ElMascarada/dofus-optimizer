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
  throw new Error('Chrome/Chromium introuvable pour la recette navigateur V2.');
}

async function waitFor(fn, { timeout = 20_000, interval = 100, label = 'condition' } = {}) {
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
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

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

const profile = mkdtempSync(join(tmpdir(), 'dofus-optimizer-recipe-'));
const server = spawn('python3', ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1'], { stdio: ['ignore', 'ignore', 'pipe'] });
const browser = spawn(findChrome(), [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let client = null;

try {
  await waitFor(async () => (await fetch(APP_URL)).ok, { label: 'serveur HTTP local' });
  await waitFor(async () => (await fetch(`${DEBUG_URL}/json/version`)).ok, { label: 'Chrome DevTools Protocol' });

  const targetResponse = await fetch(`${DEBUG_URL}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' });
  if (!targetResponse.ok) throw new Error(`Création onglet CDP: ${targetResponse.status}`);
  const target = await targetResponse.json();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.command('Page.enable');
  await client.command('Runtime.enable');

  await waitFor(() => client.evaluate(`(() => {
    const optimizerClass = document.querySelector('#optimizer-class');
    const workshopClass = document.querySelector('#workshop-class-select');
    return Boolean(optimizerClass && workshopClass && !optimizerClass.disabled && !workshopClass.disabled && document.querySelector('#optimizer-data-status')?.dataset.state === 'ready');
  })()`), { timeout: 30_000, label: 'catalogues V2 chargés' });

  const shell = await client.evaluate(`(() => ({
    workshopVisible: !document.querySelector('#workshop-view').hidden,
    optimizerHidden: document.querySelector('#optimizer-view').hidden,
    activeTab: document.querySelector('[data-product-tab].is-active')?.dataset.productTab,
    version: document.querySelector('#version')?.textContent,
    progress: document.querySelector('#workshop-slot-progress')?.textContent
  }))()`);
  if (!shell.workshopVisible || !shell.optimizerHidden || shell.activeTab !== 'workshop') throw new Error('État initial Atelier incorrect.');
  if (shell.version?.trim() !== `v${EXPECTED_VERSION}`) throw new Error(`Version UI inattendue: ${shell.version} (runtime ${EXPECTED_VERSION})`);
  if (shell.progress?.trim() !== '0 / 16') throw new Error(`Progression Atelier initiale inattendue: ${shell.progress}`);

  const keyboardOpen = await client.evaluate(`(async () => {
    const slot = document.querySelector('[data-workshop-slot]');
    slot.focus();
    slot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const catalogue = document.querySelector('#workshop-item-browser');
    return Boolean(catalogue && !catalogue.hidden && catalogue.querySelector('[data-browser-item]'));
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
  if (equipped.filled !== 1 || equipped.progress?.trim() !== '1 / 16' || !equipped.browserHidden) throw new Error('Équipement Atelier / progression incohérents.');

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

  // Exerce le vrai module Worker de façon déterministe. Un item imposé absent doit
  // produire immédiatement un résultat impossible, sans transformer cette recette
  // de shell navigateur en benchmark BALANCED dépendant de la machine.
  const workerTerminal = await client.evaluate(`new Promise((resolve) => {
    const requestId = 424242;
    const worker = new Worker('./js/optimizer-worker.js', { type: 'module' });
    const finish = (value) => { clearTimeout(timer); worker.terminate(); resolve(value); };
    const timer = setTimeout(() => finish({ type: 'timeout' }), 8_000);
    worker.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.requestId !== requestId || !['result', 'error'].includes(message.type)) return;
      finish({
        type: message.type,
        impossible: Boolean(message.output?.diagnostics?.impossible),
        reason: message.output?.diagnostics?.reason || '',
        message: message.message || ''
      });
    });
    worker.addEventListener('error', (event) => finish({ type: 'worker-error', message: event.message || 'worker error' }));
    worker.postMessage({
      type: 'optimize',
      requestId,
      payload: {
        objectiveMode: 'combat',
        combatObjective: { element: 'earth', turnMode: 't1', targetMode: 'single', metric: 'total-damage' },
        turnMode: 't1',
        classSpells: [{
          id: 'browser-smoke-hit', name: 'Browser smoke hit', apCost: 3, baseCritPct: 0,
          maxCastPerTurn: 1, maxCastPerTarget: 1, distanceOptions: ['melee', 'ranged'],
          hits: [{ element: 'earth', normal: [1, 1], crit: [1, 1] }],
          combatModifiers: [], combatRelevant: true
        }],
        items: [], sets: [], selections: [], constraints: {}, fmPolicy: {}, scenario: {},
        requiredItemIds: ['__browser_smoke_missing_item__'], diversityMode: 'gear',
        searchProfile: 'BALANCED', topN: 1
      }
    });
  })`);
  if (workerTerminal.type !== 'result' || !workerTerminal.impossible || workerTerminal.reason !== 'required-item-missing') {
    throw new Error(`Worker smoke inattendu: ${JSON.stringify(workerTerminal)}`);
  }

  // Vérifie le chemin UI réel de démarrage puis d'arrêt sans attendre la fin d'une
  // recherche qualité complète. Le benchmark dédié mesure ce coût séparément.
  await client.evaluate(`document.querySelector('#optimizer-run').click()`);
  await waitFor(() => client.evaluate(`document.querySelector('#optimizer-run').classList.contains('is-searching')`), { label: 'recherche libre démarrée' });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const stopped = await client.evaluate(`(async () => {
    document.querySelector('#optimizer-run').click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      searching: document.querySelector('#optimizer-run').classList.contains('is-searching'),
      state: document.querySelector('#optimizer-results').dataset.state,
      classDisabled: document.querySelector('#optimizer-class').disabled,
      diagnostics: document.querySelector('#optimizer-diagnostics').textContent
    };
  })()`);
  if (stopped.searching || stopped.classDisabled || stopped.state === 'error') throw new Error(`Arrêt manuel incohérent: ${JSON.stringify(stopped)}`);

  console.log('V2_BROWSER_RECIPE_PASS');
  console.log(JSON.stringify({ shell, equipped, optimizerReady, workerTerminal, stopped }, null, 2));
} finally {
  client?.close();
  await Promise.all([stopProcess(browser), stopProcess(server)]);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 80 });
  } catch {
    // Le profil est éphémère ; une suppression tardive ne doit pas masquer le résultat de recette.
  }
}
