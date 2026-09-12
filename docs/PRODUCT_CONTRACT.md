# Contrat produit

Ce document définit la **direction produit canonique active** de Dofus Optimizer depuis le pivot Equipment-First du 9 septembre 2026 et sa fermeture combined-search de septembre 2026.

L'ancien contrat combat-plan-first est conservé dans `docs/history/PRODUCT_CONTRACT-combat-plan-first-2026-09-09.md`. Il reste une trace historique valide, mais ses objectifs classe/sorts/T1-T3 sont **PARKED** pour l'Optimiseur actif.

## Objectif primaire actif

Dofus Optimizer est un **optimiseur d'équipement**.

> **Trouver le meilleur équipement légal sous les contraintes utilisateur, puis classer les builds faisables avec des sondes offensives synthétiques indépendantes des classes et des sorts réels.**

Flux produit actif :

1. lire les contraintes d'équipement ;
2. ne conserver que les builds légaux satisfaisant toutes les contraintes ;
3. mesurer chaque build avec les profils offensifs synthétiques demandés ;
4. maximiser d'abord le plus faible score demandé ;
5. à égalité, maximiser la moyenne ;
6. appliquer un tie-break canonique déterministe.

Classe, sorts réels, rotations, T1/T2/T3 et scénario combat ne font pas partie de l'entrée Optimiseur active.

## Invariants de recherche

Les minima utilisateur restent des contraintes dures.

> **FEASIBLE SET NON-EMPTY ⇒ SEARCH MUST RETURN A RESULT**

Le score synthétique ne crée jamais la faisabilité et ne peut jamais remplacer les règles de légalité.

Pour les recherches combinées, un second invariant est canonique :

> **Une architecture sémantiquement distincte ne doit pas être détruite uniquement parce que son score partiel est faible avant que son dernier équipement, son compagnon ou sa fermeture Dofus soient visibles.**

Les corrections de complétude doivent donc préserver des lignées et spécialistes bornés plutôt qu'élargir arbitrairement un beam global.

## Type de dégâts

L'interface active expose **Type de dégâts** :

- `Petites lignes` → `small`
- `Mixte` → `medium`
- `Grosses lignes` → `large`

Profils synthétiques :

| Profil | PA nominal | Base mono normale | Base MULTI normale | Crit de base |
| --- | ---: | ---: | ---: | ---: |
| SMALL | 2 | 20 | 4 × 5 | 15 % |
| MEDIUM | 3 | 30 | 4 × 7,5 | 20 % |
| LARGE | 4 | 40 | 4 × 10 | 25 % |

Invariant : **1 PA = 10 dégâts de base synthétiques normaux** en mono comme en MULTI.

La base critique synthétique vaut `base normale × 1,25`. Les valeurs restent continues ; `4 × 7,5` n'est jamais arrondi pour imiter un sort réel.

## Éléments et ranking combiné

Orientations : `earth`, `fire`, `water`, `air`, `multi`.

- 1 élément explicite : chemin mono ;
- 2 ou 3 éléments explicites : chemin combined natif ;
- plus de 3 éléments explicites : invalide ;
- `multi` est exclusif et représente exactement quatre axes indépendants Terre, Feu, Eau, Air.

Pour plusieurs axes/profils, chaque combinaison demandée produit une sonde indépendante.

Le classement agrégé est :

1. **minimum** des scores demandés ;
2. **moyenne** des scores demandés ;
3. tie-break déterministe.

Un élément fort ne peut donc pas masquer un axe faible.

## Sémantique offensive

Le scoring synthétique réutilise le vocabulaire de stats normalisé :

- caractéristiques : `earth`, `fire`, `water`, `air` ;
- `power` ;
- `damage` ;
- `damageEarth`, `damageFire`, `damageWater`, `damageAir` ;
- `crit` ;
- `critDamage` ;
- `spellDamagePct` lorsque la FM offensive active l'ajoute.

Pour une ligne élémentaire :

- caractéristique effective = caractéristique élémentaire + Puissance ;
- dégâts fixes génériques + élémentaires s'appliquent à la ligne ;
- `critDamage` s'applique uniquement à la branche critique ;
- la probabilité critique est bornée canoniquement à `0..100 %` ;
- l'espérance mélange branche normale et critique selon cette probabilité.

