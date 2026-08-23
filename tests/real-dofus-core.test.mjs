import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCandidateClassifications, offensiveDofusPool } from '../js/offensive-scope.js';
import { BENCHMARK_SPELL_PROFILES, benchmarkSelection } from '../js/benchmark-spells.js';

const data = JSON.parse(await readFile(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const selections = benchmarkSelection(BENCHMARK_SPELL_PROFILES[0]);
const constraints = { ap: 12, mp: 6, resEarth: 40, resFire: 40, resWater: 40, resAir: 40 };

const EXPECTED = [
  [694, 'Dofus Pourpre'],
  [739, 'Dofus Turquoise'],
  [6980, 'Dofus Vulbis'],
  [7754, 'Dofus Ocre'],
  [8698, 'Dofus Nébuleux']
];

test('real snapshot keeps curated offensive/flex Dofus available to the offensive solver', () => {
  const scope = buildCandidateClassifications(data.items, data.sets, selections, 'sum', constraints);
  const pool = offensiveDofusPool(data.items, scope.byId);
  const poolIds = new Set(pool.map((item) => Number(item.id)));

  const audit = EXPECTED.map(([id, expectedName]) => {
    const item = data.items.find((candidate) => Number(candidate.id) === id);
    const classification = item ? scope.byId.get(item.id) : null;
    return {
      id,
      expectedName,
      present: Boolean(item),
      actualName: item?.name || null,
      role: classification?.role || null,
      offensiveDelta: classification?.offensiveDelta ?? null,
      priority: classification?.priority ?? null,
      passives: (item?.passives || []).map((passive) => passive.id || passive.name || 'passive'),
      inPool: poolIds.has(id)
    };
  });

  console.log('REAL_DOFUS_CORE_AUDIT', JSON.stringify(audit));
  for (const row of audit) {
    assert.equal(row.present, true, `${row.expectedName} (#${row.id}) missing from normalized snapshot`);
    assert.equal(row.inPool, true, `${row.expectedName} (#${row.id}) was removed from offensive solver pool; role=${row.role}`);
  }
});
