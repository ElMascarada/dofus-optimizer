import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildSpellSupportReport, classifySpellSupport, SpellSupportStatus } from '../js/spell-support.js';
import { applyCuratedSpellRules } from '../js/curated-runtime-rules.js';
import { validateSpellSnapshot } from '../js/data-loader.js';

test('spell support classification is explicit and never silently upgrades unknown spells', () => {
  assert.equal(classifySpellSupport({ id: 'empty' }).status, SpellSupportStatus.UNSUPPORTED);
  assert.equal(classifySpellSupport({
    id: 'full',
    hits: [{ element: 'air', normal: [10, 10], crit: [10, 10] }],
    combatModifierCoverage: { supported: 0, ignored: 0 }
  }).status, SpellSupportStatus.FULL);
  assert.equal(classifySpellSupport({
    id: 'partial',
    hits: [{ element: 'air', normal: [10, 10], crit: [10, 10] }],
    combatModifierCoverage: { supported: 0, ignored: 2 }
  }).status, SpellSupportStatus.PARTIAL);

  const accumulation = applyCuratedSpellRules({
    id: 'spell-13138',
    hits: [{ element: 'earth', normal: [20, 20], crit: [24, 24] }],
    combatModifiers: []
  });
  assert.equal(classifySpellSupport(accumulation).status, SpellSupportStatus.CURATED);
});

test('support report counts runtime coverage and missing source spells per class', () => {
  const report = buildSpellSupportReport({
    breeds: [{ id: 'breed-1', ankamaId: 1, name: 'Classe test', sourceSpellCount: 3 }],
    spells: [
      { id: 'a', breedId: 'breed-1', name: 'A', hits: [{ element: 'air', normal: [10, 10], crit: [10, 10] }] },
      { id: 'b', breedId: 'breed-1', name: 'B', hits: [{ element: 'air', normal: [10, 10], crit: [10, 10] }], combatModifierCoverage: { ignored: 1 } }
    ]
  });
  assert.equal(report.classes[0].counts.FULL, 1);
  assert.equal(report.classes[0].counts.PARTIAL, 1);
  assert.equal(report.classes[0].counts.UNSUPPORTED, 1);
  assert.equal(report.classes[0].missingUnsupported, 1);
});

test('current normalized catalog exposes an explicit support report for every class', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
  const catalog = validateSpellSnapshot(snapshot);
  const report = catalog.supportReport;
  assert.ok(report.classes.length > 0);
  assert.equal(report.runtimeSpellCount, catalog.spells.length);
  assert.ok(report.sourceSpellCount >= report.runtimeSpellCount);
  assert.equal(
    Object.values(report.totals).reduce((sum, value) => sum + Number(value || 0), 0),
    report.sourceSpellCount
  );
  console.log(`SPELL_SUPPORT_SUMMARY ${JSON.stringify(report.classes.map((row) => ({
    name: row.name,
    source: row.sourceSpellCount,
    runtime: row.runtimeSpellCount,
    counts: row.counts
  })))}`);
});
