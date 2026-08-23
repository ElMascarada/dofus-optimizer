import test from 'node:test';
import assert from 'node:assert/strict';
import { extractKnownItemPassives, passiveDefinitionForItem } from '../js/dofus-passives.js';
import { applyPassiveModifiers } from '../js/passives.js';

function dynamicEffect({ active = false, meta = false, name = 'Rêve Nébuleux' } = {}) {
  return { type: { id: 2, is_active: active, is_meta: meta, name }, formatted: name };
}

function passiveFor(id) {
  return extractKnownItemPassives({ ankama_id: id }, [dynamicEffect({ meta: true })], []).passives[0];
}

test('Cloudy/Nebulous Dofus is curated by stable Ankama item id', () => {
  const definition = passiveDefinitionForItem({ ankama_id: 8698 });
  assert.equal(definition.id, 'nebulous-dream');
});

test('curated Nebulous rule consumes its dynamic source effect and emits structured passive', () => {
  const result = extractKnownItemPassives({ ankama_id: 8698 }, [dynamicEffect({ meta: true })], []);
  assert.equal(result.kept.length, 0);
  assert.equal(result.consumed.length, 1);
  assert.equal(result.passives[0].rules[0].stats.finalDamagePct, 20);
  assert.equal(result.passives[0].rules[1].stats.finalDamagePct, -10);
});

test('Pourpre and Turquoise use explicit stack context capped at 10%', () => {
  assert.equal(applyPassiveModifiers({}, [passiveFor(694)], { turn: 1, pourpreStacks: 8 }).stats.finalDamagePct, 8);
  assert.equal(applyPassiveModifiers({}, [passiveFor(739)], { turn: 1, turquoiseStacks: 15 }).stats.finalDamagePct, 10);
});

test('Vulbis and Ocre switch according to attacks received since previous turn', () => {
  const vulbis = passiveFor(6980);
  const ochre = passiveFor(7754);
  assert.equal(applyPassiveModifiers({}, [vulbis], { turn: 2, attackedSinceLastTurn: false }).stats.finalDamagePct, 10);
  assert.equal(applyPassiveModifiers({}, [vulbis], { turn: 2, attackedSinceLastTurn: true }).stats.lock, 20);
  assert.equal(applyPassiveModifiers({}, [ochre], { turn: 2, attackedSinceLastTurn: false }).stats.ap, 1);
  assert.equal(applyPassiveModifiers({}, [ochre], { turn: 2, attackedSinceLastTurn: true }).stats.dodge, 20);
});

test('Abyssal switches between MP and AP based on adjacency', () => {
  const abyssal = passiveFor(18043);
  assert.equal(applyPassiveModifiers({}, [abyssal], { turn: 1, enemyAdjacent: false }).stats.mp, 1);
  assert.equal(applyPassiveModifiers({}, [abyssal], { turn: 1, enemyAdjacent: true }).stats.ap, 1);
});

test('Dofusteuse rotates 400 Chance, Force, Agility, Intelligence by turn', () => {
  const dofusteuse = passiveFor(958);
  assert.equal(applyPassiveModifiers({}, [dofusteuse], { turn: 1 }).stats.water, 400);
  assert.equal(applyPassiveModifiers({}, [dofusteuse], { turn: 2 }).stats.earth, 400);
  assert.equal(applyPassiveModifiers({}, [dofusteuse], { turn: 3 }).stats.air, 400);
  assert.equal(applyPassiveModifiers({}, [dofusteuse], { turn: 4 }).stats.fire, 400);
});

test('Trompe-la-Mort exposes HP-dependent offensive and defensive branches', () => {
  const trompe = passiveFor(20358);
  assert.equal(applyPassiveModifiers({}, [trompe], { turn: 1, hpPct: 80 }).stats.finalDamagePct, 7);
  assert.equal(applyPassiveModifiers({}, [trompe], { turn: 1, hpPct: 40 }).stats.incomingDamageReductionPct, 20);
});

test('Pryssion variants trade final damage for temporary AP on their exact turns', () => {
  const matteT3 = applyPassiveModifiers({}, [passiveFor(21996)], { turn: 3 }).stats;
  assert.equal(matteT3.ap, 1);
  assert.equal(matteT3.finalDamagePct, -10);
  assert.equal(applyPassiveModifiers({}, [passiveFor(21996)], { turn: 4 }).stats.ap, undefined);

  const brightT2 = applyPassiveModifiers({}, [passiveFor(21997)], { turn: 2 }).stats;
  assert.equal(brightT2.ap, 2);
  assert.equal(brightT2.finalDamagePct, -35);
  assert.equal(applyPassiveModifiers({}, [passiveFor(21997)], { turn: 3 }).stats.ap, undefined);

  const iridescentT1 = applyPassiveModifiers({}, [passiveFor(21998)], { turn: 1 }).stats;
  assert.equal(iridescentT1.ap, 3);
  assert.equal(iridescentT1.finalDamagePct, -50);
  assert.equal(applyPassiveModifiers({}, [passiveFor(21998)], { turn: 2 }).stats.ap, undefined);
});

