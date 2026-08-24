function score(build) {
  const value = Number(build?.score || 0);
  return Number.isFinite(value) ? value : 0;
}

function itemIds(build, { includeDofus = true } = {}) {
  return (build?.items || [])
    .filter((item) => includeDofus || item?.slot !== 'dofus')
    .map((item) => String(item.id));
}

function multisetDifferenceCount(aIds = [], bIds = []) {
  const remaining = new Map();
  for (const id of bIds) remaining.set(id, (remaining.get(id) || 0) + 1);
  let shared = 0;
  for (const id of aIds) {
    const count = remaining.get(id) || 0;
    if (count <= 0) continue;
    shared++;
    remaining.set(id, count - 1);
  }
  return Math.max(aIds.length, bIds.length) - shared;
}

export function coreDifferenceCount(a, b) {
  return multisetDifferenceCount(
    itemIds(a, { includeDofus: false }),
    itemIds(b, { includeDofus: false })
  );
}

export function prysmaraditeKey(build) {
  const item = (build?.items || []).find((entry) => entry?.slotSubtype === 'prysmaradite');
  return item ? String(item.id) : 'none';
}

function uniqueByResultKey(builds = []) {
  const seen = new Set();
  const output = [];
  for (const build of [...builds].sort((a, b) => score(b) - score(a))) {
    const key = itemIds(build).sort().join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(build);
  }
  return output;
}

function takePrysmaVariants(builds, limit) {
  const selected = [];
  const usedPrysmas = new Set();
  for (const build of builds) {
    const key = prysmaraditeKey(build);
    if (usedPrysmas.has(key)) continue;
    usedPrysmas.add(key);
    selected.push(build);
    if (selected.length >= limit) return selected;
  }

  // If the candidate bench contains fewer distinct Prysmaradites than requested,
  // fill the tail by score instead of returning a mysteriously short list.
  for (const build of builds) {
    if (selected.includes(build)) continue;
    selected.push(build);
    if (selected.length >= limit) break;
  }
  return selected;
}

function takeDifferentGear(builds, limit, requestedMinimum = 3) {
  const selected = [];
  const used = new Set();

  for (let minimum = requestedMinimum; minimum >= 1 && selected.length < limit; minimum--) {
    for (const build of builds) {
      if (used.has(build)) continue;
      if (selected.length && !selected.every((other) => coreDifferenceCount(build, other) >= minimum)) continue;
      selected.push(build);
      used.add(build);
      if (selected.length >= limit) break;
    }
  }

  for (const build of builds) {
    if (used.has(build)) continue;
    selected.push(build);
    used.add(build);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function diversifyBuilds(builds = [], mode = 'gear', limit = 10) {
  const ranked = uniqueByResultKey(builds);
  const cap = Math.max(1, Number(limit || 10));
  if (mode === 'score') return ranked.slice(0, cap);
  if (mode === 'prysma') return takePrysmaVariants(ranked, cap);
  if (mode === 'gear-4') return takeDifferentGear(ranked, cap, 4);
  return takeDifferentGear(ranked, cap, 3);
}
