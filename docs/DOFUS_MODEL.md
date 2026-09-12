# Modèle Dofus courant

Ce document décrit les règles métier réellement utilisées par l'Optimiseur Equipment-Only. Les modules combat/sorts encore présents dans le repository sont conservés pour Atelier, tests et historique ; ils ne définissent plus le contrat de l'Optimiseur actif.

## 1. Build courant

Le build final comporte 16 items :

- 9 slots d'équipement forgeables : coiffe, cape, amulette, deux anneaux, ceinture, bottes, arme, bouclier ;
- 1 compagnon ;
- 6 emplacements Dofus/trophées.

La légalité finale est évaluée par `js/complete-equipment-build-evaluator.js` avec :

- règles de slots ;
- unicité/conditions d'items ;
- restrictions Dofus/trophées ;
- bonus de panoplies ;
- caps permanents PA/PM ;
- contraintes utilisateur ;
- politique FM active.

## 2. PA / PM

PA et PM sont des ressources et des contraintes, pas un score offensif.

Le produit respecte les caps permanents certifiés ; notamment un build permanent à 13 PA est invalide même s'il aurait un meilleur score offensif.

Quand `FM = Oui`, le modèle structurel actif est :

- base personnage : **8 PA / 4 PM** ;
- Exo PA : +1 ;
- Exo PM : +1 ;
- équipement, bonus de sets et Dofus/trophées ferment ensuite les minima demandés.

Quand `FM = Non`, aucun exo structurel n'est ajouté implicitement.

## 3. FM

### FM = Oui

Les neuf slots forgeables peuvent recevoir au plus un assignment spécial chacun.

Les deux exos structurels PA/PM consomment deux assignments. Il reste donc **sept assignments offensifs**.

Pour chaque assignment offensif, le moteur compare automatiquement :

- `+1 % dommages sorts` ;
- `+8 dommages critiques` si l'item n'a pas de dommages critiques natifs.

Le choix est fait selon le score synthétique final et les contraintes FM sensibles. Le produit ne demande pas à l'utilisateur de répartir lui-même les sept assignments.

Dofus/trophées et compagnon ne sont jamais forgeables par cette politique.

### FM = Non

Aucun exo PA/PM ni bonus offensif FM n'est appliqué.

## 4. Contraintes

Les contraintes actives sont des minima durs : PA, PM, Initiative, Vitalité, résistances et toute autre clé explicitement supportée par le moteur.

Une contrainte ne devient jamais un bonus de score. Les heuristiques peuvent réserver un spécialiste utile à une contrainte, mais la validation finale reste booléenne : satisfait / non satisfait.

## 5. Panoplies

Les bonus de panoplie doivent être appliqués avant de juger la valeur réelle d'un core de set.

Conséquence : des pièces individuellement moyennes peuvent former une architecture supérieure une fois le bonus 2/3/4 pièces actif. Le moteur ne doit pas supprimer destructivement un core uniquement sur la somme brute de ses membres.

## 6. Compagnon

Le compagnon fait partie du contexte offensif final. Il doit être évalué avec l'équipement déjà complété.

Dans la recherche combined, le dernier trim inter-architectures ne doit pas intervenir avant que les descendants d'équipement aient pu voir au moins leur contexte compagnon. Une architecture faible avant compagnon peut avoir un gain marginal élevé après compagnon.

## 7. Dofus et trophées

Les six slots Dofus/trophées sont fermés dans le contexte réel du reste du build.

Le moteur doit notamment :

- conserver les pièces de ressources nécessaires à 12/6 lorsqu'elles débloquent un meilleur build ;
- appliquer les conditions de trophées/panoplies ;
- respecter les caps permanents ;
- éviter les incohérences Crit/Sans crit ;
- comparer les packages complets avec l'évaluateur autoritatif.

Ocre n'est pas un hardcode obligatoire ; Remueur ou d'autres pièces de ressources restent légitimes si le contexte légal/final les rend meilleurs.

## 8. Crit / Sans crit

Le mode `Sans crit` ignore Crit et Dommages Critiques dans l'objectif synthétique et ne doit pas sélectionner Turquoise uniquement pour ces stats.

Le mode Crit/Auto conserve le calcul critique normal. `Robuste majeur` n'est pas interdit par nom dans tous les contextes, mais il ne doit pas gagner contre une alternative strictement meilleure uniquement parce qu'un score partiel a perdu l'effet de sa pénalité Crit.

## 9. Recherche combinée

Pour 2/3 éléments et Multi, le moteur optimise chaque axe demandé indépendamment.

- score primaire : minimum des axes/profils demandés ;
- score secondaire : moyenne ;
- tie-break : déterministe.

`multi` = quatre axes Terre/Feu/Eau/Air. Aucun élément mono ne peut porter le score des trois autres.

La chaîne structurelle active est :

```text
candidate pools
→ set cores
→ architectures
→ equipment completion
→ companion
→ Dofus/trophies
→ authoritative final evaluation
```

Les réserves sémantiques/lineage empêchent qu'un bon build final soit perdu à cause d'un score intermédiaire incomplet.

## 10. Sorts et combat

Le repository conserve une importante connaissance sorts/combat certifiée. Elle est valide pour Atelier/tests/historique, mais elle n'est pas consommée par le chemin Equipment-Only actif.

Une future réactivation du combat dans l'Optimiseur exigerait une décision produit explicite et ne doit jamais être déduite du simple fait que ces modules existent encore dans l'arbre.

## 11. Méthode d'extension

Pour modifier une règle Dofus :

1. prouver la règle ;
2. préserver/normaliser la donnée nécessaire ;
3. modifier une primitive métier partagée ;
4. ajouter un test ciblé ;
5. vérifier la légalité finale ;
6. vérifier la recherche réelle sur catalogue ;
7. seulement ensuite modifier les heuristiques de performance.

Ne pas compenser une mauvaise modélisation par un bonus ad hoc de scoring ou un beam arbitrairement plus large.
