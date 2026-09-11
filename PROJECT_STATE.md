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

`js/complete-equipment-build-evaluator.js` fournit le chemin autoritaire **pour évaluer une combinaison d'équipement complète déjà donnée** sans classe ni sorts réels.

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

`js/synthetic-characteristics.js` optimise exactement l'allocation des caractéristiques selon le même objectif lexicographique que le score final : minimum demandé d'abord, moyenne ensuite, tie-break d'allocation déterministe. MULTI reste une seule sonde quatre lignes.

La FM offensive historique (`spellDamagePct`, objectif de sorts, contexte mêlée/distance/arme) reste PARKED et n'est pas appliquée par ce nouvel évaluateur. Les helpers d'exos PA/PM vivent dans `js/structural-exos.js` afin que le chemin legacy conserve son comportement.

## Equipment-First Search

`js/equipment-search-v2.js` expose désormais `searchEquipmentArchitecturesV2()` comme première recherche publique Equipment-First, avec `optimizer/equipment-candidate-policy.js` comme politique de candidats dédiée.

Le nouveau chemin prend uniquement :

- catalogue d'objets ;
- panoplies ;
- contraintes dures ;
- politique d'exos PA/PM ;
- requête `syntheticOffense` ;
- objets imposés ;
- profil de recherche / top N / callbacks.

Il ne demande ni classe, ni vrais sorts, ni sélection de sorts, ni tour, ni Combat Planner.

La politique de candidats conserve les dimensions réellement utiles au score synthétique, les contraintes, les conditions d'objets et les ressources structurelles. Les anciennes dimensions offensives `spellDamagePct`, mêlée/distance/arme et finalDamage T1/T2/T3 ne guident pas ce chemin. Initiative réutilise la sémantique canonique et rend les quatre caractéristiques élémentaires pertinentes lorsqu'elle est contrainte ou condition-relevant.

Le PA reste à la fois structurel et offensif : un 12 PA légal peut battre un 11 PA même si le minimum demandé est 11. Le PM reste structurel seulement.

Les états partiels utilisent un proxy synthétique heuristique sensible aux éléments/profils demandés. Aucun upper bound offensif synthétique n'est utilisé pour du safe pruning dans cette slice ; les suppressions de beam sont donc explicitement comptées comme `heuristicTrimmed`, pas comme pruning admissible.

Toute combinaison complète retenue pour vérité finale passe obligatoirement par `evaluateCompleteEquipmentBuild()`. Le top N final utilise `compareCompleteEquipmentBuildResults()` : minimum synthétique, puis moyenne, puis identité canonique.

La certification réduite utilise un oracle exhaustif indépendant de la politique de candidats/beam/Pareto pour mono, équilibre multi-éléments, MULTI, Crit/Large, flat/Small, surplus PA, Initiative, panoplie, exos structurels et top-3.

## Runtime historique / UI

Le runtime historique reste en place pendant ce pivot :

- UI principale : `index.html` ;
- Optimiseur : `js/optimizer-v2-app.js` ;
- Worker : `js/optimizer-worker.js` ;
- ancienne génération d'architectures : `js/architecture-search-v2.js` ;
- ancienne recherche de candidats : `optimizer/candidate-search.js` ;
- ancien évaluateur complet : `js/complete-build-evaluator.js` ;
- Atelier : `js/workshop/` ;
- PWA/offline : `service-worker.js`.

Ces chemins restent PARKED mais fonctionnels. L'UI n'est pas encore raccordée à `searchEquipmentArchitecturesV2()`.

## Contrats protégés

1. Un build rendu doit être légal.
2. Les minima utilisateur sont des contraintes dures.
3. **FEASIBLE SET NON-EMPTY ⇒ SEARCH MUST RETURN A RESULT**.
4. Le scoring synthétique ne peut classer que des candidats déjà faisables.
5. Le ranking Equipment-First maximise le minimum demandé, puis la moyenne, puis un tie-break déterministe.
6. Aucune hypothèse de classe, de sort réel ou de contexte mêlée/distance n'est injectée dans le cœur Equipment-First.
7. Un exo PM peut rendre un build faisable mais n'ajoute aucune valeur offensive synthétique directe.
8. Un PA permanent légal supplémentaire augmente réellement le budget de sondes synthétiques.
9. En cas d'incertitude de dominance, conserver le candidat est préférable à un faux négatif de recherche.

## Prochaine seam active

**Equipment-Only UI** : raccorder l'interface au nouveau chemin Equipment-First sans supprimer le legacy tant que la migration n'est pas validée.

Interface cible :

- aucun choix de classe sur le chemin actif ;
- orientations élémentaires + profils synthétiques ;
- `PA [valeur] [exo]` et `PM [valeur] [exo]` ;
- autres contraintes via `dropdown + valeur + add` alimenté par le vrai moteur ;
- résultats affichant équipement, stats finales, panoplies, caractéristiques, exos et diagnostics synthétiques.

## Travail PARKED

Le travail suivant reste dans le repository mais sort du chemin produit actif :

- source truth / semantic certification des sorts ;
- connaissance Iop Terre ;
- Certified Combat Planner ;
- planification spécifique à une classe ;
- objectifs T1/T2/T3 et préparation inter-tours ;
- FM offensive historique pilotée par le moteur de sorts ;
- ancien Candidate Search / Architecture Search spell-driven tant que l'UI n'est pas migrée.

Il n'est ni supprimé ni considéré comme erroné. Aucun nouveau bridge de sorts réels ne doit être ajouté dans les slices Equipment-First sans nouvelle décision directeur.

## Validation attendue

Les gates permanents restent :

- syntaxe/tests Node ;
- tests ciblés Equipment-First ;
- oracle exhaustif réduit ;
- probe catalogue réel `earth + large`, PA >= 12, PM >= 6, top 3 ;
- recette navigateur réelle ;
- product smoke ;
- benchmarks de régression historiques.

Le CI canonique reste exclusivement le runner self-hosted : `[self-hosted, linux, x64, steam-machine, dofus]`.