Le calcul synthétique est indépendant de l'exécution d'un vrai sort.

## Budget PA et reste proportionnel

Pour `A` PA disponibles et un profil de coût nominal `X` :

- `fullCount = floor(A / X)` ;
- `remainder = A % X` ;
- `partialFactor = remainder / X` ;
- contribution partielle = résultat complet de la sonde × `partialFactor`.

Le reste conserve l'identité du profil. Toutes les composantes sont proratisées ensemble.

## Forgemagie active

L'interface expose un contrôle global :

`FM → Oui / Non`

### FM = Non

Aucun Exo PA/PM ni bonus offensif FM n'est inventé par le produit.

### FM = Oui

Le contrat actif est :

- Exo PA +1 **et** Exo PM +1 sont intégrés structurellement dès le début ;
- le personnage de recherche commence donc à **8 PA / 4 PM** avant équipement ;
- les neuf slots forgeables sont : coiffe, cape, amulette, deux anneaux, ceinture, bottes, arme, bouclier ;
- les deux exos structurels consomment deux assignments ;
- il reste **sept assignments offensifs** ;
- chaque assignment offensif choisit automatiquement entre :
  - `+1 % dommages sorts` ;
  - `+8 dommages critiques`, uniquement si l'item n'a pas déjà de dommages critiques natifs et si cette option donne un meilleur résultat.

Compagnon et Dofus/trophées ne reçoivent jamais ces FM.

L'utilisateur ne règle pas manuellement le nombre de FM Do Crit ou Do Sorts.

## Contraintes

PA et PM restent visibles. Les autres contraintes passent par le contrôle de contraintes avancées supporté par le moteur.

Toute contrainte activée est un minimum dur ; elle n'est jamais transformée en bonus de score.

Exemples supportés selon le runtime courant : Initiative, Portée, Invocations, Vitalité, résistances et autres clés explicitement exposées par le moteur.

L'UI ne doit pas inventer un modèle de contraintes parallèle.

## Recherche combinée — doctrine active

Pour 2/3 éléments et Multi, la recherche doit suivre la fermeture suivante :

```text
candidate pools
→ set cores
→ architecture retention
→ equipment completion
→ companion context
→ Dofus/trophy closure
→ authoritative final evaluator
```

Règles obligatoires :

- les bonus de panoplie activés sont inclus avant ranking du core ;
- les lignées parent→set terminal distinctes sont préservées ;
- une architecture à un slot de la fin peut franchir le trim d'architecture ;
- à la completion équipement, conserver le meilleur descendant et des spécialistes sémantiques par architecture ;
- ajouter le compagnon avant le dernier classement inter-architectures ;
- réserver un nombre borné de descendants à fort gain marginal parent→enfant ;
- fermer les Dofus/trophées dans le contexte réel de l'équipement + compagnon ;
- appliquer caps PA/PM, conditions et légalité avant de considérer un candidat final ;
- comparer finalement avec `evaluateCompleteEquipmentBuild()`.

Il est interdit de résoudre une perte de qualité uniquement par une augmentation opaque du beam jusqu'à ce qu'un témoin réapparaisse.

## Résultats

Le produit vise **5 stuffs** lorsqu'une diversité réellement utile est disponible. Si aucun résultat distinct pertinent n'existe, un résultat unique est acceptable.

La diversité ne doit jamais dégrader le classement final : l'appartenance/diversité sélectionne les candidats, puis le score final détermine leur ordre.

## Travail combat PARKED

Sont préservés mais hors du chemin Optimiseur actif :

- certification sémantique des vrais sorts ;
- vérité source des sorts ;
- Certified Combat Planner ;
- planification spécifique aux classes ;
- objectifs T1/T2/T3 et préparation inter-tours.

Ce travail n'est ni supprimé ni déclaré incorrect. Il reste légitime dans l'Atelier ou dans un futur produit explicitement décidé.

## Hiérarchie de vérité

En cas de contradiction :

1. données/règles Dofus certifiées pour les faits d'équipement et de légalité ;
2. `docs/PRODUCT_CONTRACT.md` pour l'intention produit active ;
3. code runtime + tests pour savoir ce qui est déjà implémenté ;
4. `PROJECT_STATE.md` pour l'état de certification et les écarts connus ;
5. `docs/history/`, historique Git et anciennes PR comme contexte historique.
