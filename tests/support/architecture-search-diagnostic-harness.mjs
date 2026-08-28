import { readFileSync } from 'node:fs';

const HOOK_KEY = '__DOFUS_PRIMARY_CONDITION_DIAGNOSTIC_HOOKS__';

function absoluteImports(source, sourceUrl) {
  return source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_match, quote, specifier) => {
    return `from ${quote}${new URL(specifier, sourceUrl).href}${quote}`;
  });
}

function instrumentSource(source, sourceUrl) {
  const evaluatorImport = "import { evaluateCompleteBuild } from './complete-build-evaluator.js';";
  if (!source.includes(evaluatorImport)) throw new Error('Diagnostic harness: evaluator import marker changed');

  source = source.replace(evaluatorImport, [
    `import { evaluateCompleteBuild as evaluateCompleteBuildBase } from '${new URL('./complete-build-evaluator.js', sourceUrl).href}';`,
    'function evaluateCompleteBuild(args) {',
    '  const outcome = evaluateCompleteBuildBase(args);',
    `  globalThis.${HOOK_KEY}?.onEvaluation?.({ args, outcome });`,
    '  return outcome;',
    '}'
  ].join('\n'));

  const completeMarker = 'const complete = states.filter((state) => fullShape(state.items));';
  if (!source.includes(completeMarker)) throw new Error('Diagnostic harness: complete-state marker changed');
  source = source.replace(
    completeMarker,
    `${completeMarker}\n    globalThis.${HOOK_KEY}?.onComplete?.({ entry, searchOrigin, complete });`
  );

  const evaluationPoolMarker = 'const evaluationPool = complete.slice(0, evaluationLimit);';
  if (!source.includes(evaluationPoolMarker)) throw new Error('Diagnostic harness: evaluation-pool marker changed');
  source = source.replace(
    evaluationPoolMarker,
    `${evaluationPoolMarker}\n    globalThis.${HOOK_KEY}?.onEvaluationPool?.({ entry, searchOrigin, evaluationPool });`
  );

  return absoluteImports(source, sourceUrl);
}

export async function createInstrumentedArchitectureSearch() {
  const sourceUrl = new URL('../../js/architecture-search-v2.js', import.meta.url);
  const raw = readFileSync(sourceUrl, 'utf8');
  const instrumented = instrumentSource(raw, sourceUrl);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`;
  const module = await import(moduleUrl);

  return function searchArchitecturesV2WithDiagnostics(args, hooks = {}) {
    if (globalThis[HOOK_KEY]) throw new Error('Diagnostic harness is not re-entrant');
    globalThis[HOOK_KEY] = hooks;
    try {
      return module.searchArchitecturesV2(args);
    } finally {
      delete globalThis[HOOK_KEY];
    }
  };
}
