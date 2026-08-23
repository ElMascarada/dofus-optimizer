import test from 'node:test';
import assert from 'node:assert/strict';
import { extractKnownItemPassives, passiveDefinitionForItem } from '../js/dofus-passives.js';

function dynamicEffect({ active = false, meta = false, name = 'Rêve Nébuleux' } = {}) {
  return { type: { id: 2, is_active: active, is_meta: meta, name }, formatted: name };
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
