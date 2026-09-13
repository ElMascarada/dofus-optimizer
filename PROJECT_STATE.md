# DOFUS Optimizer — Project State

## Active product

As of the PR #120 combined-search closure candidate (12 September 2026):

- **Equipment-Only is the sole active Optimizer product path.**
- `js/equipment-search-request.js` is the request orchestrator.
- `js/complete-equipment-build-evaluator.js` is the authoritative final evaluator.
- Mono requests use the Equipment-First architecture search.
- Requests with 2 or 3 explicit elements, and `multi`, use the native combined Set-Core search in `optimizer/combined-set-core-search.js`, followed by exact/contextual Dofus-package refinement.
- The browser UI is wired through `js/optimizer-app.js` and the thin `js/optimizer-worker.js`.
- The active Optimizer does not require class, spell data, turn selection, combat planning, T1/T2/T3 or a combat scenario.
- Workshop remains active as a separate surface and may keep class/spell/combat analysis tooling.
- Search Memory is intentionally not allowed to replace a fresh product search.

## Active Optimizer flow

```text
Equipment-Only UI
        ↓
optimizer-worker.js
        ↓
searchEquipmentRequest()
        ↓
┌──────────────────────────────┬───────────────────────────────────────┐
│ mono element                 │ 2/3 elements or Multi                 │
│ searchEquipmentArchitecturesV2 │ searchCombinedSetCoreEquipment()   │
└──────────────────────────────┴───────────────────────────────────────┘
        ↓                              ↓
complete build evaluation       exact/contextual Dofus closure
        └───────────────┬──────────────┘
                        ↓
evaluateCompleteEquipmentBuild()
                        ↓
final synthetic-offense ranking
```

## Canonical product contract

### Damage orientation

The UI exposes **Type de dégâts**:

- Petites lignes (`small`)
- Mixte (`medium`)
- Grosses lignes (`large`)

Element selection remains independent. Combined requests rank the weakest requested axis first, then mean score. `multi` balances Earth, Fire, Water and Air independently.

### FM

`FM = Oui` is a single product choice.

For active Equipment-Only search it means:

- structural Exo PA = +1;
- structural Exo PM = +1;
- search starts from the corresponding 8 PA / 4 PM character baseline;
- those two structural exos consume two forgeable item assignments;
- seven remaining offensive FM assignments are optimized automatically;
- each offensive assignment chooses either `+1 % dommages sorts`, or `+8 dommages critiques` when the item has no native critical-damage line and that choice is better.

The user does not manually distribute those seven offensive assignments.

### Hard constraints

PA, PM and every enabled advanced constraint are hard minima. Scoring never creates feasibility.

Canonical invariant:

> **FEASIBLE SET NON-EMPTY ⇒ SEARCH MUST RETURN A RESULT**

Quality invariant added by the combined-search closure work:

> **A semantically distinct architecture must not disappear only because an intermediate scalar score is weak before its remaining equipment/companion/Dofus context is visible.**

## Combined search retention doctrine

For 2-element / 3-element / Multi requests:

1. candidate pools preserve balanced offense, requested-element/common-stat specialists and resource feasibility;
2. set cores include activated set bonuses before ranking;
3. architecture retention preserves parent→terminal set lineages and near-complete architectures before the final architecture trim;
4. when an architecture reaches complete ordinary equipment, retention keeps its best descendant plus semantic specialists instead of immediately applying a destructive global trim;
5. companion expansion happens before the final inter-architecture reduction;
6. companion retention combines primary score with a bounded parent→child marginal-gain reserve;
7. Dofus/trophy closure preserves resource-compatible packages and is evaluated by the authoritative complete evaluator;
8. final request ranking maximizes the minimum requested synthetic score, then the mean, then a deterministic identity tie-break.

Do not replace these semantic reserves with arbitrary beam widening.

## Current certified quality gates for PR #120

Real Steam Machine catalog, FM Oui, AP >= 12, PM >= 6:

- Fire + Water / Petites lignes / Auto crit: optimizer `3895.335` vs owner witness `3718.785` → **SEARCH_BETTER**.
- Fire + Water / Grosses lignes / Auto crit: optimizer `3008.88` vs owner witness `2778.3` → **SEARCH_BETTER**.
- Multi / Grosses lignes / Auto crit: returns 20 legal 12/6 results through `multi-element-native`; best four elemental scores are approximately `1391.11 / 1391.11 / 1391.11 / 1391.52`.
- Multi isolated runtime on the Steam Machine: approximately `103.5 s` on the certified candidate.
- Full suite on the product candidate before final documentation cleanup: `623 tests`, `622 pass`, `0 fail`, `1 skip`.
- Product smoke: **PASS**.

The browser recipe still requires an actual Chrome/Chromium executable (or `CHROME_BIN`) on the certification machine; absence of the executable is an infrastructure blocker, not a product verdict.

## Workshop boundary

Workshop remains a separate active product surface.

- Optimizer → Workshop hydrates a complete equipment result without requiring a class.
- Workshop → Find better / Complete exports equipment locks/requirements and rejected item IDs only.
- A Workshop class selection may remain stored for Workshop analysis, but it is not part of the Equipment-Only Optimizer request.

## Historical combat work

The historical spell-driven Optimizer / Combat Planner is not an active Optimizer runtime or fallback. Combat modules still in the tree remain valid for Workshop/shared/tests and preserved historical work. Do not reactivate or delete them on conversational impression alone; any product reactivation requires an explicit director decision.

## Validation

Authoritative local certification is performed on the real Steam Machine:

```bash
npm run check
npm test
npm run smoke:product
npm run recipe:browser
git diff --check
```

Combined-search changes additionally require real-catalog quality probes for representative bi-element and Multi requests.

Canonical CI runner labels:

```text
[self-hosted, linux, x64, steam-machine, dofus]
```
