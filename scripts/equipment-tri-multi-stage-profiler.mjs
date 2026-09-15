import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const selectedCase = String(process.argv[2] || '').trim().toLowerCase();
const seconds = Math.max(5, Number(process.argv[3] || 30));
if (!['tri', 'multi'].includes(selectedCase)) {
  console.error(`USAGE=node ${fileURLToPath(import.meta.url)} <tri|multi> [seconds]`);
  process.exitCode = 64;
} else {
  const probePath = fileURLToPath(new URL('./equipment-tri-multi-stall-probe.mjs', import.meta.url));
  const profileDir = join(tmpdir(), `dofus-${selectedCase}-stage-profile-${process.pid}`);
  const profileName = `${selectedCase}.cpuprofile`;
  const profilePath = join(profileDir, profileName);
  rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });

  console.log(`PROFILE_CASE=${selectedCase}`);
  console.log(`PROFILE_SECONDS=${seconds}`);
  console.log(`PROFILE_PATH=${profilePath}`);
  console.log('PROFILE_CHILD_BEGIN=1');

  const child = spawn(process.execPath, [
    '--cpu-prof',
    `--cpu-prof-dir=${profileDir}`,
    `--cpu-prof-name=${profileName}`,
    probePath,
    selectedCase
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.log('PROFILE_SAMPLE_WINDOW_END=1');
    child.kill('SIGINT');
  }, seconds * 1000);

  const childResult = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ code: null, signal: null, error }));
    child.on('close', (code, signal) => resolve({ code, signal, error: null }));
  });
  clearTimeout(timer);

  console.log(`PROFILE_CHILD_CODE=${childResult.code ?? 'NA'}`);
  console.log(`PROFILE_CHILD_SIGNAL=${childResult.signal ?? 'NA'}`);
  console.log(`PROFILE_TIMED_OUT=${timedOut ? 'YES' : 'NO'}`);
  if (childResult.error) console.log(`PROFILE_CHILD_ERROR=${childResult.error.message}`);

  if (!existsSync(profilePath)) {
    console.log('PROFILE_AVAILABLE=NO');
    process.exitCode = 3;
  } else {
    const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    const nodes = new Map((profile.nodes || []).map((node) => [Number(node.id), node]));
    const parents = new Map();
    for (const node of profile.nodes || []) {
      for (const childId of node.children || []) parents.set(Number(childId), Number(node.id));
    }

    const stageNames = new Set([
      'enumerateArchitectures',
      'completeEquipment',
      'completeCompanion',
      'dofusPackages',
      'boundedCorePools',
      'slotPool',
      'dofusPool',
      'refineDofusPackagesForResults',
      'finalizeResults',
      'searchCombinedSetCoreEquipment'
    ]);

    function functionName(nodeId) {
      return String(nodes.get(Number(nodeId))?.callFrame?.functionName || '(anonymous)');
    }

    function urlName(nodeId) {
      const url = String(nodes.get(Number(nodeId))?.callFrame?.url || '');
      return url ? url.replace(/^.*\/dofus-optimizer\//, '') : '(native)';
    }

    function enclosingStage(nodeId) {
      let current = Number(nodeId);
      const visited = new Set();
      while (Number.isFinite(current) && !visited.has(current)) {
        visited.add(current);
        const name = functionName(current);
        if (stageNames.has(name)) return name;
        if (!parents.has(current)) break;
        current = parents.get(current);
      }
      return 'other';
    }

    const selfMicros = new Map();
    const stageMicros = new Map();
    const samples = profile.samples || [];
    const deltas = profile.timeDeltas || [];
    let sampledMicros = 0;
    for (let index = 0; index < samples.length; index++) {
      const nodeId = Number(samples[index]);
      const delta = Math.max(0, Number(deltas[index] || 0));
      sampledMicros += delta;
      const key = `${functionName(nodeId)} @ ${urlName(nodeId)}`;
      selfMicros.set(key, Number(selfMicros.get(key) || 0) + delta);
      const stage = enclosingStage(nodeId);
      stageMicros.set(stage, Number(stageMicros.get(stage) || 0) + delta);
    }

    const pct = (value) => sampledMicros > 0 ? Number((value * 100 / sampledMicros).toFixed(1)) : 0;
    const stages = [...stageMicros.entries()]
      .map(([stage, micros]) => ({ stage, ms: Number((micros / 1000).toFixed(1)), pct: pct(micros) }))
      .sort((a, b) => b.ms - a.ms);
    const functions = [...selfMicros.entries()]
      .map(([name, micros]) => ({ name, ms: Number((micros / 1000).toFixed(1)), pct: pct(micros) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 20);

    const dominantStage = stages.find((entry) => entry.stage !== 'other') || stages[0] || null;
    console.log('PROFILE_AVAILABLE=YES');
    console.log(`PROFILE_SAMPLED_MS=${(sampledMicros / 1000).toFixed(1)}`);
    console.log(`PROFILE_STAGES=${JSON.stringify(stages)}`);
    console.log(`PROFILE_TOP_FUNCTIONS=${JSON.stringify(functions)}`);
    console.log(`PROFILE_DOMINANT_STAGE=${dominantStage?.stage || 'NA'}`);
    console.log(`PROFILE_DOMINANT_STAGE_PCT=${dominantStage?.pct ?? 0}`);
    console.log('PROFILE_END=1');
  }
}
