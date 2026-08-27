# Dofus Optimizer V2 — Plan de migration

## État au 27 août 2026

La V2 est désormais dans sa phase de finition produit. Les grosses fondations sont mergées sur `main` : architecture, combat générique, recherche d'équipements, Set Cores et Atelier manuel.

La suite ne doit plus rouvrir ces fondations sans régression démontrée. Les dernières tranches branchent persistence, nouvelle interface Optimiseur, mémoire/seeds, interactions Lock/Reject, objectifs temporels et performance finale.

## Règle générale

- Une tranche = une PR courte et testable.
- Toute PR part du `main` mergé et vert.
- Une PR d'architecture ne change pas volontairement les résultats métier.
- Tout changement de score, Top N, rotation ou temps significatif doit être mesuré et justifié.
- Les sources de vérité décrites dans `AGENTS.md` ne doivent pas être dupliquées.

## Tranches terminées

### Fondation V2

Livré : audit du runtime, spec produit, architecture actuelle/cible, baseline de non-régression, version/cache runtime centralisés et filet de tests/benchmarks.

### Combat / sorts génériques

Livré : moteur de combat générique, registre de mécaniques, `evaluateSpell`, couverture de support des sorts et retrait des dépendances directes aux classes/sorts du cœur générique.

### Candidate Policy / recherche de builds — PR #38

Livré : Pareto contextuel, réserves spécialistes, contraintes prises en compte en amont, pruning de faisabilité, upper bounds offensifs, profils de recherche et diagnostics centralisés.

### SetCoreCatalog — PR #40

Livré : cores 2/3/4 pièces générés automatiquement, bonus exacts, profils, compatibilité core/core, injection `reason: "set-core"`, recherche hybride set-core + standalone et benchmarks dédiés.

### Atelier V2 foundation — PR #41

Livré : shell `[ATELIER] [OPTIMISEUR]`, 16 slots, navigateur d'items, `WorkshopBuild` / `WorkshopController` / `WorkshopEvaluator`, stats live via `CompleteBuildEvaluator`, dégâts de sorts via `evaluateSpell`, style néo-rétro de base et benchmark interactif.

## Tranches restantes — ordre canonique

Le détail et les critères de sortie sont dans `docs/V2_COMPLETION_PLAN.md`.

### 1. Persistence Atelier + bibliothèque + Smart Item Search

Objectif : rendre l'Atelier durable et réellement pratique.

Livrables :

- IndexedDB versionné ;
- repository de builds ;
- sauvegarde, chargement, renommage, duplication, suppression ;
- autosave du draft courant ;
- migrations/invalidation par version de données/règles ;
- vocabulaire déterministe de recherche d'items (`multi do crit`, `terre ini`, etc.) ;
- ranking explicable et rapide, sans LLM ni heuristique opaque.

Hors scope : solveur `Trouver mieux`, seeds, Lock/Reject, refonte Optimiseur.

### 2. Optimiseur V2 simplifié

Objectif : remplacer l'interface historique complexe par le parcours principal :

```text
Classe → Élément → Contraintes → Objectif
```

Objectifs temporels disponibles au minimum : T1, T2, T3, T1–T3 / moyenne / pire tour selon le contrat existant, puis extension explicite vers Constant et plage personnalisée.

Cette tranche réutilise les moteurs actuels ; elle ne réécrit pas Candidate Policy, SetCoreCatalog ou le combat.

### 3. Mémoire des recherches + cache exact + seeds

Objectif : une requête déjà calculée et encore compatible doit être instantanée ; une requête proche doit réutiliser les meilleurs builds connus comme points de départ.

Livrables :

- requête normalisée et fingerprint stable ;
- cache exact IndexedDB ;
- compatibilité data/rules/search version ;
- recherche de requêtes proches ;
- réévaluation obligatoire de tout seed ;
- fusion seed + set-core + standalone sans supprimer la recherche libre.

### 4. Lock / Reject + Trouver mieux

Objectif : rendre l'optimisation interactive.

- `requiredItemIds` / équivalent canonique pour Lock ;
- `excludedItemIds` pour Reject ;
- réoptimisation autour du résultat courant ;
- bouton Atelier `Trouver mieux` utilisant le build comme seed, jamais comme prison ;
- aucun patch global `window.Worker` ou MutationObserver métier.

### 5. Objectifs temporels finaux / tours idéaux

Objectif : exposer clairement les meilleures rotations d'un build et finaliser le contrat des objectifs temporels :

- T1 ;
- T2 ;
- T3 ;
- Constant ;
- plage de tours personnalisée lorsque raisonnable.

L'Atelier doit pouvoir afficher les tours idéaux en haut sans lancer une recherche d'équipements.

### 6. Performance finale

Objectif : accélérer sans sacrifier la qualité.

Priorités :

1. éviter tout recalcul connu ;
2. cache combat par état/entrée compatible ;
3. pipeline cheap → coarse → precise ;
4. déduplication d'états ;
5. parallélisation finale entre workers uniquement si les mesures la justifient.

Ne pas introduire GPU/WASM ou complexité supplémentaire sans benchmark prouvant le besoin.

### 7. Polish / recette V2

Objectif : rendre la V2 cohérente et prête à utiliser.

- style néo-rétro noir `#000000`, gris `#CCCFCA`, rouge `#DC2636` ;
- lisibilité des items/stats/dégâts prioritaire ;
- responsive raisonnable ;
- parcours complet Atelier ↔ Optimiseur ;
- tests de recette et benchmarks finaux ;
- suppression/documentation de l'historique encore réellement mort uniquement après preuve qu'il n'est plus exécuté.

## Discipline de benchmark

Toujours exécuter `npm run check` et `npm test`.

Benchmarks selon la tranche :

- `npm run benchmark:v2` : changements globaux / solveur / combat / persistence de recherche ;
- `npm run benchmark:search` : Candidate Policy / Set Cores / seeds / Lock-Reject côté recherche ;
- `npm run benchmark:workshop` : chemin interactif Atelier.

Le rapport doit distinguer :

- fingerprint / qualité fonctionnelle ;
- temps de calcul ;
- nombre de candidats/états explorés lorsque pertinent.

## Critères de fin d'une tranche

- scope terminé ;
- tests ciblés ajoutés ;
- tests historiques verts ;
- benchmarks concernés verts sans régression inexpliquée ;
- CI GitHub verte ;
- `PROJECT_STATE.md` mis à jour ;
- PR READY ;
- pas de merge automatique sauf instruction explicite.
