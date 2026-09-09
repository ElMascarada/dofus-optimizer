# Contrat produit

Ce document définit la **direction produit canonique active** de Dofus Optimizer à partir du pivot Equipment-First du 9 septembre 2026.

L'ancien contrat combat-plan-first est conservé intégralement dans `docs/history/PRODUCT_CONTRACT-combat-plan-first-2026-09-09.md`. Il reste une trace historique valide du travail réalisé, mais ses objectifs classe/sorts/T1-T3 sont désormais **PARKED** et ne pilotent plus le chemin produit actif.

## Objectif primaire actif

Dofus Optimizer est un **optimiseur d'équipement**.

> **Trouver le meilleur équipement légal sous les contraintes utilisateur, puis classer les builds faisables avec des sondes offensives synthétiques indépendantes des classes et des sorts réels.**

Flux produit actif cible :

1. lire les contraintes d'équipement de l'utilisateur ;
2. ne conserver que les builds légaux qui satisfont toutes les contraintes ;
3. mesurer chaque build avec les profils offensifs synthétiques demandés ;
4. maximiser d'abord le plus faible score demandé ;
5. à égalité, maximiser la moyenne ;
6. à nouvelle égalité, appliquer un tie-break canonique déterministe.

L'identité de classe, les sorts réels, les rotations, T1/T2/T3, la préparation de combat, l'état de combat et la sémantique source des sorts ne font pas partie de l'entrée du produit actif.

## Invariant de recherche

Les minima utilisateur restent des contraintes dures.

> **FEASIBLE SET NON-EMPTY ⇒ SEARCH MUST RETURN A RESULT**

Le score synthétique ne crée jamais la faisabilité et ne peut jamais remplacer les règles de légalité.

Ordre futur obligatoire de la recherche :

1. satisfaire toutes les contraintes d'équipement ;
2. parmi les candidats faisables, maximiser le **minimum** des scores synthétiques demandés ;
3. à égalité, maximiser leur **moyenne** ;
4. appliquer un tie-break déterministe.

La PR Equipment-First Synthetic Offense Core V1 n'intègre pas encore ce ranking dans la recherche.

## Sondes offensives synthétiques

Les sondes synthétiques sont des **métriques internes de qualité d'équipement**. Elles ne sont pas des sorts Dofus et ne doivent jamais être présentées comme des sorts sélectionnables.

Orientations élémentaires : `earth`, `fire`, `water`, `air`, `multi`.

- mono : 1 à 3 éléments sélectionnés, de poids égal ;
- plus de 3 éléments mono : invalide ;
- `multi` est exclusif ;
- `multi` représente exactement quatre lignes, une Terre, une Feu, une Eau et une Air.

Profils :

| Profil | PA nominal | Base mono normale | Base MULTI normale | Crit de base |
| --- | ---: | ---: | ---: | ---: |
| SMALL | 2 | 20 | 4 × 5 | 15 % |
| MEDIUM | 3 | 30 | 4 × 7,5 | 20 % |
| LARGE | 4 | 40 | 4 × 10 | 25 % |

Invariant : **1 PA = 10 dégâts de base synthétiques normaux** en mono comme en MULTI.

La base critique synthétique vaut `base normale × 1,25`. Les valeurs sont continues : la ligne `7,5` de MEDIUM MULTI ne doit jamais être arrondie pour imiter un sort réel.

## Sémantique des statistiques offensives

Le scoring synthétique réutilise le vocabulaire de stats normalisé du repository :

- caractéristiques : `earth`, `fire`, `water`, `air` ;
- Puissance : `power` ;
- dommage fixe générique : `damage` ;
- dommages fixes élémentaires : `damageEarth`, `damageFire`, `damageWater`, `damageAir` ;
- Crit : `crit` ;
- Dommages Critiques : `critDamage`.

Le critique d'équipement s'ajoute en points de pourcentage au critique de base du profil, avec la borne canonique `0..100 %` déjà utilisée par le moteur Dofus.

Pour une ligne élémentaire synthétique :

