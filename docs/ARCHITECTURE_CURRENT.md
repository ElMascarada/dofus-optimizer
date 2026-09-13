# Architecture courante

Ce document décrit uniquement l'architecture réellement utilisée par le produit courant. La direction fonctionnelle canonique est dans `docs/PRODUCT_CONTRACT.md` ; l'état d'avancement et les preuves de certification sont dans `PROJECT_STATE.md`.

## Entrée navigateur

`index.html` charge deux surfaces actives partageant les mêmes données normalisées :

- **Atelier** : construction/édition manuelle d'un build, avec analyse combat propre à l'Atelier ;
- **Optimiseur** : recherche **Equipment-Only** sous contraintes, indépendante des classes/sorts/rotations.

L'ancien message « le plan de combat est l'objectif, l'équipement est un moyen » ne décrit plus l'Optimiseur actif. Il appartient au travail combat historique/Atelier.

## Optimiseur Equipment-Only

Chemin navigateur canonique :

```text
index.html
  -> js/optimizer-app.js
  -> js/optimizer-worker.js
  -> js/equipment-search-request.js
```

`js/equipment-search-request.js` choisit ensuite le chemin de recherche :

```text
mono
  -> js/equipment-search-v2.js
  -> Equipment-First / Set-Core-First

2 ou 3 éléments explicites, ou Multi
  -> optimizer/combined-set-core-search.js
  -> optimizer/dofus-package-refiner.js
```

Tous les résultats finaux repassent par `js/complete-equipment-build-evaluator.js`, qui reste l'autorité pour la légalité, les stats finales, la FM et le score synthétique final.

Le worker isole le calcul coûteux de l'UI. Les messages UI/worker sont une frontière produit : toute modification doit préserver les états d'arrêt, erreur, progression et résultat.

## Recherche combinée

Le chemin combiné ne doit pas être réduit à un beam scalaire unique. Son architecture active est :

```text
catalogue
  -> candidate pools
  -> set cores avec bonus de panoplie activés
  -> architecture retention
       • balanced offense
       • AP/PM structure
       • parent -> terminal set lineage
       • near-complete architecture reserve
       • requested-stat specialists
  -> equipment completion
       • best descendant per architecture
       • semantic specialists per architecture
  -> companion expansion
       • primary score
       • bounded parent->child marginal-gain reserve
  -> Dofus/trophy closure
       • resource compatibility
       • static item conditions
       • exact/contextual final evaluation
  -> final min/mean synthetic ranking
```

Les réserves sémantiques existent parce qu'une architecture faible à un étage peut devenir la meilleure après ajout du dernier slot, du compagnon ou du package Dofus. Une optimisation ne doit pas supprimer cette capacité seulement pour réduire un compteur de beam.

## FM active

Le produit expose un seul choix utilisateur `FM Oui / Non`.

Quand `FM Oui` :

- +1 Exo PA et +1 Exo PM sont structurellement intégrés dès le début de recherche ;
- le contexte personnage part donc de 8 PA / 4 PM avant équipement ;
- les deux exos consomment deux assignments sur les neuf slots forgeables ;
- les sept assignments offensifs restants sont optimisés automatiquement ;
- chaque assignment offensif choisit `+1 % dommages sorts` ou `+8 dommages critiques` si l'item n'a pas déjà une ligne native de dommages critiques et si ce choix est supérieur.

Les Dofus/trophées et le compagnon ne reçoivent jamais ces FM.

## Scoring synthétique

L'Optimiseur actif ne lance pas de vrais sorts.

Les profils synthétiques sont :

- Petites lignes (`small`)
- Mixte (`medium`)
- Grosses lignes (`large`)

Pour plusieurs éléments, chaque axe est calculé indépendamment. Le classement final maximise :

1. le minimum des scores demandés ;
2. puis leur moyenne ;
3. puis un tie-break déterministe.

`multi` exige quatre axes réels : Terre, Feu, Eau et Air. Aucun axe mono ne peut porter seul le score Multi.

## Contraintes et légalité

Les minima utilisateur sont des contraintes dures. Les heuristiques de recherche peuvent ordonner et réserver des états, mais ne doivent jamais :

- rendre légal un build illégal ;
- dépasser les caps permanents PA/PM ;
- supprimer toute solution d'un ensemble faisable ;
- remplacer la comparaison finale par un score partiel.

Invariant permanent :

> **FEASIBLE SET NON-EMPTY ⇒ SEARCH MUST RETURN A RESULT**

## Atelier

`js/workshop/` reste une application active distincte.

L'Atelier peut utiliser classe, sorts, rotations, T1/T2/T3 et modules combat. Ces dépendances ne doivent pas remonter dans le contrat de requête de l'Optimiseur Equipment-Only.

L'Atelier et l'Optimiseur partagent les règles communes de build, légalité, statistiques, sets, FM et évaluation finale quand elles concernent l'équipement.

## Combat historique / partagé

Les modules sous `js/combat/`, `js/spells.js`, `js/turn-optimizer.js` et autres composants combat ne sont pas une dépendance du chemin Optimiseur actif. Ils sont conservés pour Atelier, tests, connaissances certifiées et travail historique.

Ne pas les supprimer ou les réactiver dans l'Optimiseur sur simple impression de conversation.

## Search Memory

Les primitives sous `js/search-memory/` restent présentes, mais la mémoire ne doit jamais servir un ancien résultat à la place d'une recherche fraîche lorsque la vérité produit/cataloque/règles a changé. Le chemin produit actif est certifié pour recalculer les recherches.

## Données

Pipeline de maintenance :

```text
Dofusdude
  -> scripts de sync
  -> normalisation
  -> curation/certification
  -> data/normalized/
  -> js/data-loader.js
  -> Optimiseur / Atelier
```

La vérité source des sorts reste séparée du catalogue combat actif et ne fait pas partie de l'entrée Optimiseur Equipment-Only.

## PWA

`service-worker.js` reste actif. Toute suppression/renommage d'un fichier du shell doit mettre à jour son cache applicatif et être validé par la recette navigateur.

## Validation permanente

- `npm run check`
- `npm test`
- `npm run smoke:product`
- `npm run recipe:browser`
- `git diff --check`
- probes réels combinés quand la recherche 2/3 éléments ou Multi est modifiée

La recette navigateur nécessite un exécutable Chrome/Chromium détectable dans le `PATH` ou fourni via `CHROME_BIN`.
