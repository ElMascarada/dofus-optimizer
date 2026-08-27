# Tranche 2 — Optimiseur V2 simplifié

Base : `main@e31843aa74fd5207098966083b4c8f38aee431fb` (PR #44 mergée, Optimizer CI #475 verte).

Scope strict : migration UI/orchestration du parcours Optimiseur vers `Classe → Élément → Contraintes → Objectif → Optimiser`.

Interdits : solveur, CandidatePolicy, SetCoreCatalog, beams/pools, cache/seeds, Lock/Reject, Trouver mieux, Constant, nouvelles mécaniques de sorts.

Checkpoint initial : inspection ciblée en cours de `index.html`, `js/app-experimental.js`, contrats Worker, `CompleteBuildEvaluator` et frontière Atelier.
