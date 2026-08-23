import { readFile } from 'node:fs/promises';
import { SAMPLE_SPELLS } from '../js/sample-data.js';
import { relevantStatKeys, pruneDominatedCandidates } from '../js/search-space.js';
import { itemConditionCompatibleWithHardConstraints } from '../js/build-legality.js';
import { choiceStructureTokenForTest } from '../js/pareto-choices.js';

const data = JSON.parse(await readFile(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const spell = SAMPLE_SPELLS[0];
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } }];
const constraints = { ap: 12, mp: 6, resEarth: 40, resFire: 40, resWater: 40, resAir: 40 };

const conditionStats = new Map();
function walk(node) {
  if (!node) return;
  if (node.kind === 'relation') {
    for (const child of node.children || []) walk(child);
    return;
  }
  const key = node.stat || 'UNKNOWN';
  if (!conditionStats.has(key)) conditionStats.set(key, { count: 0, operators: {}, values: new Set() });
  const entry = conditionStats.get(key);
  entry.count++;
  entry.operators[node.operator] = (entry.operators[node.operator] || 0) + 1;
  entry.values.add(node.value);
}
for (const item of data.items) walk(item.conditions);

const scoped = data.items.filter((item) => itemConditionCompatibleWithHardConstraints(item, constraints, 200));
const relevant = relevantStatKeys({ items: scoped, selections, constraints });
const dofusRaw = scoped.filter((item) => item.slot === 'dofus');
const pruned = pruneDominatedCandidates(dofusRaw, {
  keys: relevant.keys,
  nonMonotoneKeys: relevant.nonMonotoneKeys,
  groupCount: 6
}).candidates;

const partitions = new Map();
for (const item of pruned) {
  const token = choiceStructureTokenForTest(item);
  if (!partitions.has(token)) partitions.set(token, []);
  partitions.get(token).push(item);
}

const partitionProfiles = [...partitions.values()].map((items, index) => {
  const varying = {};
  for (const key of relevant.keys) {
    const values = new Set(items.map((item) => Number(item.stats?.[key] || 0)));
    if (values.size > 1) varying[key] = values.size;
  }
  return {
    index,
    size: items.length,
    sampleNames: items.slice(0, 8).map((item) => item.name),
    condition: items[0]?.conditions || null,
    passive: items[0]?.passives || [],
    varying
  };
});

console.log(JSON.stringify({
  conditionStats: Object.fromEntries([...conditionStats.entries()].map(([key, value]) => [key, {
    count: value.count,
    operators: value.operators,
    values: [...value.values].sort((a, b) => Number(a) - Number(b))
  }])),
  relevantKeys: relevant.keys,
  nonMonotoneKeys: [...relevant.nonMonotoneKeys],
  dofus: { before: dofusRaw.length, afterCandidatePrune: pruned.length, partitions: partitionProfiles }
}, null, 2));
