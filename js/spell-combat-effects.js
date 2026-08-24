function arrayField(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.Array) ? value.Array : [];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function releaseRecords(payload = {}) {
  const refs = arrayField(payload?.references?.RefIds);
  return refs.map((entry) => entry?.data).filter(Boolean);
}

function translationEntries(payload = {}) {
  return payload?.entries && typeof payload.entries === 'object' ? payload.entries : {};
}

export function buildSpellEffectRegistry(effectsPayload = {}, translationsPayload = {}) {
  const translations = translationEntries(translationsPayload);
  const registry = new Map();
  for (const effect of releaseRecords(effectsPayload)) {
    const id = number(effect?.id, -1);
    if (id < 0) continue;
    const description = translations[String(effect?.descriptionId)] || effect?.description || '';
    registry.set(id, {
      id,
      description,
      normalizedDescription: normalizeText(description),
      category: number(effect?.category, -1),
      useInFight: number(effect?.useInFight, 0),
      useDice: number(effect?.useDice, 0)
    });
  }
  return registry;
}

function effectValue(effect = {}) {
  const values = [effect.diceSide, effect.diceNum, effect.value]
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .filter((value) => value !== 0);
  if (!values.length) return 0;
  return Math.max(...values.map(Math.abs));
}

function deterministic(effect = {}) {
  const trigger = String(effect.triggers ?? 'I');
  return trigger === 'I'
    && number(effect.delay, 0) === 0
    && number(effect.random, 0) === 0;
}

function durationTurns(effect = {}) {
  return Math.max(1, number(effect.duration, 0) || 1);
}

function looksNegative(description = '') {
  const text = normalizeText(description);
  return /(?:retire|reduit|diminue|malus|perd|moins|\-\{)/.test(text);
}

function selfTargetLikely(effect = {}, level = {}) {
  const mask = String(effect.targetMask ?? effect.target_mask ?? '');
  if (/c/i.test(mask)) return true;
  const minRange = number(level.minRange, 0);
  return minRange === 0;
}

function statFromDescription(description = '') {
  const text = normalizeText(description);
  if (/dommages critiques?/.test(text)) return 'critDamage';
  if (/(?:%|pourcent).*dommages.*sort|dommages.*sort.*(?:%|pourcent)/.test(text)) return 'spellDamagePct';
  if (/dommages finaux|dommages occasionnes.*%|%.*dommages occasionnes/.test(text)) return 'finalDamagePct';
  if (/puissance/.test(text)) return 'power';
  if (/agilite/.test(text)) return 'air';
  if (/intelligence/.test(text)) return 'fire';
  if (/\bforce\b/.test(text)) return 'earth';
  if (/\bchance\b/.test(text)) return 'water';
  if (/coup critique|critiques?/.test(text)) return 'crit';
  if (/points? d['’ ]?action|\bpa\b/.test(text)) return 'ap';
  if (/points? de mouvement|\bpm\b/.test(text)) return 'mp';
  if (/dommages? air/.test(text)) return 'damageAir';
  if (/dommages? feu/.test(text)) return 'damageFire';
  if (/dommages? eau/.test(text)) return 'damageWater';
  if (/dommages? terre/.test(text)) return 'damageEarth';
  if (/dommages? neutre/.test(text)) return 'damageNeutral';
  return null;
}

function targetModifierFromDescription(description = '', value = 0) {
  const text = normalizeText(description);
  if (!/dommages subis/.test(text)) return null;
  // Ankama can encode either x115% or +15%. Normalize both to +15 final taken.
  const pct = value >= 100 ? value - 100 : value;
  if (!(pct > 0)) return null;
  return { finalDamageTakenPct: pct };
}

function areaHint(effect = {}) {
  const size = Math.max(
    number(effect.zoneSize, 0),
    number(effect.zone_size, 0),
    number(effect.zoneMinSize, 0),
    number(effect.zone_min_size, 0)
  );
  const shape = String(effect.zoneShape ?? effect.zone_shape ?? effect.zone?.shape ?? '').toLowerCase();
  if (size > 0) return true;
  if (shape && !['p', 'point', 'single', 'none'].includes(shape)) return true;
  return false;
}

export function spellAreaHint(effects = []) {
  return arrayField(effects).some(areaHint);
}

export function extractDeterministicCombatModifiers(effects = [], registry = new Map(), level = {}) {
  const modifiers = [];
  const ignored = [];

  for (const effect of arrayField(effects)) {
    if (!deterministic(effect)) continue;
    const effectId = number(effect?.effectId, -1);
    const meta = registry.get(effectId);
    if (!meta?.description) continue;
    const value = effectValue(effect);
    if (!(value > 0)) continue;

    const targetStats = targetModifierFromDescription(meta.description, value);
    if (targetStats) {
      modifiers.push({
        id: `effect-${effectId}-target`,
        scope: 'target',
        stats: targetStats,
        durationTurns: durationTurns(effect),
        stacking: 'replace-source',
        sourceEffectId: effectId,
        description: meta.description
      });
      continue;
    }

    const stat = statFromDescription(meta.description);
    if (!stat || looksNegative(meta.description) || !selfTargetLikely(effect, level)) {
      if (stat) ignored.push({ effectId, description: meta.description, reason: looksNegative(meta.description) ? 'negative' : 'not-self-targeted' });
      continue;
    }

    modifiers.push({
      id: `effect-${effectId}-${stat}`,
      scope: 'self',
      stats: { [stat]: value },
      durationTurns: durationTurns(effect),
      stacking: 'replace-source',
      sourceEffectId: effectId,
      description: meta.description
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const modifier of modifiers) {
    const key = `${modifier.scope}:${modifier.sourceEffectId}:${Object.keys(modifier.stats).join(',')}:${modifier.durationTurns}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(modifier);
  }
  return { modifiers: deduped, ignored };
}
