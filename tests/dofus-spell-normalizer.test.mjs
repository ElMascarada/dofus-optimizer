import test from 'node:test';
import assert from 'node:assert/strict';
import { auditFixedDamageRegistry, normalizeDofusSpellCatalog } from '../js/dofus-spell-normalizer.js';

function payload(className, rows) {
  return {
    references: {
      RefIds: rows.map((data, index) => ({ rid: index + 1, type: { class: className }, data }))
    }
  };
}

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

function effectRegistry() {
  const entries = {};
  const records = Object.entries(labels).map(([idText, label]) => {
    const id = Number(idText);
    const descriptionId = 100000 + id;
    entries[String(descriptionId)] = label;
    return { id, category: 2, useInFight: 1, useDice: 1, active: 0, descriptionId };
  });
  return { effectsPayload: payload('EffectData', records), entries };
}

function damage(effectId, min, max, extra = {}) {
  return {
    effectId,
    diceNum: min,
    diceSide: max,
    value: 0,
    triggers: 'I',
    duration: 0,
    delay: 0,
    random: 0,
    order: 0,
    ...extra
  };
}

function baseSource({ effects, criticalEffect, criticalHitProbability = 20 }) {
  const { effectsPayload, entries } = effectRegistry();
  entries['685'] = 'Féca';
  entries['921278'] = 'Retour du Bâton';
  return {
    spellsPayload: payload('SpellData', [{
      id: 12983,
      nameId: 921278,
      iconId: 12145,
      order: 1,
      spellLevels: { Array: [41048, 41050] }
    }]),
    levelsPayload: payload('SpellLevelData', [
      {
        id: 41048,
        spellId: 12983,
        grade: 1,
        minPlayerLevel: 1,
        apCost: 3,
        criticalHitProbability,
        minRange: 1,
        range: 2,
        maxCastPerTurn: 3,
        maxCastPerTarget: 2,
        effects: { Array: [damage(97, 10, 12)] },
        criticalEffect: { Array: [damage(97, 12, 14)] }
      },
      {
        id: 41050,
        spellId: 12983,
        grade: 3,
        minPlayerLevel: 132,
        apCost: 3,
        criticalHitProbability,
        minRange: 1,
        range: 4,
        maxCastPerTurn: 3,
        maxCastPerTarget: 2,
        effects: { Array: effects },
        criticalEffect: { Array: criticalEffect }
      }
    ]),
    variantsPayload: payload('SpellVariantData', []),
    breedsPayload: payload('BreedData', [{
      id: 1,
      sortIndex: 1,
      shortNameId: '685',
      breedSpellsId: { Array: [12983] }
    }]),
    effectsPayload,
    translationsPayload: { entries },
    gameVersion: { version: '3.6.10.10' },
    generatedAt: '2026-08-06T00:00:00Z'
  };
}

test('audited fixed damage registry matches the current direct elemental families', () => {
  const { effectsPayload, entries } = effectRegistry();
  assert.deepEqual(auditFixedDamageRegistry(effectsPayload, { entries }), { valid: true, errors: [] });
});

test('normalizes the highest level-200 direct spell with paired critical damage', () => {
  const catalog = normalizeDofusSpellCatalog(baseSource({
    effects: [damage(97, 29, 33)],
    criticalEffect: [damage(97, 35, 40)]
  }));
  assert.equal(catalog.spells.length, 1);
  const spell = catalog.spells[0];
  assert.equal(spell.name, 'Retour du Bâton');
  assert.equal(spell.breedName, 'Féca');
  assert.equal(spell.levelId, 41050);
  assert.equal(spell.apCost, 3);
  assert.equal(spell.baseCritPct, 20);
  assert.deepEqual(spell.distanceOptions, ['melee', 'ranged']);
  assert.deepEqual(spell.hits, [{ element: 'earth', normal: [29, 33], crit: [35, 40] }]);
});

test('adds offensive spells referenced only by the class variant dataset', () => {
  const source = baseSource({
    effects: [damage(97, 29, 33)],
    criticalEffect: [damage(97, 35, 40)]
  });
  source.translationsPayload.entries['921279'] = 'Variante Offensive';
  source.spellsPayload.references.RefIds.push({
    rid: 99,
    type: { class: 'SpellData' },
    data: {
      id: 12984,
      nameId: 921279,
      iconId: 12146,
      order: 2,
      spellLevels: { Array: [41051] }
    }
  });
  source.levelsPayload.references.RefIds.push({
    rid: 99,
    type: { class: 'SpellLevelData' },
    data: {
      id: 41051,
      spellId: 12984,
      grade: 3,
      minPlayerLevel: 150,
      apCost: 4,
      criticalHitProbability: 10,
      minRange: 3,
      range: 6,
      maxCastPerTurn: 2,
      maxCastPerTarget: 2,
      effects: { Array: [damage(99, 40, 44)] },
      criticalEffect: { Array: [damage(99, 46, 50)] }
    }
  });
  source.variantsPayload = payload('SpellVariantData', [{
    id: 501,
    breedId: 1,
    spellIds: { Array: [12983, 12984] }
  }]);

  const catalog = normalizeDofusSpellCatalog(source);
  assert.equal(catalog.spells.length, 2);
  assert.deepEqual(catalog.breeds[0].spellIds, ['spell-12983', 'spell-12984']);
  assert.equal(catalog.breeds[0].sourceSpellCount, 2);
  assert.equal(catalog.coverage.variantSpellRefs, 1);
  const variant = catalog.spells.find((spell) => spell.id === 'spell-12984');
  assert.equal(variant.name, 'Variante Offensive');
  assert.equal(variant.isVariant, true);
  assert.deepEqual(variant.distanceOptions, ['ranged']);
});

test('supports fixed-element life steal as damage while ignoring its healing side', () => {
  const catalog = normalizeDofusSpellCatalog(baseSource({
    effects: [damage(91, 20, 24)],
    criticalEffect: [damage(91, 24, 28)]
  }));
  assert.equal(catalog.spells[0].hits[0].element, 'water');
  assert.deepEqual(catalog.spells[0].hits[0].normal, [20, 24]);
});

test('excludes delayed or best-element damage instead of approximating it', () => {
  const delayed = normalizeDofusSpellCatalog(baseSource({
    effects: [damage(97, 20, 24, { duration: 2 })],
    criticalEffect: [damage(97, 24, 28, { duration: 2 })]
  }));
  assert.equal(delayed.spells.length, 0);
  assert.equal(delayed.coverage.skipped['conditional-or-delayed-damage'], 1);

  const best = baseSource({
    effects: [{ ...damage(2822, 20, 24) }],
    criticalEffect: [{ ...damage(2822, 24, 28) }]
  });
  const bestCatalog = normalizeDofusSpellCatalog(best);
  assert.equal(bestCatalog.spells.length, 0);
  assert.equal(bestCatalog.coverage.skipped['best-element-damage'], 1);
});

test('rejects a critical layout whose elements do not match normal hits', () => {
  const catalog = normalizeDofusSpellCatalog(baseSource({
    effects: [damage(97, 20, 24)],
    criticalEffect: [damage(99, 24, 28)]
  }));
  assert.equal(catalog.spells.length, 0);
  assert.equal(catalog.coverage.skipped['critical-element-mismatch'], 1);
});
