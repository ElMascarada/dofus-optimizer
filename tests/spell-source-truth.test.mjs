import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceTruth = JSON.parse(await readFile(new URL('../data/normalized/spell-source-truth.json', import.meta.url), 'utf8'));
const runtimeCatalog = JSON.parse(await readFile(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const syncScript = await readFile(new URL('../scripts/sync-spells.mjs', import.meta.url), 'utf8');

function findSourceSpell(name) {
  return sourceTruth.spells.find((spell) => spell?.text?.nameFr === name) || null;
}

function allSourceEffects(spell, branch = null) {
  return (spell?.levels || []).flatMap((level) => {
    if (branch === 'normal') return level.effects?.normal || [];
    if (branch === 'critical') return level.effects?.critical || [];
    return [...(level.effects?.normal || []), ...(level.effects?.critical || [])];
  });
}

function effectHasMagnitude(effect, expected) {
  return ['diceNum', 'diceSide', 'value']
    .map((key) => Number(effect?.parameters?.[key]))
    .filter(Number.isFinite)
    .some((value) => Math.abs(value) === expected);
}

function labelMatches(effect, regex) {
  return regex.test(String(effect?.labelFr || ''));
}

function findEffect(spell, { branch = null, label, magnitude, duration = undefined } = {}) {
  return allSourceEffects(spell, branch).find((effect) => {
    if (label && !labelMatches(effect, label)) return false;
    if (magnitude != null && !effectHasMagnitude(effect, magnitude)) return false;
    if (duration !== undefined && Number(effect.duration) !== duration) return false;
    return true;
  }) || null;
}

function findRuntimeSpell(name) {
  return runtimeCatalog.spells.find((spell) => spell?.name === name) || null;
}

function modifierStats(spell) {
  return (spell?.combatModifiers || []).flatMap((modifier) => Object.entries(modifier?.stats || {}).map(([stat, value]) => ({
    stat,
    value: Number(value),
    durationTurns: Number(modifier.durationTurns)
  })));
}

test('sync-spells synchronizes every source-truth companion asset from the same release', () => {
  for (const asset of ['spell_pairs.json', 'spell_scripts.json', 'spell_states.json', 'spell_types.json']) {
    assert.match(syncScript, new RegExp(asset.replace('.', '\\.')));
  }
  assert.equal(sourceTruth.semantics.importerActivatesRuntime, false);
  assert.equal(sourceTruth.semantics.unknownEffectsActivateCombat, false);
  assert.equal(sourceTruth.semantics.scriptsOrTriggersInterpretedSilently, false);
  for (const [asset, count] of Object.entries(sourceTruth.coverage.additionalAssetsLoaded || {})) {
    assert.ok(Number(count) > 0, `${asset} must contain source records`);
  }
});

test('Tirs Puissants preserves normal/critical source parity without activating the critical branch', () => {
  const spell = findSourceSpell('Tirs Puissants');
  assert.ok(spell, 'Tirs Puissants must exist in source truth');
  assert.ok(findEffect(spell, { branch: 'normal', label: /puissance/i, magnitude: 250 }), 'normal +250 Puissance missing');
  assert.ok(findEffect(spell, { branch: 'normal', label: /critique/i, magnitude: 15 }), 'normal +15% Critique missing');
  assert.ok(findEffect(spell, { branch: 'critical', label: /puissance/i, magnitude: 300 }), 'critical +300 Puissance missing');
  assert.ok(findEffect(spell, { branch: 'critical', label: /critique/i, magnitude: 17 }), 'critical +17% Critique missing');
  assert.ok(findEffect(spell, { label: /port[ée]e/i, magnitude: 3, duration: 1 }), '-3 Portée duration 1 missing');
  assert.ok(findEffect(spell, { label: /pouss[ée]e/i }), 'push-damage source effect missing');

  const runtime = findRuntimeSpell('Tirs Puissants');
  assert.ok(runtime, 'existing runtime Tirs Puissants missing');
  assert.deepEqual(modifierStats(runtime).sort((a, b) => a.stat.localeCompare(b.stat)), [
    { stat: 'crit', value: 15, durationTurns: 1 },
    { stat: 'power', value: 250, durationTurns: 1 }
  ]);
});

test('Sentinelle preserves source parity and keeps per-PM semantics unresolved', () => {
  const spell = findSourceSpell('Sentinelle');
  assert.ok(spell, 'Sentinelle must exist in source truth');
  assert.ok(findEffect(spell, { label: /dommages?.*distance|distance.*dommages?/i, magnitude: 20, duration: 2 }), '+20% distance damage missing');
  assert.ok(findEffect(spell, { label: /port[ée]e/i, magnitude: 10, duration: 2 }), '+10 Portée missing');
  assert.ok(findEffect(spell, { label: /dommages?.*distance|distance.*dommages?/i, magnitude: 2, duration: 2 }), '-2% distance damage source instance missing');
  assert.ok(findEffect(spell, { label: /port[ée]e/i, magnitude: 1, duration: 2 }), '-1 Portée source instance missing');
  assert.ok(spell.semanticNotes.some((entry) => entry.id === 'per-mp-used-reduction' && entry.status === 'unresolved'));

  const runtime = findRuntimeSpell('Sentinelle');
  assert.ok(runtime, 'existing runtime Sentinelle missing');
  assert.deepEqual(modifierStats(runtime), [{ stat: 'rangedDamagePct', value: 20, durationTurns: 2 }]);
});

test('Tir Perçant is preserved in source truth but remains absent from runtime combat', () => {
  const spell = findSourceSpell('Tir Perçant');
  assert.ok(spell, 'Tir Perçant must exist in source truth');
  assert.ok(spell.text.descriptionFr, 'Tir Perçant description missing');
  assert.ok(spell.levels.some((level) => Number.isFinite(Number(level.casting?.apCost))), 'Tir Perçant AP missing');
  assert.ok(spell.levels.some((level) => Number.isFinite(Number(level.casting?.minRange)) && Number.isFinite(Number(level.casting?.maxRange))), 'Tir Perçant range missing');
  assert.ok(findEffect(spell, { label: /[ée]rosion/i }), 'Tir Perçant erosion missing');
  assert.ok(findEffect(spell, { label: /dommages? subis/i, magnitude: 115 }), 'Tir Perçant x115% damage taken missing');
  assert.ok(allSourceEffects(spell).some((effect) => effect.trigger != null || effect.semanticStatus === 'unresolved'), 'Tir Perçant trigger/unresolved metadata missing');
  assert.ok(spell.semanticNotes.some((entry) => entry.id === 'until-next-attack-consumption' && entry.status === 'unresolved'));
  assert.equal(findRuntimeSpell('Tir Perçant'), null);
});

test('Représailles preserves both branches/state/damage metadata while eroded-HP formula remains unresolved', () => {
  const spell = findSourceSpell('Représailles');
  assert.ok(spell, 'Représailles must exist in source truth');
  assert.ok(allSourceEffects(spell, 'normal').length > 0, 'Représailles normal branch missing');
  assert.ok(allSourceEffects(spell, 'critical').length > 0, 'Représailles critical branch missing');
  assert.ok(findEffect(spell, { label: /dommages? subis/i, magnitude: 110 }), 'Représailles x110% damage taken missing');
  assert.ok(allSourceEffects(spell).some((effect) => /pesanteur/i.test(String(effect.labelFr || '')) || (effect.stateRelations || []).length > 0), 'Représailles Pesanteur/state relation missing');
  assert.ok(spell.semanticNotes.some((entry) => entry.id === 'eroded-hp-formula' && entry.status === 'unresolved'));
  assert.equal(findRuntimeSpell('Représailles'), null);
});

test('coverage distinguishes source absence from present-but-unresolved data', () => {
  assert.ok(sourceTruth.coverage.spellCount > 0);
  assert.ok(sourceTruth.coverage.effectInstanceCount > 0);
  assert.equal(
    sourceTruth.coverage.effectInstanceCount,
    Number(sourceTruth.coverage.runtimeKnownEffectCount) + Number(sourceTruth.coverage.structuralOnlyEffectCount) + Number(sourceTruth.coverage.unresolvedEffectCount)
  );
  assert.ok(sourceTruth.coverage.sourcePresenceStates.includes('ABSENT_FROM_SOURCE'));
  assert.ok(sourceTruth.coverage.sourcePresenceStates.includes('PRESENT_BUT_UNRESOLVED'));
  for (const name of ['Sentinelle', 'Tir Perçant', 'Représailles']) {
    const probe = sourceTruth.coverage.requiredProbes.find((entry) => entry.name === name);
    assert.equal(probe?.status, 'PRESENT_BUT_UNRESOLVED', `${name} must be explicitly present-but-unresolved`);
  }
});
