# État courant du projet

Ce document décrit l'état **réel aujourd'hui** après le pivot Equipment-First du 9 septembre 2026.

L'état précédent, centré combat-plan-first, est conservé intégralement dans `docs/history/PROJECT_STATE-pre-equipment-pivot-2026-09-09.md`.

## Produit actif

Dofus Optimizer est désormais un **optimiseur d'équipement**.

Le chemin produit cible est : contraintes d'équipement + orientation offensive + sondes synthétiques → meilleur équipement légal.

La classe, les vrais sorts, les rotations, T1/T2/T3 et le Combat Planner ne sont plus des dépendances du produit actif.

## Cœur synthétique

`js/synthetic-offense.js` est le primitive offensif canonique Equipment-First :

- profils SMALL / MEDIUM / LARGE ;
- mono Terre/Feu/Eau/Air, 1 à 3 éléments ;
- MULTI exclusif à quatre lignes ;
- invariant continu 1 PA = 10 base normale ;
- critique de base 15/20/25 % ;
- base critique ×1,25 ;
- stats canoniques `earth/fire/water/air`, `power`, `damage`, `damageEarth/Fire/Water/Air`, `crit`, `critDamage` ;
- Crit borné à 0..100 % ;
- reste PA proportionnel appliqué au résultat complet ;
- agrégation équilibrée minimum puis moyenne ;
- tie-break canonique stable.

Le module n'importe pas le moteur de sorts, source-certification ou Combat Planner. Le calcul reste synthétique et continu afin de préserver notamment MEDIUM MULTI `4 × 7,5 = 30`.

## Complete Equipment Build Evaluator

`js/complete-equipment-build-evaluator.js` fournit désormais le chemin autoritaire **pour évaluer une combinaison d'équipement complète déjà donnée** sans classe ni sorts réels.

Il assemble :

- stats natives des objets ;
- bonus de panoplie ;
- structure complète des slots et règle Prysmaradite ;
- conditions d'objets ;
- scroll + budget de caractéristiques + vrais soft caps ;
- contraintes dures, dont Initiative avec la sémantique canonique ;
- exos structurels PA/PM uniquement ;
- caps permanents PA/PM sur ce nouveau chemin ;
- `evaluateSyntheticOffense()` avec le **PA permanent réel final** comme budget offensif.

`js/synthetic-characteristics.js` optimise exactement l'allocation des caractéristiques selon le même objectif lexicographique que le score final : minimum demandé d'abord, moyenne ensuite, tie-break d'allocation déterministe. MULTI reste une seule sonde quatre lignes. La correction est protégée par un oracle exhaustif indépendant sur des budgets/soft-caps réduits.

La FM offensive historique (`spellDamagePct`, objectif de sorts, contexte mêlée/distance/arme) reste PARKED et n'est pas appliquée par ce nouvel évaluateur. Les helpers d'exos PA/PM ont été isolés dans `js/structural-exos.js` afin que le chemin legacy conserve son comportement.

L'ancien `evaluateCompleteBuild()` n'est pas remplacé et reste utilisé par le runtime/search historique tant que la migration Search n'est pas effectuée.

## Runtime actif existant

Le runtime historique reste en place pendant ce pivot :

- UI principale : `index.html` ;
- Optimiseur : `js/optimizer-v2-app.js` ;
- Worker : `js/optimizer-worker.js` ;
- Génération d'architectures : `js/architecture-search-v2.js` ;
- Recherche de candidats : `optimizer/candidate-search.js` ;
- Atelier : `js/workshop/` ;
- PWA/offline : `service-worker.js`.

Le nouvel évaluateur Equipment-First **n'est pas encore raccordé à Candidate Search** et cette slice ne modifie pas l'UI.

## Contrats protégés

1. Un build rendu doit être légal.
2. Les minima utilisateur sont des contraintes dures.
3. **FEASIBLE SET NON-EMPTY ⇒ SEARCH MUST RETURN A RESULT**.
4. Le scoring synthétique ne peut classer que des candidats déjà faisables.
5. Le ranking Equipment-First maximise le minimum demandé, puis la moyenne, puis un tie-break déterministe.
6. Aucune hypothèse de classe, de sort réel ou de contexte mêlée/distance n'est injectée dans le cœur Equipment-First.
7. Un exo PM peut rendre un build faisable mais n'ajoute aucune valeur offensive synthétique directe.
8. Un PA permanent légal supplémentaire augmente réellement le budget de sondes synthétiques.

## Prochaine seam active

**Candidate Search migration** : raccorder la génération/recherche de candidats au Complete Equipment Build Evaluator autoritaire, sans casser beam/Pareto/rescue ni l'invariant de complétude.

Après cette seam :

- UI : retirer le choix de classe du chemin actif et exposer orientations/profils synthétiques ;
- contraintes PA/PM : `PA [valeur] [exo]` et `PM [valeur] [exo]` ;
- autres contraintes : `dropdown + valeur + add` alimenté par le vrai moteur ;
- FM : conserver les exos structurels actifs et traiter séparément toute future doctrine de FM offensive synthétique.

## Travail PARKED

Le travail suivant reste dans le repository mais sort du chemin produit actif :

- source truth / semantic certification des sorts ;
- connaissance Iop Terre ;
- Certified Combat Planner ;
- planification spécifique à une classe ;
- objectifs T1/T2/T3 et préparation inter-tours ;
- FM offensive historique pilotée par le moteur de sorts.

Il n'est ni supprimé ni considéré comme erroné. Aucun nouveau bridge de sorts réels ne doit être ajouté dans les slices Equipment-First sans nouvelle décision directeur.

## Validation attendue

Les gates permanents restent :

- syntaxe/tests Node ;
- tests ciblés du nouveau primitive ;
- recette navigateur réelle ;
- product smoke ;
- benchmarks de régression des chemins principaux lorsque la slice les concerne.

Le CI canonique reste exclusivement le runner self-hosted : `[self-hosted, linux, x64, steam-machine, dofus]`.
