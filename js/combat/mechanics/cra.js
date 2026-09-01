const SPELLS = Object.freeze({
  ABOLITION: 32453
});

function spellMatcher(ankamaId) {
  return { spellIds: [`spell-${ankamaId}`] };
}

function cloneHit(hit = {}) {
  return {
    ...hit,
    normal: [...(hit.normal || [])],
    crit: [...(hit.crit || hit.normal || [])]
  };
}

function sameRange(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && Number(left[0]) === Number(right[0])
    && Number(left[1]) === Number(right[1]);
}

function sameHitShape(left = {}, right = {}) {
  return left.element === right.element
    && sameRange(left.normal, right.normal)
    && sameRange(left.crit ?? left.normal, right.crit ?? right.normal);
}

function abolition(spell) {
  const hits = Array.isArray(spell.hits) ? spell.hits : [];
  // Source truth 32453 exposes each real target hit as one default line followed
  // by two state-conditioned alternatives. The generic normalizer flattens all
  // three variants, so only the first hit of each certified triplet is a normal-
  // target damage line.
  const triplets = [hits.slice(0, 3), hits.slice(3, 6)];
  const sourceShapeMatches = hits.length === 6
    && triplets.every((group) => group.length === 3
      && group.slice(1).every((hit) => sameHitShape(group[0], hit)));
  if (!sourceShapeMatches) return spell;

  return {
    ...spell,
    hits: [hits[0], hits[3]].map(cloneHit),
    curatedDamageRule: 'exclude-state-conditional-secondary-hits'
  };
}

export const craMechanics = Object.freeze([
  Object.freeze({
    id: 'cra-abolition-normal-target',
    matcher: spellMatcher(SPELLS.ABOLITION),
    prepareSpell: abolition
  })
]);
