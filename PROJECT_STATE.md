# État courant du projet

Ce document décrit l'état **réel aujourd'hui** après le pivot Equipment-First du 9 septembre 2026.

L'état précédent, centré combat-plan-first, est conservé intégralement dans `docs/history/PROJECT_STATE-pre-equipment-pivot-2026-09-09.md`.

## Produit actif

Dofus Optimizer est désormais un **optimiseur d'équipement**.

Le chemin produit cible est : contraintes d'équipement + orientation offensive + sondes synthétiques → meilleur équipement légal.

La classe, les vrais sorts, les rotations, T1/T2/T3 et le Combat Planner ne sont plus des dépendances du produit actif.

## Nouveau cœur synthétique

`js/synthetic-offense.js` fournit le premier primitive pur Equipment-First :

- profils SMALL / MEDIUM / LARGE ;
- mono Terre/Feu/Eau/Air, 1 à 3 éléments ;
- MULTI exclusif à quatre lignes ;
- invariant continu 1 PA = 10 base normale ;
- critique de base 15/20/25 % ;
- base critique ×1,25 ;
- stats canoniques `earth/fire/water/air`, `power`, `damage`, `damageEarth/Fire/Water/Air`, `crit`, `critDamage` ;
- Crit borné à 0..100 % comme le moteur existant ;
- reste PA proportionnel appliqué au résultat complet ;
- agrégation équilibrée minimum puis moyenne ;
- tie-break canonique stable.

Le module n'importe pas le moteur de sorts, source-certification ou Combat Planner. Il réutilise uniquement l'accès canonique `stat()` pour le vocabulaire/agrégation des stats. Le calcul de ligne reste synthétique et continu afin de préserver notamment MEDIUM MULTI `4 × 7,5 = 30`.

## Runtime actif existant

Le runtime historique reste en place pendant ce pivot :

- UI principale : `index.html` ;
- Optimiseur : `js/optimizer-v2-app.js` ;
- Worker : `js/optimizer-worker.js` ;
- Génération d'architectures : `js/architecture-search-v2.js` ;
- Recherche de candidats : `optimizer/candidate-search.js` ;
- Atelier : `js/workshop/` ;
- PWA/offline : `service-worker.js`.

Cette PR **ne raccorde pas** encore `synthetic-offense.js` à la recherche et ne modifie pas l'UI. Les sélecteurs classe/sorts historiques peuvent donc encore être présents dans le runtime courant : ils sont un écart connu, pas le contrat futur.

## Contrats protégés

1. Un build rendu doit être légal.
2. Les minima utilisateur sont des contraintes dures.
3. **FEASIBLE SET NON-EMPTY ⇒ SEARCH MUST RETURN A RESULT**.
4. Le scoring synthétique ne peut classer que des candidats déjà faisables.
5. Le futur ranking Equipment-First doit maximiser le minimum demandé, puis la moyenne, puis un tie-break déterministe.
6. Aucune hypothèse de classe, de sort réel ou de contexte mêlée/distance ne doit être injectée dans le cœur synthétique pur.

## Écarts actifs à traiter dans les slices suivantes

- **Search integration** : raccorder le scoring synthétique après la faisabilité, sans casser beam/Pareto/rescue ni l'invariant de complétude.
- **UI** : retirer le choix de classe du chemin actif et exposer les orientations/profils synthétiques.
- **Contraintes PA/PM** : afficher `PA [valeur] [exo]` et `PM [valeur] [exo]` en permanence.
- **Autres contraintes** : fournir un seul contrôle `dropdown + valeur + add`, alimenté par le vrai moteur de contraintes.
- **Exo/FM** : conserver le modèle de légalité existant et faire évoluer l'interface sans inventer un modèle parallèle.

## Interface cible documentée

Future UI active :

- aucun choix de classe ;
- `PA [valeur] [exo]` ;
- `PM [valeur] [exo]` ;
- autres contraintes via `[constraint dropdown] [value] [add]` ;
- contraintes actives affichées en liste compacte (`Initiative ≥ 4000`, `Range ≥ 4`, `Summons ≥ 2`, etc.) ;
- options disponibles dérivées du moteur de contraintes réel.

Aucune de ces modifications UI n'est implémentée dans Synthetic Offense Core V1.

## Travail PARKED

Le travail suivant reste dans le repository mais sort du chemin produit actif :

- source truth / semantic certification des sorts ;
- connaissance Iop Terre ;
- Certified Combat Planner ;
- planification spécifique à une classe ;
- objectifs T1/T2/T3 et préparation inter-tours.

Il n'est ni supprimé ni considéré comme erroné. Aucun nouveau bridge de sorts réels ne doit être ajouté dans les slices Equipment-First sans nouvelle décision directeur.

## Validation attendue

Les gates permanents restent :

- syntaxe/tests Node ;
- tests ciblés du nouveau primitive ;
- recette navigateur réelle ;
- product smoke ;
- benchmarks de régression des chemins principaux lorsque la slice les concerne.

Le CI canonique reste exclusivement le runner self-hosted : `[self-hosted, linux, x64, steam-machine, dofus]`.