test('Surpryz applies its deterministic critical bonuses on T1, T2 and T3', () => {
  const surpryz = passiveFor(22001);
  assert.equal(applyPassiveModifiers({}, [surpryz], { turn: 1 }).stats.crit, 100);
  assert.equal(applyPassiveModifiers({}, [surpryz], { turn: 2 }).stats.crit, 35);
  assert.equal(applyPassiveModifiers({}, [surpryz], { turn: 3 }).stats.crit, 15);
  assert.equal(applyPassiveModifiers({}, [surpryz], { turn: 4 }).stats.crit, undefined);
});

test('Prynyang applies final-damage and all-element resistance trades per turn', () => {
  const prynyang = passiveFor(22004);
  const t1 = applyPassiveModifiers({}, [prynyang], { turn: 1 }).stats;
  assert.equal(t1.finalDamagePct, 10);
  assert.deepEqual([t1.resEarth, t1.resFire, t1.resWater, t1.resAir], [-10, -10, -10, -10]);

  const t2 = applyPassiveModifiers({}, [prynyang], { turn: 2 }).stats;
  assert.equal(t2.finalDamagePct, 3);
  assert.deepEqual([t2.resEarth, t2.resFire, t2.resWater, t2.resAir], [3, 3, 3, 3]);

  const t3 = applyPassiveModifiers({}, [prynyang], { turn: 3 }).stats;
  assert.equal(t3.finalDamagePct, -10);
  assert.deepEqual([t3.resEarth, t3.resFire, t3.resWater, t3.resAir], [10, 10, 10, 10]);
});

test('Ratrapry grants one temporary MP per far enemy, capped at three on each of T1-T3', () => {
  const ratrapry = passiveFor(22007);
  assert.equal(applyPassiveModifiers({}, [ratrapry], { turn: 1, farEnemiesOver9: 2 }).stats.mp, 2);
  assert.equal(applyPassiveModifiers({}, [ratrapry], { turn: 2, farEnemiesOver9: 9 }).stats.mp, 3);
  assert.equal(applyPassiveModifiers({}, [ratrapry], { turn: 4, farEnemiesOver9: 3 }).stats.mp, undefined);
  assert.deepEqual(
    applyPassiveModifiers({}, [ratrapry], { turn: 1 }).unresolved[0].missingKeys,
    ['farEnemiesOver9']
  );
});

test('Prycipithon variants grant T1 AP and preserve their MP sacrifices', () => {
  const matte = applyPassiveModifiers({}, [passiveFor(22011)], { turn: 1 }).stats;
  assert.equal(matte.ap, 2);
  assert.equal(matte.mp, undefined);

  const bright = applyPassiveModifiers({}, [passiveFor(22012)], { turn: 1 }).stats;
  assert.equal(bright.ap, 3);
  assert.equal(bright.mp, -2);

  const iridescent = applyPassiveModifiers({}, [passiveFor(22013)], { turn: 1 }).stats;
  assert.equal(iridescent.ap, 4);
  assert.equal(iridescent.mp, -4);
  assert.equal(applyPassiveModifiers({}, [passiveFor(22013)], { turn: 2 }).stats.ap, undefined);
});

test('Pryximite adds 2% melee damage for every nearby-enemy trigger at start and end of T1 through T3', () => {
  const pryximite = passiveFor(22023);
  const context = { pryximiteNearbyEnemiesStartT1: 2, pryximiteNearbyEnemiesEndT1: 3 };
  assert.equal(applyPassiveModifiers({}, [pryximite], { turn: 1, ...context }).stats.meleeDamagePct, 10);
  assert.equal(applyPassiveModifiers({}, [pryximite], { turn: 2, ...context }).stats.meleeDamagePct, 10);
  assert.equal(applyPassiveModifiers({}, [pryximite], { turn: 3, ...context }).stats.meleeDamagePct, 10);
  assert.equal(applyPassiveModifiers({}, [pryximite], { turn: 4, ...context }).stats.meleeDamagePct, undefined);
  assert.deepEqual(
    applyPassiveModifiers({}, [pryximite], { turn: 1 }).unresolved[0].missingKeys.sort(),
    ['pryximiteNearbyEnemiesEndT1', 'pryximiteNearbyEnemiesStartT1']
  );
});
