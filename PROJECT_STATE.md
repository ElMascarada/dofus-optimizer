# Dofus Optimizer — Project State

Dernière mise à jour : 2026-08-27

## État actuel

- dépôt : `ElMascarada/dofus-optimizer` ;
- base stricte de la tranche : `main@58918c98276004edf7fc7d0e570f34fbd8431603`, merge vert de la PR #49 ;
- PR active : #50 — `perf: finalize V2 search and combat performance` ;
- branche : `perf/v2-final-performance` ;
- scope strict : **Tranche 6 — Performance finale** ;
- Tranche 7 — polish UI global / recette finale reste explicitement hors scope.

## V2 déjà mergée avant #50

- Fondation V2 / moteur combat générique.
- `CandidatePolicy` / `CandidatePrefilter` canoniques.
- `SetCoreCatalog` + recherche hybride set-core / standalone.
- Atelier V2 : 16 slots, stats live, dégâts sorts, persistence, bibliothèque et Smart Item Search.
- Optimiseur V2 simplifié : `Classe → Élément → Contraintes → Objectif → Optimiser`.
- Search Memory V2 : cache exact IndexedDB, requêtes proches et seeds réévalués.
- Lock / Reject / Trouver mieux.
- Tours idéaux T1/T2/T3, rotations exactes et objectifs temporels finaux dont `Constant`.

## Tranche #50 — Performance finale

### Base mesurée

Baseline stricte : `main@58918c98276004edf7fc7d0e570f34fbd8431603`.

Deux exécutions indépendantes du même workflow ont été conservées pour la comparaison :

- Optimizer CI #532 attempts 1 et 2 sur le baseline ;
- Optimizer CI #535 attempts 1 et 2 sur le tree optimisé `c63abf8cddf1cb73d4d2a32357afb83ee262b438`.

Le détail est documenté dans `docs/PERFORMANCE_V2.md`.

### Optimisations retenues

#### Candidate Search

`optimizer/candidate-search.js` réutilise désormais par contexte de recherche les calculs sûrs qui étaient recomputés pour chaque état :

- bornes de contraintes des groupes restants ;
- caps positifs de bonus de panoplies ;
- caps offensifs restants ;
- nombre de slots forgeables pour l'upper bound.

Les caches sont des `WeakMap` liés aux objets de contexte de la recherche courante. Aucune persistence et aucune donnée de requête n'est modifiée.

`branchFeasibility()` accepte également une enveloppe pré-calculée / des stats déjà connues. `tests/performance-reuse.test.mjs` protège l'équivalence exacte avec le calcul frais, y compris les formes impossibles.

#### Combat

`js/turn-optimizer.js` conserve exactement le même `stateKey`, les mêmes beams, les mêmes séquences admissibles et les mêmes formules, mais :

- `damage + supportPotential` est calculé une fois par état unique avant le tri ;
- `finalScore` est calculé une fois par finaliste avant le classement final.

Auparavant ces deux valeurs étaient recalculées plusieurs fois par état dans les comparateurs de `sort`.

### Gains reproductibles retenus

Moyenne de deux runs baseline et deux runs optimisés :

- Combat mono-tour : environ **-10,1 %** ; fingerprint `400` inchangé ;
- Combat T1–T3 : environ **-29,3 %** ; fingerprint `960` inchangé ;
- Candidate Search mono-element : environ **-9,1 %** ;
- Candidate Search crit : environ **-15,1 %** ;
- Candidate Search T1 : environ **-10,0 %** ;
- contraintes initiative : environ **-8,4 %** ;
- haute vitalité : environ **-7,7 %** ;
- multi : environ **-5,6 %**.

Les scénarios Search conservent exactement, sur les deux paires de runs, leurs `bestScore`, `expandedStates`, `evaluatedBuilds`, `validBuilds`, `architectureVariants` et `bestOrigin`.

Le micro-benchmark `manual-stop-finalization` reste sous la milliseconde et conserve le fingerprint `1:true`. Aucun gain n'est revendiqué sur ce cas ; la finalisation après stop reste fonctionnellement inchangée.

### Expérience rejetée

Un cache supplémentaire des descripteurs d'effets de sorts a été essayé après le checkpoint performant. Il n'a apporté aucun gain reproductible supplémentaire. Il a été retiré avant le tree final : le HEAD retenu ne conserve donc pas cette complexité.

Le tree de code après retrait est identique au checkpoint performant `c63abf8cddf1cb73d4d2a32357afb83ee262b438` pour les fichiers concernés.

## Frontières / invariants à préserver

1. `CompleteBuildEvaluator` reste la validation finale de toute solution.
2. `CandidatePolicy`, `CandidatePrefilter` et `SetCoreCatalog` ne sont pas remplacés ni contournés.
3. Aucun beam, pool, budget ou profil de `optimizer/search-profiles.js` n'a été diminué dans #50.
4. Les upper bounds gardent exactement la même sémantique ; seuls leurs sous-calculs invariants sont réutilisés.
5. Le moteur combat garde le même `stateKey`, les mêmes formules et les mêmes états admissibles.
6. Le pipeline cheap → coarse → precise existant dans `combat-turn-refiner.js` est conservé.
7. Aucune parallélisation supplémentaire n'est ajoutée sans benchmark démontrant un gain réel.
8. Aucun GPU/WASM n'est ajouté sans besoin mesuré.
9. Fingerprints Search Memory / requêtes canoniques inchangés.
10. Le polish UI global et la recette finale restent hors PR #50.

## Validation de #50

Checkpoint de code performant : `c63abf8cddf1cb73d4d2a32357afb83ee262b438`.

- CI #535 attempt 1 : verte ;
- CI #535 attempt 2 : verte ;
- `npm run check` : vert ;
- `npm test` : vert, y compris `tests/performance-reuse.test.mjs` ;
- `benchmark:v2` : vert ;
- `benchmark:search` : vert ;
- `benchmark:workshop` : vert ;
- fingerprints qualité inchangés ;
- Search diagnostics structurels identiques au baseline.

Le HEAD documentaire final doit encore repasser la CI standard verte avant passage READY. Ne pas merger automatiquement.

## Prochaine tranche canonique après merge vert de #50

**Tranche 7 — Polish / recette V2**, uniquement après instruction explicite et depuis un nouveau `main` mergé et vert.

Ne pas commencer cette tranche depuis la branche #50.

## Reprise rapide

Lire dans cet ordre :

1. `AGENTS.md`
2. `PROJECT_STATE.md`
3. `docs/V2_COMPLETION_PLAN.md`
4. `docs/PERFORMANCE_V2.md` si la reprise concerne les performances ;
5. puis uniquement les modules nécessaires à la tranche.
