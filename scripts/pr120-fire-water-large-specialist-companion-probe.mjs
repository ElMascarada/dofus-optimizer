import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const sourceUrl = new URL('./pr120-fire-water-large-architecture-companion-probe.mjs', import.meta.url);
const tempUrl = new URL('./.pr120-fire-water-large-specialist-companion-probe.tmp.mjs', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');

const extra = String.raw`

function exactEquipmentKey(items = []) {
  return itemKey(items.filter((item) => item?.slot !== 'companion' && item?.slot !== 'dofus'));
}

const childrenByArchitecture = new Map();
for (const state of expandedRound0) {
  const key = architectureKey(state);
  if (!key) continue;
  if (!childrenByArchitecture.has(key)) childrenByArchitecture.set(key, []);
  childrenByArchitecture.get(key).push(state);
}

const specialistEquipmentStates = [];
const specialistEquipmentKeys = new Set();
function addEquipmentState(state) {
  if (!state) return;
  const key = itemKey(state.items);
  if (!key || specialistEquipmentKeys.has(key)) return;
  specialistEquipmentKeys.add(key);
  specialistEquipmentStates.push(state);
}

for (const states of childrenByArchitecture.values()) {
  const ranked = [...states].sort(comparePriority);
  addEquipmentState(ranked[0]);
  for (const statKey of specialistKeys) {
    const specialist = [...states]
      .filter((state) => effectiveStat(state.stats || itemStats(state.items, setsById), statKey) > 0)
      .sort((a, b) => effectiveStat(b.stats || itemStats(b.items, setsById), statKey)
        - effectiveStat(a.stats || itemStats(a.items, setsById), statKey)
        || comparePriority(a, b))[0];
    addEquipmentState(specialist);
  }
}

const ownerSpecialistEquipment = specialistEquipmentStates.filter((state) => architectureKey(state) === ownerArchitectureKey);
console.log('FW_LARGE_SPECIALIST_EQUIPMENT_STATES=' + specialistEquipmentStates.length);
console.log('FW_LARGE_SPECIALIST_EQUIPMENT_OWNER_SHIELDS=' + JSON.stringify(ownerSpecialistEquipment.map((state) => state.items.find((item) => item.slot === 'shield')?.name || null)));
console.log('FW_LARGE_SPECIALIST_EQUIPMENT_HAS_CARAPACE=' + (ownerSpecialistEquipment.some((state) => state.items.some((item) => item.slot === 'shield' && item.name === 'Carapace Onance')) ? 'YES' : 'NO'));
console.log('FW_LARGE_SPECIALIST_EQUIPMENT_HAS_QUATRE=' + (ownerSpecialistEquipment.some((state) => state.items.some((item) => item.slot === 'shield' && item.name === 'Quatre-feuilles')) ? 'YES' : 'NO'));

const specialistCompanionRows = [];
for (const state of specialistEquipmentStates) {
  for (const companion of companionPool) {
    const items = [...state.items, companion];
    if (!specialSlotRulesAreValid(items)) continue;
    specialistCompanionRows.push({ ...state, items, ...scoreState(items, prefilter.policy, setsById) });
  }
}
console.log('FW_LARGE_SPECIALIST_COMPANION_EXPANDED=' + specialistCompanionRows.length);

const equipmentParentByKey = new Map(specialistEquipmentStates.map((state) => [itemKey(state.items), state]));
const bestCompanionByEquipment = new Map();
for (const child of [...specialistCompanionRows].sort(comparePriority)) {
  const parentKey = exactEquipmentKey(child.items);
  if (parentKey && !bestCompanionByEquipment.has(parentKey)) bestCompanionByEquipment.set(parentKey, child);
}
const companionMarginalsAll = [...bestCompanionByEquipment.entries()]
  .map(([parentKey, child]) => {
    const parent = equipmentParentByKey.get(parentKey);
    return parent ? { parentKey, parent, child, marginal: Number(child.score || 0) - Number(parent.score || 0) } : null;
  })
  .filter(Boolean)
  .sort((a, b) => b.marginal - a.marginal || comparePriority(a.child, b.child));

function describeOwnerShield(shieldName) {
  const rows = companionMarginalsAll.filter((row) =>
    architectureKey(row.parent) === ownerArchitectureKey
    && row.parent.items.some((item) => item.slot === 'shield' && item.name === shieldName));
  const best = rows[0] || null;
  if (!best) return null;
  const rank = companionMarginalsAll.findIndex((row) => row.parentKey === best.parentKey) + 1;
  const companion = best.child.items.find((item) => item.slot === 'companion');
  return { rank, marginal: best.marginal, parentScore: best.parent.score, childScore: best.child.score, companion: companion?.name || null, top40: rank <= 40, top55: rank <= 55, top65: rank <= 65, top90: rank <= 90 };
}

console.log('FW_LARGE_SPECIALIST_CARAPACE_COMPANION_MARGINAL=' + JSON.stringify(describeOwnerShield('Carapace Onance')));
console.log('FW_LARGE_SPECIALIST_QUATRE_COMPANION_MARGINAL=' + JSON.stringify(describeOwnerShield('Quatre-feuilles')));

const primary55 = retainStates(specialistCompanionRows, 55, context);
const primary65 = retainStates(specialistCompanionRows, 65, context);
const primary90 = retainStates(specialistCompanionRows, 90, context);
function ownerPresence(states) {
  return states
    .filter((state) => architectureKey(state) === ownerArchitectureKey)
    .map((state) => ({
      shield: state.items.find((item) => item.slot === 'shield')?.name || null,
      companion: state.items.find((item) => item.slot === 'companion')?.name || null,
      score: state.score
    }));
}
console.log('FW_LARGE_SPECIALIST_PRIMARY55_OWNER=' + JSON.stringify(ownerPresence(primary55)));
console.log('FW_LARGE_SPECIALIST_PRIMARY65_OWNER=' + JSON.stringify(ownerPresence(primary65)));
console.log('FW_LARGE_SPECIALIST_PRIMARY90_OWNER=' + JSON.stringify(ownerPresence(primary90)));

function combinedRetention(limit, marginalReserve) {
  const primary = retainStates(specialistCompanionRows, limit, context);
  const marginalChildren = companionMarginalsAll.slice(0, Math.max(0, marginalReserve)).map((row) => row.child);
  const selected = [];
  const seen = new Set();
  const add = (state) => {
    if (!state || selected.length >= limit) return;
    const key = itemKey(state.items);
    if (!key || seen.has(key)) return;
    seen.add(key);
    selected.push(state);
  };
  const primaryCount = Math.max(0, limit - marginalChildren.length);
  for (const state of primary.slice(0, primaryCount)) add(state);
  for (const state of marginalChildren) add(state);
  for (const state of primary) add(state);
  return selected;
}

for (const [limit, reserve] of [[55, 40], [65, 40], [65, 50], [90, 50], [90, 65]]) {
  const retained = combinedRetention(limit, reserve);
  console.log('FW_LARGE_SPECIALIST_COMBINED_' + limit + '_' + reserve + '=' + JSON.stringify({ retained: retained.length, owner: ownerPresence(retained) }));
}
`;

writeFileSync(tempUrl, source + extra, 'utf8');
try {
  await import(`${tempUrl.href}?v=${Date.now()}`);
} finally {
  try { unlinkSync(tempUrl); } catch {}
}
