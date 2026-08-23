import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCandidateClassifications, offensiveDofusPool } from '../js/offensive-scope.js';
import { normalizeSourceEquipment } from '../js/dofus-source-rules.js';
import { BENCHMARK_SPELL_PROFILES, benchmarkSelection } from '../js/benchmark-spells.js';

const data = JSON.parse(await readFile(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const rawPayload = JSON.parse(await readFile(new URL('../data/raw/equipment.json', import.meta.url), 'utf8'));
const elements = JSON.parse(await readFile(new URL('../data/raw/elements.json', import.meta.url), 'utf8'));
const rawItems = Array.isArray(rawPayload) ? rawPayload : (rawPayload.items || []);
const selections = benchmarkSelection(BENCHMARK_SPELL_PROFILES[0]);
const constraints = { ap: 12, mp: 6, resEarth: 40, resFire: 40, resWater: 40, resAir: 40 };

const EXPECTED = [
  [694, 'Dofus Pourpre'],
  [739, 'Dofus Turquoise'],
  [6980, 'Dofus Vulbis'],
  [7754, 'Dofus Ocre'],
  [8698, 'Dofus Nébuleux']
];

function rawAnkamaId(item) {
  return Number(item?.ankama_id ?? item?.ankamaId);
}

test('real snapshot keeps curated offensive/flex Dofus available to the offensive solver', () => {
  const scope = buildCandidateClassifications(data.items, data.sets, selections, 'sum', constraints);
  const pool = offensiveDofusPool(data.items, scope.byId);
  const poolRuntimeIds = new Set(pool.map((item) => String(item.id)));

  const audit = EXPECTED.map(([ankamaId, expectedName]) => {
    const item = data.items.find((candidate) => Number(candidate.ankamaId) === ankamaId);
    const classification = item ? scope.byId.get(item.id) : null;
    const raw = rawItems.find((candidate) => rawAnkamaId(candidate) === ankamaId);
    const normalizedRaw = raw ? normalizeSourceEquipment(raw, elements) : null;
    return {
      ankamaId,
      expectedName,
      runtimeId: item?.id ?? null,
      present: Boolean(item),
      rawPresent: Boolean(raw),
      actualName: item?.name || normalizedRaw?.name || null,
      role: classification?.role || null,
      offensiveDelta: classification?.offensiveDelta ?? null,
      priority: classification?.priority ?? null,
      passives: (item?.passives || normalizedRaw?.passives || []).map((passive) => passive.id || passive.name || 'passive'),
      certifiedFromRaw: normalizedRaw?.certification?.certified ?? null,
      effectsCertified: normalizedRaw?.certification?.effectsCertified ?? null,
      conditionsCertified: normalizedRaw?.certification?.conditionsCertified ?? null,
      temporalEffectsPending: normalizedRaw?.certification?.temporalEffectsPending ?? null,
      pendingDynamicEffects: normalizedRaw?.source?.pendingDynamicEffects || [],
      normalizedEffects: normalizedRaw?.source?.effects || [],
      inPool: item ? poolRuntimeIds.has(String(item.id)) : false
    };
  });

  console.log('REAL_DOFUS_CORE_AUDIT', JSON.stringify(audit));
  for (const row of audit) {
    assert.equal(row.rawPresent, true, `${row.expectedName} (#${row.ankamaId}) missing from raw source`);
    assert.equal(row.certifiedFromRaw, true, `${row.expectedName} (#${row.ankamaId}) is not source-certified`);
    assert.equal(row.present, true, `${row.expectedName} (#${row.ankamaId}) missing from normalized snapshot`);
    assert.equal(row.inPool, true, `${row.expectedName} (#${row.ankamaId}) was removed from offensive solver pool; role=${row.role}`);
  }
});
