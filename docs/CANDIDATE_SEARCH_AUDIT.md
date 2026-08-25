# Optimizer V2 — Audit de la recherche d'équipements (baseline PR Candidate Policy)

## Périmètre

Cet audit décrit le runtime de recherche réellement utilisé sur `main` après la PR de moteur de sorts générique. Il ne couvre ni l'UI, ni le stockage local, ni une nouvelle mécanique de classe.

## Pipeline réel avant refactor

```text
catalogue équipements normalisé
  -> js/candidate-prefilter.js
     -> scoring objectif + contraintes + heuristiques de set
     -> réserves contraintes/offensives/set
     -> shortlist par slot
  -> js/architecture-search-v2.js
     -> repart du catalogue brut
     -> recalcule un score item concurrent
     -> reconstruit ses propres pools par slot
     -> réserves AP/PM/contraintes/conditionless/passive-free
     -> groupChoices + beams
     -> architectures de panoplies existantes + voie standalones
     -> états partiels classés par legalityPriority
     -> limite d'états par étape
     -> builds complets shortlistés
  -> js/complete-build-evaluator.js
     -> structure / conditions / bonus de panoplie
     -> caractéristiques / FM
     -> contraintes permanentes strictes
     -> contraintes par tour strictes
     -> score équipement final
  -> js/offensive-slot-refiner.js
     -> extrait des skeletons
     -> reconstruit encore des pools compagnon / Dofus
     -> réserves offensives/AP/PM/Prysmaradites
     -> beams de combinaisons
     -> evaluateCompleteBuild()
  -> js/optimizer-worker.js
     -> shortlist recherche / fallback légal
     -> raffinement offensif
     -> combat coarse
     -> feedback offensif
     -> combat final précis
     -> diversification
```

## Duplication de politique constatée

### `candidate-prefilter.js`

Décide actuellement :

- dimensions offensives ;
- score d'un item ;
- pertinence mono-élément ;
- réserve par contrainte ;
- réserve offensive par stat ;
- réserve de pièces de panoplie ;
- limites par slot.

### `architecture-search-v2.js`

Réinvente ensuite :

- dimensions de contrainte ;
- pondérations de contrainte ;
- score d'un item ;
- réserves AP/PM ;
- réserves de contraintes ;
- réserves d'items sans condition / sans passif ;
- limites de pools ;
- limites de choix de groupe ;
- beams et quotas de buckets ;
- priorité des états partiels.

Le point critique est que `buildSlotPool()` reçoit **le catalogue brut**. La shortlist produite par `candidate-prefilter.js` n'est donc qu'une préférence parmi d'autres, pas la frontière `catalogue -> pools` décrite par l'architecture cible.

### `offensive-slot-refiner.js`

Réinvente une troisième politique pour les slots `companion` et `dofus` :

- gain offensif local ;
- branches crit / non-crit ;
- réserves puissance / Do Crit / dégâts / % dégâts / éléments ;
- AP/PM ;
- Prysmaradites ;
- tailles de pools et beams de combinaisons.

### `optimizer-worker.js`

Contient encore les capacités de recherche et de raffinement : taille du Top structurel, largeur des passes combat, nombre de candidats feedback et limites multi-tour.

## Tous les endroits où un item ou un build peut disparaître avant l'évaluation finale

1. **Filtre mono-élément** dans `candidate-prefilter.js` : un objet hors élément n'est conservé que s'il est reconnu comme offensif générique, utile à une contrainte ou à un plan de set.
2. **Cap de shortlist par slot** : après réserves, le reste est rempli selon un score unique ; un item hors réserve peut disparaître uniquement parce que son score est inférieur.
3. **Reconstruction `buildSlotPool()`** : nouvelle sélection et nouveau cap sur le catalogue brut.
4. **`groupChoices()`** : les combinaisons de slots multiples sont coupées par un beam et, pour Dofus, par des buckets AP/PM.
5. **`keepDiverseStates()`** : les builds partiels sont coupés par une priorité heuristique, sans preuve que les contraintes manquantes sont encore atteignables.
6. **`evaluationPool`** : seuls les premiers builds complets du classement heuristique atteignent `evaluateCompleteBuild()`.
7. **`offensive-slot-refiner.js`** : les pools compagnon/Dofus et leurs combinaisons sont de nouveau tronqués avant l'évaluation complète.
8. **`optimizer-worker.js`** : seules certaines tailles de shortlist poursuivent jusqu'au combat coarse puis précis.

## Ce qui est déjà une bonne brique réutilisable

`js/search-space.js` contient des primitives qui correspondent à la cible :

- `relevantStatKeys()` pour dériver des dimensions de contexte ;
- `optimisticItemStats()` pour les contributions positives et passifs bornés ;
- `pruneDominatedCandidates()` pour un Pareto partitionné par compatibilité structurelle ;
- `buildSuffixCaps()` pour calculer des maxima théoriques sûrs sur les choix restants.

La PR Candidate Policy doit réutiliser ces primitives au lieu de maintenir une seconde implémentation du Pareto ou des bornes.

## Frontières à obtenir après refactor

```text
catalogue
  -> CandidatePolicy (dimensions, spécialistes, Pareto, raisons)
  -> CandidateSearch / CandidatePrefilter (pools uniques)
  -> architecture search (consomme uniquement ces pools)
     -> pruning de faisabilité prouvé
     -> upper bound offensif optimiste
  -> CompleteBuildEvaluator (vérité finale)
  -> raffinement offensif (consomme la même policy)
  -> combat coarse
  -> combat précis
```

## Invariants de migration

- un score offensif peut ordonner mais ne peut pas, seul, prouver qu'un item est inutile ;
- une contrainte positive crée une dimension de conservation avant la recherche ;
- Initiative, Vitalité, résistances, PA, PM et PO doivent pouvoir survivre même sur un item offensivement faible ;
- le Pareto ne compare que des candidats structurellement compatibles ;
- une branche n'est déclarée impossible que si `courant + maximum théorique restant < minimum` ;
- une branche n'est coupée sur l'offense que par une borne supérieure volontairement optimiste ;
- `CompleteBuildEvaluator` reste la seule vérité de validité finale ;
- les Set Cores complets restent hors scope : la policy ne fait que prévoir la raison de conservation `set-core`.
