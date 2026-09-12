import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const sourceUrl = new URL('./pr120-fire-water-large-architecture-companion-probe.mjs', import.meta.url);
const tempUrl = new URL('./.pr120-fire-water-large-companion-context-rank-probe.tmp.mjs', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');

const extra = String.raw`

const companionRanked = [...companionExpanded].sort(comparePriority);
const bestCompanionByArchitecture = new Map();
for (const state of companionRanked) {
  const key = architectureKey(state);
  if (key && !bestCompanionByArchitecture.has(key)) bestCompanionByArchitecture.set(key, state);
}
const companionArchitectureWinners = [...bestCompanionByArchitecture.values()].sort(comparePriority);
const ownerCompanionWinner = bestCompanionByArchitecture.get(ownerArchitectureKey) || null;
const ownerCompanionWinnerRank = ownerCompanionWinner
  ? companionArchitectureWinners.findIndex((state) => architectureKey(state) === ownerArchitectureKey) + 1
  : null;
const ownerCompanion = ownerCompanionWinner?.items?.find((item) => item.slot === 'companion') || null;
const ownerShield = ownerCompanionWinner?.items?.find((item) => item.slot === 'shield') || null;
console.log('FW_LARGE_COMPANION_ARCH_WINNERS=' + companionArchitectureWinners.length);
console.log('FW_LARGE_OWNER_BEST_AFTER_COMPANION=' + JSON.stringify(ownerCompanionWinner ? {
  rank: ownerCompanionWinnerRank,
  score: ownerCompanionWinner.score,
  shield: ownerShield?.name || null,
  companion: ownerCompanion?.name || null
} : null));
console.log('FW_LARGE_OWNER_AFTER_COMPANION_TOP55=' + (ownerCompanionWinnerRank && ownerCompanionWinnerRank <= 55 ? 'YES' : 'NO'));
console.log('FW_LARGE_OWNER_AFTER_COMPANION_TOP90=' + (ownerCompanionWinnerRank && ownerCompanionWinnerRank <= 90 ? 'YES' : 'NO'));
console.log('FW_LARGE_OWNER_AFTER_COMPANION_TOP260=' + (ownerCompanionWinnerRank && ownerCompanionWinnerRank <= 260 ? 'YES' : 'NO'));

const fixedPackageFinal = [];
for (const state of companionArchitectureWinners) {
  const evaluation = evaluateCompleteEquipmentBuild({
    items: [...state.items, ...ownerDofus],
    sets: dataset.sets,
    constraints,
    fmPolicy,
    syntheticOffense
  });
  if (!evaluation.result) continue;
  fixedPackageFinal.push({ state, result: evaluation.result });
}
fixedPackageFinal.sort((a, b) => Number(b.result.syntheticOffense?.minimumScore || 0) - Number(a.result.syntheticOffense?.minimumScore || 0)
  || Number(b.result.syntheticOffense?.meanScore || 0) - Number(a.result.syntheticOffense?.meanScore || 0)
  || itemKey(a.state.items).localeCompare(itemKey(b.state.items)));
const ownerFixedIndex = fixedPackageFinal.findIndex((row) => architectureKey(row.state) === ownerArchitectureKey);
const ownerFixed = ownerFixedIndex >= 0 ? fixedPackageFinal[ownerFixedIndex] : null;
console.log('FW_LARGE_FIXED_OWNER_PACKAGE_VALID_ARCHITECTURES=' + fixedPackageFinal.length);
console.log('FW_LARGE_OWNER_FIXED_PACKAGE_FINAL=' + JSON.stringify(ownerFixed ? {
  rank: ownerFixedIndex + 1,
  minimumScore: ownerFixed.result.syntheticOffense?.minimumScore,
  meanScore: ownerFixed.result.syntheticOffense?.meanScore,
  shield: ownerFixed.state.items.find((item) => item.slot === 'shield')?.name || null,
  companion: ownerFixed.state.items.find((item) => item.slot === 'companion')?.name || null
} : null));
`;

writeFileSync(tempUrl, source + extra, 'utf8');
try {
  await import(`${tempUrl.href}?v=${Date.now()}`);
} finally {
  try { unlinkSync(tempUrl); } catch {}
}
