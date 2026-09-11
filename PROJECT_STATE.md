# DOFUS Optimizer — Project State

## Active product

As of the Equipment-Only Product Cleanup V1 candidate based on `7307df28eb23b73bef46d07d5459f30872f99302`:

- **Equipment-First is the sole active Optimizer runtime.**
- **Set-Core-First is the primary real-catalog search strategy.**
- **`js/complete-equipment-build-evaluator.js` is the authoritative final evaluator.**
- The browser UI is wired directly to Equipment-First through `js/optimizer-app.js` and the thin `js/optimizer-worker.js`.
- The active Optimizer does not require class, spell data, turn selection, a Combat Planner objective, or a combat scenario.
- There is no active fallback from Equipment-First to the historical spell-driven Optimizer.
- Search Memory is intentionally removed from the active Optimizer path; old combat fingerprints are therefore never reused by the new product.
- Workshop remains active and may keep its own class/spell combat tooling.

## Active Optimizer flow

```text
Equipment-Only UI
        ↓
Equipment-First Worker
        ↓
searchEquipmentArchitecturesV2()
        ↓
Set-Core-First
        ↓
evaluateCompleteEquipmentBuild()
```

The active request is equipment-only: catalog items/sets, hard constraints, structural exo policy, synthetic offensive orientation/profiles, optional Workshop equipment requirements/rejections, Top N and search profile.

## Canonical acceptance scenario

```text
Element = Earth
Profile = LARGE
AP >= 12
MP >= 6
Exo AP = 0
Exo MP = 0
```

A feasible real catalog must return at least one complete legal build with final AP=12 and MP=6.

## Workshop boundary

Workshop remains a separate active product surface. Its class, spell, rotation and combat-evaluation features are legitimate Workshop functionality and are not dependencies of the Optimizer.

- Optimizer → Workshop hydrates an equipment result without requiring a class.
- Workshop → Find better / Complete exports equipment locks/requirements and rejected item IDs only.
- A Workshop class selection may remain stored for Workshop analysis, but it is not part of the Equipment-First Optimizer request.

## Historical implementation

The historical Combat Planner / spell-driven Optimizer is no longer an active runtime or fallback. Git history is the canonical source for the removed active entrypoint. Combat modules still present in the tree are retained only when they have a current Workshop/shared/test consumer; their presence does not make them part of the active Optimizer.

## Validation

Remote candidate generation performs only static/materializer validation. Authoritative certification is local on the Steam Machine:

```bash
npm run check
npm test
npm run probe:equipment-search
npm run smoke:product
npm run recipe:browser
git diff --check
```

Canonical CI remains the self-hosted runner labels:

```text
[self-hosted, linux, x64, steam-machine, dofus]
```
