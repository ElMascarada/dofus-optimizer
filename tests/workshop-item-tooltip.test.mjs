import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderWorkshopItemTooltip } from '../js/workshop/equipment-grid.js';

test('Workshop item tooltip renders every non-zero numeric stat', () => {
  const html = renderWorkshopItemTooltip({
    id: 'tooltip-item',
    name: 'Item Tooltip',
    stats: {
      fire: 120,
      critDamage: 18,
      rangedDamagePct: 6,
      rangedResistancePct: -6,
      mp: 0
    }
  }, 'tooltip-test');

  assert.match(html, /id="tooltip-test"/);
  assert.match(html, /role="tooltip"/);
  assert.match(html, /Item Tooltip/);
  assert.match(html, /Intelligence/);
  assert.match(html, /\+120/);
  assert.match(html, /Do Crit/);
  assert.match(html, /\+18/);
  assert.match(html, /% Do Distance/);
  assert.match(html, /\+6%/);
  assert.match(html, /-6%/);
  assert.doesNotMatch(html, />PM</);
});

test('Workshop tooltip is revealed above sibling cells and is not clipped by the professional panel', async () => {
  const [css, professional] = await Promise.all([
    readFile(new URL('../styles-workshop.css', import.meta.url), 'utf8'),
    readFile(new URL('../styles-product-professional.css', import.meta.url), 'utf8')
  ]);

  assert.match(css, /\.workshop-slot:hover \.workshop-item-tooltip/);
  assert.match(css, /\.workshop-slot:focus-within \.workshop-item-tooltip/);
  assert.match(css, /\.workshop-equipment-grid \{[\s\S]*?position:\s*relative/);
  assert.match(css, /\.workshop-slot:hover,[\s\S]*?\.workshop-slot:focus-within \{[\s\S]*?z-index:\s*50/);
  assert.match(css, /\.workshop-item-tooltip \{[\s\S]*?left:\s*calc\(100% \+ 8px\)[\s\S]*?top:\s*0/);
  assert.match(css, /\.workshop-item-tooltip \{[\s\S]*?background:\s*#34312d/);
  assert.match(css, /\.workshop-item-tooltip \{[\s\S]*?color:\s*#f4ead7/);
  assert.match(css, /\.workshop-item-tooltip \{[\s\S]*?border-radius:\s*14px/);
  assert.match(css, /\.workshop-item-tooltip \{[\s\S]*?box-shadow:[\s\S]*?rgba\(0, 0, 0, \.34\)/);
  assert.match(css, /\.workshop-item-tooltip-stat small \{[\s\S]*?color:\s*#d8cdbb/);
  assert.match(css, /\.workshop-item-tooltip-stat b \{[\s\S]*?color:\s*#f4ead7/);
  assert.match(css, /\.workshop-item-tooltip-grid/);

  assert.match(
    professional,
    /#workshop-view \.workshop-equipment-panel \{[\s\S]*?overflow:\s*visible/
  );
  assert.match(
    professional,
    /#workshop-view \.workshop-slot:hover,[\s\S]*?#workshop-view \.workshop-slot:focus-within \{[\s\S]*?z-index:\s*50/
  );
});
