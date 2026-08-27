# Dofus Optimizer — Project State

Dernière mise à jour : 2026-08-27

## État actuel

- dépôt : `ElMascarada/dofus-optimizer`
- reprendre toujours depuis le `main` mergé et vert au moment où l'agent commence ;
- base de la tranche actuelle : `main@2b7b11c6f4627ebcc53deb473e554a1e20f76f1e`, merge de la PR #41 — Atelier V2 foundation ;
- `AGENTS.md` et `docs/V2_COMPLETION_PLAN.md` restent les points d'entrée de reprise ;
- PR active : #44 — `feat: add workshop persistence and smart item search` ;
- branche : `feat/v2-workshop-persistence-search` ;
- la tranche 1 de `docs/V2_COMPLETION_PLAN.md` est fonctionnellement terminée et doit être mergée avant toute tranche suivante.

## V2 déjà mergée avant #44

- Fondation V2 et documentation d'architecture.
- Moteur de sorts/combat générique + registre de mécaniques.
- Candidate Policy / CandidatePrefilter canoniques.
- Recherche avec Pareto, réserves spécialistes, contraintes amont, bornes et profils centralisés.
- SetCoreCatalog 2/3/4 pièces, bonus exacts, profils et voie hybride set-core + standalone.
- Atelier V2 foundation : shell `[ATELIER] [OPTIMISEUR]`, 16 slots, navigateur d'items, stats live, bonus de panoplie et dégâts de sorts exacts.

## Tranche #44 — Persistence Atelier + bibliothèque + Smart Item Search

Implémenté :

- `js/workshop/build-serialization.js` : snapshot Atelier versionné, sérialisation par IDs canoniques uniquement et migration des anciens objets item ;
- reconstruction d'un `WorkshopBuild` depuis le catalogue courant avec diagnostics `missingItems`, `incompatibleItems` et état dégradé explicite ;
- `js/workshop/build-repository.js` : `BuildRepository` séparé de l'UI, IndexedDB versionné en production et `MemoryBuildStore` injectable en tests ;
- CRUD : sauvegarder, charger, renommer, dupliquer et supprimer ;
- brouillon courant séparé de la bibliothèque, autosauvegardé avec debounce et flush sur masquage de la page ;
- les écritures IndexedDB attendent le commit réel de transaction avant d'être déclarées réussies ;
- version de données mémorisée et signalement d'un build provenant d'un ancien snapshot sans le rejeter automatiquement ;
- `js/workshop/item-search.js` : index local pré-calculé, parseur déterministe et ranking explicable ;
- vocabulaire couvert : éléments, multi, Do Crit, initiative, vitalité, résistances, distance/mêlée, PA, PM, PO, slots et recherche par nom/panoplie ;
- requêtes de référence testées : `multi do crit`, `terre ini`, `eau distance`, `grosse vita res`, `anneau PA multi` ;
- raisons/tags de ranking visibles dans le navigateur d'items ;
- aucune recherche d'item et aucun changement manuel d'item ne crée de Worker optimizer ;
- bibliothèque Atelier intégrée sans faire dépendre `WorkshopBuild` ou `WorkshopController` d'IndexedDB.

## Frontières canoniques

- Build final / stats / conditions / sets / FM : `CompleteBuildEvaluator`.
- Sorts / dégâts : moteur combat générique + `evaluateSpell`.
- Recherche candidats : `CandidatePolicy` + `CandidatePrefilter`.
- Panoplies : `SetCoreCatalog`.
- Atelier : `WorkshopBuild` → `WorkshopController` → `WorkshopEvaluator`.
- Persistence Atelier : `BuildRepository` → store IndexedDB injecté.
- Sérialisation Atelier : IDs canoniques → reconstruction depuis `loadDofusData()`.
- Smart Item Search : index déterministe local, sans solveur.

## Invariants à préserver

1. L'UI ne recalcule pas le métier.
2. Un changement manuel d'item Atelier ne lance pas l'optimiseur.
3. Une recherche d'item Atelier ne lance pas l'optimiseur.
4. Un build persistant stocke des IDs canoniques, jamais une copie durable du catalogue d'items.
5. Un item disparu ou devenu incompatible après mise à jour est signalé et ignoré proprement à la reconstruction.
6. Une contrainte active influence la conservation des candidats avant le solveur final.
7. Un item utile ne disparaît pas sur score offensif seul.
8. La voie standalone reste disponible avec les Set Cores.
9. Toute solution finale repasse par `CompleteBuildEvaluator`.
10. Le moteur combat générique ne connaît pas directement les classes/sorts spéciaux.
11. Lock/Reject et seeds devront être des données explicites de requête, pas des hacks DOM/Worker.

## Validation de la tranche #44

Head de code validé avant mise à jour documentaire : `ffcb84066d8760d2f303af36fe03ab53c766ba89`.

Sur Optimizer CI #472 :

- `npm run check` : vert ;
- `npm test` : **251/251** ;
- `npm run benchmark:v2` : vert ;
- `npm run benchmark:search` : vert ;
- `npm run benchmark:workshop` : vert ;
- Sync spell icons #95 : vert.

Benchmark Atelier sur snapshot réel, stuff complet, 26 sorts, 30 recalculs :

- médiane : **1,054 ms** ;
- p95 : **5,237 ms** ;
- max : **7,874 ms** ;
- garde CI : p95 < 100 ms.

Smart Item Search sur les **1 093 items** du snapshot réel :

- construction initiale de l'index : **23,381 ms** ;
- 100 recherches sur les requêtes de référence : médiane **0,204 ms**, p95 **1,320 ms**, max **2,055 ms** ;
- gardes CI : index < 150 ms et p95 recherche < 25 ms.

La CI du head documentaire final doit encore être verte avant passage READY. Ne pas merger automatiquement.

## Ce qui reste pour finir la V2

Ordre canonique dans `docs/V2_COMPLETION_PLAN.md` :

1. **Optimiseur V2 simplifié** : Classe → Élément → Contraintes → Objectif.
2. Mémoire des recherches + cache exact + seeds proches.
3. Lock / Reject + `Trouver mieux` depuis l'Atelier.
4. Tours idéaux / objectifs temporels finaux, notamment Constant et plage personnalisée.
5. Performance finale : coarse → precise, cache combat, parallélisation si utile.
6. Polish néo-rétro + recette V2 complète.

## Prochaine tranche canonique après merge de #44

**Tranche 2 — Optimiseur V2 simplifié**.

Scope attendu :

```text
Classe
→ Élément
→ Contraintes
→ Objectif
→ Optimiser
```

- consommer les contrats et moteurs existants ;
- ne pas réécrire le solveur ;
- conserver les résultats/fingerprints de calcul ;
- exposer proprement T1, T2, T3 et les modes temporels déjà supportés ;
- préparer explicitement Constant/plage personnalisée sans les inventer avant leur tranche dédiée ;
- ne pas mélanger cette PR avec persistence des recherches, seeds, Lock/Reject ou `Trouver mieux`.

## Reprise rapide

Un nouvel agent doit lire dans cet ordre :

1. `AGENTS.md`
2. `PROJECT_STATE.md`
3. `docs/V2_COMPLETION_PLAN.md`
4. puis uniquement les documents/modules nécessaires à sa tranche.

La règle par défaut est : nouvelle branche depuis le `main` mergé et vert, petite PR, checkpoints fréquents, CI verte, READY sans merge automatique sauf instruction explicite.
