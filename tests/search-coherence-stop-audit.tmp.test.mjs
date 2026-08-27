import test from 'node:test';

test('temporary browser stop A/B audit', async () => {
  await import(`../scripts/search-coherence-stop-audit.tmp.mjs?run=${Date.now()}`);
});
