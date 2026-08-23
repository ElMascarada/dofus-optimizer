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
