import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
  const requestedProfilePath = join(profileDir, `${selectedCase}.v8.log`);
  rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });

  console.log(`PROFILE_CASE=${selectedCase}`);
  console.log(`PROFILE_SECONDS=${seconds}`);
  console.log('PROFILE_ENGINE=v8-tick-prof');
  console.log(`PROFILE_REQUESTED_PATH=${requestedProfilePath}`);
  console.log('PROFILE_CHILD_BEGIN=1');

  // --cpu-prof serializes the .cpuprofile when the process exits cleanly. The
  // combined search is synchronous and CPU-bound, so SIGINT cannot reliably
  // reach JS and flush it. V8 --prof instead appends tick samples while the
  // process is running, which leaves a useful log even when we must kill a
  // deliberately stalled diagnostic child.
  const child = spawn(process.execPath, [
    '--prof',
    `--logfile=${requestedProfilePath}`,
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
    child.kill('SIGKILL');
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

  // V8 may prepend an isolate identifier even when --logfile is supplied.
  // Resolve either form rather than depending on a particular Node/V8 build.
  const logNames = readdirSync(profileDir).filter((name) => name.endsWith('.log')).sort();
  const profilePath = existsSync(requestedProfilePath)
    ? requestedProfilePath
    : (logNames.length ? join(profileDir, logNames[0]) : null);

  if (!profilePath || !existsSync(profilePath)) {
    console.log(`PROFILE_DIR_FILES=${JSON.stringify(logNames)}`);
    console.log('PROFILE_AVAILABLE=NO');
    process.exitCode = 3;
  } else {
    console.log(`PROFILE_PATH=${profilePath}`);
    const rawBytes = readFileSync(profilePath).byteLength;
    console.log(`PROFILE_RAW_BYTES=${rawBytes}`);

    const processed = spawnSync(process.execPath, ['--prof-process', profilePath], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    });
    const report = `${processed.stdout || ''}\n${processed.stderr || ''}`;
    const lines = report.split(/\r?\n/);
    const stageNames = [
      'enumerateArchitectures',
      'retainCombinedArchitectureStates',
      'retainFinalArchitectureCandidates',
      'completeEquipment',
      'retainStates',
      'completeCompanion',
      'retainCompanionParentMarginals',
      'dofusPackages',
      'boundedCorePools',
      'slotPool',
      'dofusPool',
      'stateScore',
      'resourceBucket',
      'contextualStats',
      'searchCombinedSetCoreEquipment',
      'evaluateCompleteEquipmentBuild',
      'optimizeSyntheticCharacteristicsTriMultiLinear',
      'optimizeSyntheticCharacteristics',
      'optimizeSecondary',
      'pairOptions',
      'optimizeSyntheticFm',
      'evaluateSyntheticOffense',
      'refineDofusPackagesForResults',
      'scoreResultForRequest',
      'finalizeResults'
    ];

    const stageLines = lines
      .filter((line) => stageNames.some((name) => line.includes(name)))
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 180);
    const hotLines = lines
      .filter((line) => /^\s*\d+\s+\d+(?:\.\d+)?%/.test(line))
      .map((line) => line.trim())
      .slice(0, 100);

    console.log('PROFILE_AVAILABLE=YES');
    console.log(`PROFILE_PROCESS_CODE=${processed.status ?? 'NA'}`);
    console.log(`PROFILE_STAGE_LINES=${JSON.stringify(stageLines)}`);
    console.log(`PROFILE_HOT_LINES=${JSON.stringify(hotLines)}`);
    if (processed.error) console.log(`PROFILE_PROCESS_ERROR=${processed.error.message}`);
    if (processed.status !== 0) {
      console.log(`PROFILE_PROCESS_STDERR=${JSON.stringify(String(processed.stderr || '').slice(-4000))}`);
      process.exitCode = 4;
    }
    console.log('PROFILE_END=1');
  }
}
