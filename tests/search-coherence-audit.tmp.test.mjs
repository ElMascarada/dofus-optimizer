import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));

function initiativeSpecialists() {
  return (dataset.items || [])
    .filter((item) => item?.slot === 'dofus' && Number(item?.stats?.initiative || 0) >= 500)
    .map((item) => ({
      id: item.id,
      name: item.name,
      typeName: item.typeName,
      setId: item.setId,
      stats: item.stats,
      conditions: item.conditions,
      certified: item.certified
    }))
    .sort((a, b) => Number(b.stats.initiative || 0) - Number(a.stats.initiative || 0));
}

test('temporary search coherence audit diagnostics', () => {
  console.log('SEARCH_COHERENCE_AUDIT_SPECIALISTS_BEGIN');
  console.log(JSON.stringify(initiativeSpecialists(), null, 2));
  console.log('SEARCH_COHERENCE_AUDIT_SPECIALISTS_END');

  const candidate = execFileSync(process.execPath, ['scripts/benchmark-candidate-search.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024
  });
  console.log(candidate.trim());

  const baseline = execFileSync(process.execPath, ['scripts/benchmark-v2-baseline.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024
  });
  console.log(baseline.trim());
});