- caractéristique effective = caractéristique élémentaire + Puissance ;
- `damage` et le dommage fixe de l'élément s'appliquent à la ligne normale et critique ;
- `critDamage` s'applique uniquement à la branche critique ;
- espérance = normale × `(1-p)` + critique × `p`.

Le calcul synthétique est volontairement **continu**. Il ne passe pas par `dofusDamageEndpoint()` ni par l'exécution d'un sort réel, car ces chemins appliquent des floors Dofus légitimes pour les vrais sorts mais incompatibles avec `4 × 7,5 = 30`.

Les modificateurs `spellDamagePct`, `weaponDamagePct`, `meleeDamagePct` et `rangedDamagePct` ne sont pas inclus dans ce cœur : ils portent un contexte source/position que la sonde synthétique pure ne doit pas inventer. Aucun modificateur offensif ambigu n'est ajouté silencieusement.

## Budget PA et reste proportionnel

Pour `A` PA disponibles et un profil de coût nominal `X` :

- `fullCount = floor(A / X)` ;
- `remainder = A % X` ;
- `partialFactor = remainder / X` ;
- contribution partielle = **résultat complet de la sonde × partialFactor**.

Le reste conserve l'identité du profil. `11 PA + LARGE` vaut `2,75 × LARGE`, et non `2 × LARGE + MEDIUM`.

Toutes les composantes sont proratisées ensemble, y compris dégâts fixes et Dommages Critiques. Un reste ne crée jamais une nouvelle application complète de dégâts fixes. La même règle s'applique à la sonde MULTI quatre lignes.

## Équilibre multi-profils

Pour plusieurs éléments/profils, chaque combinaison demandée produit une sonde indépendante. Le ranking agrégé n'est **pas** une somme :

- score primaire = minimum des scores demandés ;
- score secondaire = moyenne des scores demandés.

Ainsi un build équilibré peut battre un build très spécialisé dès que son profil le plus faible est meilleur.

## Travail combat désormais PARKED

Sont préservés mais hors du chemin produit actif :

- certification sémantique des vrais sorts ;
- vérité source des sorts ;
- Certified Combat Planner ;
- planification de combat spécifique aux classes ;
- objectifs T1/T2/T3 et préparation inter-tours.

Ce travail n'est ni supprimé ni déclaré incorrect. Il pourra être réévalué dans un autre produit ou une phase future, mais aucun développement actif ne doit le prolonger sans nouvelle décision directeur.

## Interface cible — contrat futur, non implémenté ici

L'interface active future doit supprimer le choix de classe.

Contraintes principales toujours visibles :

- `PA [valeur] [exo]`
- `PM [valeur] [exo]`

Le contrôle adjacent représente l'autorisation Exo PA/PM selon le modèle d'équipement/exo existant.

Les autres contraintes passent par un contrôle unique :

`[ constraint dropdown ] [ value ] [ add ]`

Exemple : `Initiative | 4000 | Add`, puis liste compacte des contraintes actives :

- `Initiative ≥ 4000`
- `Range ≥ 4`
- `Summons ≥ 2`

Le dropdown doit exposer uniquement les contraintes réellement supportées par le moteur de contraintes. Il est interdit de créer un modèle de contraintes propre à l'UI.

## Forgemagie et légalité

Les règles structurelles d'équipement, conditions, panoplies, PA/PM, exos et FM restent des règles de légalité ou des choix d'équipement. Elles ne sont pas assouplies par le scoring synthétique.

Les autorisations Exo PA/PM sont des permissions, pas des obligations. Les travaux FM détaillés restent soumis aux règles de jeu certifiées et aux tranches produit ultérieures.

## Hiérarchie de vérité

En cas de contradiction :

1. données/règles Dofus certifiées pour les faits d'équipement et de légalité ;
2. `docs/PRODUCT_CONTRACT.md` pour l'intention produit active ;
3. code runtime + tests pour savoir ce qui est déjà implémenté ;
4. `PROJECT_STATE.md` pour les écarts connus ;
5. documents `docs/history/`, historique Git et anciennes PR comme contexte historique.
