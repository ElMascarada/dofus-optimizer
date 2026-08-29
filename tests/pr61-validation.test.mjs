import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('validation-only: targeted evaluator test and product smoke', () => {
  const targeted = spawnSync('node', ['--test', 'tests/complete-build-evaluator.test.mjs'], {
    encoding: 'utf8',
    env: process.env
  });
  console.log(`TARGETED_STDOUT_JSON=${JSON.stringify(targeted.stdout || '')}`);
  console.log(`TARGETED_STDERR_JSON=${JSON.stringify(targeted.stderr || '')}`);
  console.log(`TARGETED_EXIT=${targeted.status}`);
  assert.equal(targeted.status, 0, `${targeted.stdout || ''}${targeted.stderr || ''}`);

  const smoke = spawnSync('npm', ['run', 'smoke:product'], {
    encoding: 'utf8',
    env: process.env
  });
  console.log(`SMOKE_STDOUT_JSON=${JSON.stringify(smoke.stdout || '')}`);
  console.log(`SMOKE_STDERR_JSON=${JSON.stringify(smoke.stderr || '')}`);
  console.log(`SMOKE_EXIT=${smoke.status}`);
});
