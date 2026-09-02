import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createOptimizerV2Request,
  formatOptimizerV2FmSummary,
  normalizeOptimizerV2FmPolicy
} from '../js/optimizer-v2-orchestrator.js';

const dataset = { items: [], sets: [] };
const spellData = {
  breeds: [{ id: '1', name: 'Test', spellIds: ['spell-1'] }],
  spells: [{ id: 'spell-1', hits: [{ element: 'earth', normal: [10, 10] }] }]
};

function request(fmPolicy) {
  return createOptimizerV2Request({
    dataset,
    spellData,
    classId: '1',
    element: 'earth',
    constraints: { ap: 12, mp: 6 },
    fmPolicy,
    turnMode: 't1'
  });
}

test('request default is strictly FM-neutral without reading DEFAULT_FM', () => {
  assert.deepEqual(request().fmPolicy, {
    spellDamagePct: 0,
    allowCritDamage: false,
    critDamageAmount: 8,
    exoAp: 0,
    exoMp: 0
  });
});

test('request transports Exo PA OFF/ON independently', () => {
  assert.equal(request({ exoAp: 0 }).fmPolicy.exoAp, 0);
  assert.equal(request({ exoAp: 1 }).fmPolicy.exoAp, 1);
  assert.equal(request({ exoAp: 1 }).fmPolicy.exoMp, 0);
});

test('request transports Exo PM OFF/ON independently', () => {
  assert.equal(request({ exoMp: 0 }).fmPolicy.exoMp, 0);
  assert.equal(request({ exoMp: 1 }).fmPolicy.exoMp, 1);
  assert.equal(request({ exoMp: 1 }).fmPolicy.exoAp, 0);
});

test('request transports Do Sorts OFF/ON explicitly', () => {
  assert.equal(request({ spellDamagePct: 0 }).fmPolicy.spellDamagePct, 0);
  assert.equal(request({ spellDamagePct: 3 }).fmPolicy.spellDamagePct, 3);
  assert.equal(request({ spellDamagePct: 3 }).fmPolicy.allowCritDamage, false);
});

test('request transports Do Crit OFF/ON independently', () => {
  assert.equal(request({ allowCritDamage: false }).fmPolicy.allowCritDamage, false);
  assert.equal(request({ allowCritDamage: true }).fmPolicy.allowCritDamage, true);
  assert.equal(request({ allowCritDamage: true }).fmPolicy.spellDamagePct, 0);
});

test('FM summary exposes either none or the exact requested policy', () => {
  assert.equal(formatOptimizerV2FmSummary({}), 'FM : aucune');
  assert.equal(
    formatOptimizerV2FmSummary({ exoAp: 1, exoMp: 1, spellDamagePct: 3, allowCritDamage: false }),
    'FM : PA +1 · PM +1 · Do Sorts +3% / slot · Do Crit OFF'
  );
});

test('UI controls are neutral by default and explicitly passed into the request', async () => {
  const [html, app, orchestrator] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/optimizer-v2-orchestrator.js', import.meta.url), 'utf8')
  ]);
  for (const id of [
    'optimizer-fm-exo-ap',
    'optimizer-fm-exo-mp',
    'optimizer-fm-spell-damage',
    'optimizer-fm-crit-damage'
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /Aucune forgemagie n’est appliquée tant que tu ne l’actives pas ici/);
  assert.match(app, /function readFmPolicy\(\)/);
  assert.match(app, /fmPolicy: readFmPolicy\(\)/);
  assert.match(app, /formatOptimizerV2FmSummary/);
  assert.doesNotMatch(orchestrator, /DEFAULT_FM/);
});

test('FM policy normalization never invents unsupported user values', () => {
  assert.deepEqual(normalizeOptimizerV2FmPolicy({ exoAp: 9, exoMp: -1, spellDamagePct: 99, allowCritDamage: 'yes' }), {
    spellDamagePct: 3,
    allowCritDamage: false,
    critDamageAmount: 8,
    exoAp: 0,
    exoMp: 0
  });
});
