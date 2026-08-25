import { CombatEffectType, spellCombatEffects } from './combat/effects.js';

export const SpellSupportStatus = Object.freeze({
  FULL: 'FULL',
  PARTIAL: 'PARTIAL',
  CURATED: 'CURATED',
  UNSUPPORTED: 'UNSUPPORTED'
});

const VALID = new Set(Object.values(SpellSupportStatus));
const ACTION_EFFECTS = new Set([
  CombatEffectType.DAMAGE,
  CombatEffectType.STAT_MODIFIER,
  CombatEffectType.TARGET_MODIFIER,
  CombatEffectType.DELAYED_EFFECT,
  CombatEffectType.SPELL_CHARGE,
  CombatEffectType.STATE,
  CombatEffectType.CONSUME_STATE,
  CombatEffectType.CONDITIONAL
]);

function hasActionableEffect(spell = {}) {
  try {
    return spellCombatEffects(spell).some((effect) => ACTION_EFFECTS.has(effect.type));
  } catch {
    return false;
  }
}

export function classifySpellSupport(spell = {}) {
  const explicit = String(spell.supportStatus || '').toUpperCase();
  if (VALID.has(explicit)) {
    return { status: explicit, reason: spell.supportReason || null };
  }
  if (spell.unsupportedReason) {
    return { status: SpellSupportStatus.UNSUPPORTED, reason: String(spell.unsupportedReason) };
  }
  if (spell.curatedCombatRule || spell.curatedDamageRule) {
    return {
      status: SpellSupportStatus.CURATED,
      reason: spell.curatedCombatRule || spell.curatedDamageRule
    };
  }
  const ignored = Math.max(0, Number(spell.combatModifierCoverage?.ignored || 0));
  if (hasActionableEffect(spell) && ignored > 0) {
    return { status: SpellSupportStatus.PARTIAL, reason: `${ignored} contextual effect(s) ignored` };
  }
  if (hasActionableEffect(spell)) {
    return { status: SpellSupportStatus.FULL, reason: null };
  }
  return { status: SpellSupportStatus.UNSUPPORTED, reason: 'no-supported-runtime-effect' };
}

export function withSpellSupport(spell = {}) {
  const support = classifySpellSupport(spell);
  return { ...spell, supportStatus: support.status, supportReason: support.reason };
}

function emptyCounts() {
  return {
    FULL: 0,
    PARTIAL: 0,
    CURATED: 0,
    UNSUPPORTED: 0
  };
}

export function buildSpellSupportReport({ spells = [], breeds = [] } = {}) {
  const supportedSpells = (spells || []).map(withSpellSupport);
  const byBreedId = new Map();
  for (const spell of supportedSpells) {
    const key = String(spell.breedId || spell.breedAnkamaId || 'unknown');
    if (!byBreedId.has(key)) byBreedId.set(key, []);
    byBreedId.get(key).push(spell);
  }

  const rows = [];
  const totals = emptyCounts();
  for (const breed of breeds || []) {
    const keys = [String(breed.id || ''), String(breed.ankamaId ?? '')].filter(Boolean);
    const breedSpells = [...new Set(keys.flatMap((key) => byBreedId.get(key) || []))];
    const counts = emptyCounts();
    const entries = breedSpells.map((spell) => {
      const support = classifySpellSupport(spell);
      counts[support.status]++;
      return {
        id: spell.id,
        ankamaId: spell.ankamaId ?? null,
        name: spell.name,
        status: support.status,
        reason: support.reason
      };
    });
    const sourceSpellCount = Math.max(entries.length, Number(breed.sourceSpellCount || entries.length));
    const missingUnsupported = Math.max(0, sourceSpellCount - entries.length);
    counts.UNSUPPORTED += missingUnsupported;
    for (const status of Object.keys(totals)) totals[status] += counts[status];
    rows.push({
      breedId: breed.id,
      breedAnkamaId: breed.ankamaId ?? null,
      name: breed.name,
      sourceSpellCount,
      runtimeSpellCount: entries.length,
      missingUnsupported,
      counts,
      spells: entries
    });
  }

  const assignedIds = new Set(rows.flatMap((row) => row.spells.map((spell) => String(spell.id))));
  const unassigned = supportedSpells.filter((spell) => !assignedIds.has(String(spell.id)));
  if (unassigned.length) {
    const counts = emptyCounts();
    const entries = unassigned.map((spell) => {
      const support = classifySpellSupport(spell);
      counts[support.status]++;
      totals[support.status]++;
      return { id: spell.id, ankamaId: spell.ankamaId ?? null, name: spell.name, status: support.status, reason: support.reason };
    });
    rows.push({
      breedId: 'unknown',
      breedAnkamaId: null,
      name: 'Unknown',
      sourceSpellCount: entries.length,
      runtimeSpellCount: entries.length,
      missingUnsupported: 0,
      counts,
      spells: entries
    });
  }

  return {
    statuses: [...VALID],
    totals,
    classes: rows,
    runtimeSpellCount: supportedSpells.length,
    sourceSpellCount: rows.reduce((sum, row) => sum + row.sourceSpellCount, 0)
  };
}
