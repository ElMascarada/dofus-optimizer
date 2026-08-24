import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDofusSpellCatalog } from '../js/dofus-spell-normalizer.js';

function payload(className, rows) {
  return {
    references: {
      RefIds: rows.map((data, index) => ({ rid: index + 1, type: { class: className }, data }))
    }
  };
}

function damage(effectId, min, max) {
  return {
    effectId,
    diceNum: min,
    diceSide: max,
    value: 0,
    triggers: 'I',
    duration: 0,
    delay: 0,
    random: 0,
    order: 0
  };
}

function fixedDamageRegistry(entries) {
  const labels = {
    91: '1 à 2 vol Eau',
    92: '1 à 2 vol Terre',
    93: '1 à 2 vol Air',
    94: '1 à 2 vol Feu',
    95: '1 à 2 vol Neutre',
    96: '1 à 2 dommages Eau',
    97: '1 à 2 dommages Terre',
    98: '1 à 2 dommages Air',
    99: '1 à 2 dommages Feu',
    100: '1 à 2 dommages Neutre'
  };
  const effects = Object.entries(labels).map(([idText, label]) => {
    const id = Number(idText);
    const descriptionId = 100000 + id;
    entries[String(descriptionId)] = label;
    return { id, descriptionId, category: 2, useInFight: 1, useDice: 1 };
  });
  return effects;
}

test('keeps an offensive base spell and a support-only class variant with a Power buff', () => {
  const entries = {
    685: 'Iop',
    900001: 'Attaque test',
    900002: 'Puissance test',
    950000: 'Augmente la Puissance de 200'
  };
  const effects = fixedDamageRegistry(entries);
  effects.push({ id: 5000, descriptionId: 950000, category: 1, useInFight: 1, useDice: 1 });

  const catalog = normalizeDofusSpellCatalog({
    spellsPayload: payload('SpellData', [
      { id: 1001, nameId: 900001, iconId: 1, order: 1, spellLevels: { Array: [2001] } },
      { id: 1002, nameId: 900002, iconId: 2, order: 2, spellLevels: { Array: [2002] } }
    ]),
    levelsPayload: payload('SpellLevelData', [
      {
        id: 2001,
        spellId: 1001,
        grade: 3,
        minPlayerLevel: 200,
        apCost: 4,
        criticalHitProbability: 0,
        minRange: 1,
        range: 4,
        maxCastPerTurn: 2,
        maxCastPerTarget: 2,
        effects: { Array: [damage(98, 30, 30)] },
        criticalEffect: { Array: [] }
      },
      {
        id: 2002,
        spellId: 1002,
        grade: 3,
        minPlayerLevel: 200,
        apCost: 2,
        criticalHitProbability: 0,
        minRange: 0,
        range: 0,
        maxCastPerTurn: 1,
        maxCastPerTarget: 1,
        effects: { Array: [{
          effectId: 5000,
          value: 200,
          diceNum: 0,
          diceSide: 0,
          triggers: 'I',
          duration: 2,
          delay: 0,
          random: 0,
          targetMask: 'C',
          order: 0
        }] },
        criticalEffect: { Array: [] }
      }
    ]),
    variantsPayload: payload('SpellVariantData', [{
      id: 1,
      breedId: 8,
      spellIds: { Array: [1001, 1002] }
    }]),
    breedsPayload: payload('BreedData', [{
      id: 8,
      sortIndex: 1,
      shortNameId: 685,
      breedSpellsId: { Array: [1001] }
    }]),
    effectsPayload: payload('EffectData', effects),
    translationsPayload: { entries },
    gameVersion: { version: 'test' },
    generatedAt: '2026-08-24T00:00:00Z',
    characterLevel: 200
  });

  assert.equal(catalog.spells.length, 2);
  assert.equal(catalog.coverage.variantSpellRefs, 1);
  assert.equal(catalog.coverage.variantsCertified, 1);
  assert.equal(catalog.coverage.supportOnly, 1);
  assert.equal(catalog.coverage.combatModifierSpells, 1);

  const support = catalog.spells.find((spell) => spell.id === 'spell-1002');
  assert.ok(support);
  assert.equal(support.name, 'Puissance test');
  assert.equal(support.isVariant, true);
  assert.equal(support.supportOnly, true);
  assert.deepEqual(support.hits, []);
  assert.deepEqual(support.combatModifiers[0].stats, { power: 200 });
  assert.equal(support.combatModifiers[0].durationTurns, 2);
});
