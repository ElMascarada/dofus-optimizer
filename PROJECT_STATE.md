# Dofus Optimizer — Project State

Last updated: 2026-08-26

## Current migration checkpoint

- Base `main`: `bf6434dbb82738caaff5ea6393b6d99ac6c64028` (merged Candidate Policy PR #38).
- Working branch: `feat/set-core-catalog`.
- Draft PR: #39 — `feat: add canonical Set Cores to hybrid search`.
- Scope: Set Cores only. No UI, Atelier, IndexedDB, Lock/Reject, search memory, new class mechanics or spell-engine rewrite.

## Architecture now in place

1. `optimizer/set-core-catalog.js`
   - canonical automatic 2/3/4-piece core generation from normalized set data;
   - real set bonus included in `aggregateStats`;
   - `setId`, items, occupied slots, piece count, set bonus, aggregate stats, tags/profile and legality;
   - conservative dominance pruning;
   - compatibility API between cores.
2. `optimizer/set-core-candidate-policy.js`
   - adapter around the existing Candidate Policy;
   - relevant cores become Candidate Policy hints;
   - member items are protected by the existing `reason: "set-core"` path;
   - standalone candidates remain selected by the same policy.
3. `js/set-synergy-index.js`
   - no longer invents one best member combination per set;
   - search seeds come from canonical cores;
   - only single cores and compatible pairs are materialized as architecture seeds in this PR;
   - the existing standalone search lane is always preserved.
4. Observability
   - catalog diagnostics expose total sets, generated cores, illegal removals, dominated removals and retained cores;
   - policy diagnostics add relevant/injected core counts and `whySelected`.

## Tests added

- 2-piece set bonus aggregation;
- 3-piece set bonus aggregation;
- incompatible slot rejection;
- offensive core retention;
- constraint-useful core retention;
- conservative dominance removal;
- core compatibility slot conflict;
- standalone path remains searchable;
- set-core search can beat standalone-only baseline;
- standalone can beat set-core seeds;
- normalized real-data catalog smoke test.

All pre-existing regression tests remain enabled.

## Benchmark

New command: `npm run benchmark:set-cores`.

It compares Set Cores disabled/enabled for:

- mono element;
- multi;
- crit;
- high initiative;
- high vitality/resistance;
- T1;
- T1-T3.

Metrics: real-data core counts, relevant/injected cores, explored branches, evaluated builds, total time and best score.

## Validation checkpoint

GitHub Actions run `33004638084` on PR #39:

- syntax check: PASS;
- full Node tests: PASS;
- V2 baseline benchmark: PASS;
- Candidate Search benchmark: PASS;
- Set Core benchmark: running at this checkpoint.

## Resume instructions

Do not restart the implementation. Continue from PR #39 and this branch.

1. inspect the Set Core benchmark result/artifact from the latest CI run;
2. fix only concrete failures or measured regressions;
3. finish static condition compatibility between cores if not already completed;
4. update `docs/MIGRATION_PLAN.md` and this file with final counts/benchmark numbers;
5. run/verify final GitHub Actions on the final head;
6. mark PR READY only when the final head is fully green;
7. do not merge the PR.
