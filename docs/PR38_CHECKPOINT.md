# PR #38 — Checkpoint

## Objectif

Passer la PR #38 `refactor/v2-candidate-policy-search` en **Ready for review** sans merge, uniquement après CI verte et benchmarks finaux acceptables.

## État validé

- Base de travail : `main` mergé et vert au SHA `1e6ecf6fa4df42c6814cefe86efbb22f8f584b7c`.
- PR : #38, Draft.
- Checkpoint baseline : commit `faeb5f424701f12ad942f00df3bb9ea4ddda234f`, CI verte.
- Refactor central déjà poussé : commit `350202708dc5133b057aa24bdb31e7076678c630` (`refactor: centralize candidate policy and search bounds`).
- Modules cibles introduits :
  - `optimizer/candidate-policy.js`
  - `optimizer/candidate-search.js`
  - `optimizer/search-profiles.js`
- `js/candidate-prefilter.js`, `js/architecture-search-v2.js`, `js/offensive-slot-refiner.js` et `js/optimizer-worker.js` consomment désormais la policy/profil centralisés.

## Invariants à verrouiller avant READY

1. Un score offensif scalaire peut ordonner, jamais éliminer seul un candidat utile.
2. Pareto contextuel par slot : un item réellement dominé doit être supprimé ; un spécialiste utile doit survivre.
3. Les réserves spécialistes couvrent AP, MP, PO, Initiative, Vitalité, résistances, Crit, Do Crit, stats élémentaires, Puissance et mécaniques uniques.
4. Les contraintes positives influencent la rétention et la recherche dès l'amont.
5. Le pruning `constraint feasibility` doit utiliser une borne théorique issue des pools bruts restants, pas des choix déjà tronqués heuristiquement.
6. L'upper bound offensif doit être volontairement optimiste ; il ne doit jamais supprimer l'optimum connu.
7. Les coupes heuristiques doivent rester distinguées des prunings sûrs dans les diagnostics.
8. `reason: "set-core"` est seulement préparé ; ne pas implémenter le chantier complet Set Cores dans cette PR.
9. Aucun changement UI, Atelier, IndexedDB, Lock/Reject, mémoire utilisateur, équilibrage sorts/classes.

## Prochaines actions exactes

### Checkpoint A — correctness du refactor
- Corriger `candidate-policy.js` pour que le rank-fill/offense reserve ne réintroduise pas des candidats Pareto-dominés.
- Corriger `candidate-search.js` pour calculer les bornes de faisabilité/offense directement depuis les pools de profils restants, indépendamment de `buildGroupChoices()`.
- Simplifier le diagnostic `searchProfile` dans `architecture-search-v2.js`.
- Nettoyer les imports morts sans changer le comportement.

### Checkpoint B — tests obligatoires
Ajouter `tests/candidate-policy-search.test.mjs` couvrant au minimum :
- offense sans contrainte ;
- équivalence Force / Puissance ;
- item moins offensif conservé grâce à Vitalité ;
- Initiative >= 5000 ;
- haute Vitalité ;
- résistances ;
- PA ;
- PM ;
- PO ;
- item dominé supprimé ;
- spécialiste conservé ;
- contrainte impossible détectée tôt ;
- upper bound offensif conserve un optimum connu ;
- invariant BALANCED vs FINAL sur scénarios de référence quand applicable.

### Checkpoint C — CI
- Pousser le checkpoint A+B.
- Lancer/observer la CI.
- Corriger uniquement les échecs réels jusqu'à vert.

### Checkpoint D — benchmark + docs
- Exécuter le benchmark candidat sur : mono, multi, initiative 5000, haute vita, résistances, T1, T1-T3.
- Comparer : items initiaux, après filtre, états explorés/builds évalués, temps total, meilleur score.
- Mettre à jour `docs/MIGRATION_PLAN.md` et `PROJECT_STATE.md`.
- Documenter architecture avant/après, réduction des pools, gain/perte qualité, limites restantes, prochaine PR Set Cores.

### Checkpoint E — READY
- Vérifier PR head + CI verte + aucun test requis manquant.
- Passer la PR #38 de Draft à **Ready for review**.
- Ne pas merger.
