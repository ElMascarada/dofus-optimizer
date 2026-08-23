import { readFile } from 'node:fs/promises';
import { buildParetoChoices } from '../js/pareto-choices.js';
import { pruneDominatedCandidates } from '../js/search-space.js';
import { itemConditionCompatibleWithHardConstraints } from '../js/build-legality.js';

const data = JSON.parse(await readFile(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const constraints = { ap: 12, mp: 6, resEarth: 40, resFire: 40, resWater: 40, resAir: 40 };
const keys = Object.keys(constraints);
const raw = data.items
  .filter((item) => item.slot === 'dofus')
  .filter((item) => itemConditionCompatibleWithHardConstraints(item, constraints, 200));
const pruned = pruneDominatedCandidates(raw, { keys, nonMonotoneKeys: new Set(), groupCount: 6 });
const started = performance.now();
const output = buildParetoChoices(pruned.candidates, 6, keys);
const elapsedMs = Math.round(performance.now() - started);
console.log(JSON.stringify({
  before: raw.length,
  afterCandidatePrune: pruned.candidates.length,
  choices: output.choices.length,
  elapsedMs,
  generated: output.diagnostics.generated,
  partitions: output.diagnostics.partitions,
  partitionProfiles: output.diagnostics.partitionProfiles
}, null, 2));
if (!output.choices.length) throw new Error('Hard-constraint Dofus frontier is empty.');
