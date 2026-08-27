# Dofus Optimizer — Project State

Dernière mise à jour : 2026-08-27

## Main actuel

- dépôt : `ElMascarada/dofus-optimizer`
- `main` : `106ffb567c351799a9e0b5d8f55f2acbe1ac1c02`
- ce commit merge la PR #41 — Atelier V2 foundation
- branche de handoff en cours : `docs/v2-project-handoff`

## V2 déjà mergée

- Fondation V2 et documentation d'architecture.
- Moteur de sorts/combat générique + registre de mécaniques.
- Candidate Policy / CandidatePrefilter canoniques.
- Recherche avec Pareto, réserves spécialistes, contraintes amont, bornes et profils centralisés.
- SetCoreCatalog 2/3/4 pièces, bonus exacts, profils et voie hybride set-core + standalone.
- Atelier V2 foundation : shell `[ATELIER] [OPTIMISEUR]`, 16 slots, navigateur d'items, stats live, bonus de panoplie et dégâts de sorts exacts.

## Frontières canoniques

- Build final / stats / conditions / sets / FM : `CompleteBuildEvaluator`.
- Sorts / dégâts : moteur combat générique + `evaluateSpell`.
- Recherche candidats : `CandidatePolicy` + `CandidatePrefilter`.
- Panoplies : `SetCoreCatalog`.
- Atelier : `WorkshopBuild` → `WorkshopController` → `WorkshopEvaluator`.
- Catalogue UI : `loadDofusData()`.

## Invariants à préserver

1. L'UI ne recalcule pas le métier.
2. Un changement manuel d'item Atelier ne lance pas l'optimiseur.
3. Une contrainte active influence la conservation des candidats avant le solveur final.
4. Un item utile ne disparaît pas sur score offensif seul.
5. La voie standalone reste disponible avec les Set Cores.
6. Toute solution finale repasse par `CompleteBuildEvaluator`.
7. Le moteur combat générique ne connaît pas directement les classes/sorts spéciaux.
8. Lock/Reject et seeds devront être des données explicites de requête, pas des hacks DOM/Worker.

## Validation actuelle

Après #41 :

- `npm run check` : vert ;
- `npm test` : 240/240 ;
- `npm run benchmark:v2` : vert ;
- `npm run benchmark:search` : vert ;
- `npm run benchmark:workshop` : vert ;
- Optimizer CI #455 : verte ;
- Sync spell icons #78 : verte.

Benchmark Atelier observé sur la CI #41, stuff complet + 26 sorts + 30 changements d'item :

- médiane : 0,637 ms ;
- p95 : 1,124 ms ;
- max : 1,317 ms ;
- garde CI : p95 < 100 ms.

## Ce qui reste pour finir la V2

Ordre canonique dans `docs/V2_COMPLETION_PLAN.md` :

1. Persistence Atelier + bibliothèque de builds + recherche intelligente d'items.
2. Optimiseur V2 simplifié : Classe → Élément → Contraintes → Objectif.
3. Mémoire des recherches + cache exact + seeds proches.
4. Résultats interactifs Lock / Reject + `Trouver mieux` depuis l'Atelier.
5. Tours idéaux / objectifs temporels finaux, notamment Constant et plage personnalisée.
6. Performance finale : coarse → precise, cache combat, parallélisation si utile.
7. Polish néo-rétro + recette V2 complète.

## Prochaine tranche après cette PR de handoff

**Persistence Atelier / bibliothèque + Smart Item Search**.

Scope attendu :

- IndexedDB versionné ;
- sauvegarder / charger / renommer / dupliquer / supprimer ;
- autosave du draft courant ;
- recherche déterministe `multi do crit`, `terre ini`, `eau distance`, etc. ;
- aucun `Trouver mieux`, seed de solveur, Lock/Reject ou refonte Optimiseur dans cette tranche.

## Reprise rapide

Un nouvel agent doit lire dans cet ordre :

1. `AGENTS.md`
2. `PROJECT_STATE.md`
3. `docs/V2_COMPLETION_PLAN.md`
4. puis uniquement les documents/modules nécessaires à sa tranche.

La règle par défaut est : nouvelle branche depuis le `main` mergé et vert, petite PR, checkpoints fréquents, CI verte, READY sans merge automatique sauf instruction explicite.
