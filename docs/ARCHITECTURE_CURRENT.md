# Architecture courante

Ce document décrit uniquement l'architecture réellement utilisée par le produit courant.

## Entrée navigateur

`index.html` charge l'interface Atelier + Optimiseur et enregistre le service worker.

Deux surfaces produit principales partagent les mêmes données normalisées :

- Atelier : construction/édition manuelle d'un stuff ;
- Optimiseur : recherche automatisée d'un build selon contraintes et objectif combat.

## Optimiseur

Chemin principal :

```text
index.html
  -> js/optimizer-v2-app.js
  -> js/optimizer-worker.js
  -> js/architecture-search-v2.js
  -> optimizer/candidate-search.js
  -> js/complete-build-evaluator.js / combat
  -> résultats
```

`js/architecture-search-v2.js` est actif malgré son suffixe `v2` : ne pas le traiter comme une ancienne version.

Le worker isole le calcul coûteux de l'UI. Les messages entre UI et worker constituent une frontière produit : les modifier exige de préserver le protocole et les états d'arrêt/erreur/résultat.

## Recherche équipement

`optimizer/` porte les politiques et primitives de recherche les plus récentes : profils, guidance, limites/estimations, Pareto/complétude et sélection de candidats.

Les modules sous `js/` fournissent les règles partagées : légalité, statistiques, FM, sets, caractéristiques, préfiltrage, évaluateur de build et recherche d'architectures.

Les optimisations de recherche sont des heuristiques de performance. Elles ne doivent pas modifier les règles de faisabilité.

## Combat

Le calcul combat s'appuie notamment sur :

- `js/spells.js`
- `js/spell-selection.js`
- `js/spell-combat-effects.js`
- `js/combat-state.js`
- `js/turn-optimizer.js`
- `js/combat-turn-refiner.js`
- `js/combat/`
- `js/temporal-objectives.js`

Les mécaniques spécifiques explicitement prises en charge vivent sous `js/combat/mechanics/`.

Le but architectural est de faire remonter la vérité sémantique des sorts vers le planner, puis le score combat vers la recherche de stuff — pas l'inverse.

## Atelier

`js/workshop/` contient l'application Atelier, ses événements, son modèle de build et ses recalculs.

L'Atelier et l'Optimiseur doivent partager les mêmes règles de légalité/statistiques plutôt que maintenir deux vérités métier.

## Search Memory

`js/search-memory/` contient les requêtes, le stockage/réutilisation de résultats, la fusion et le worker de seeds.

Cette couche peut accélérer/réutiliser une recherche ; elle ne doit pas rendre valide un résultat qui ne l'est plus selon la vérité courante.

## Données

`js/data-loader.js` charge les snapshots normalisés nécessaires au runtime et applique les règles de curation runtime prévues.

Pipeline de maintenance :

```text
Dofusdude
  -> scripts de sync
  -> normalisation/certification
  -> snapshots sous data/normalized/
  -> data-loader
  -> runtime
```

La vérité source riche des sorts est volontairement séparée du catalogue combat actif tant que son interprétation n'est pas certifiée.

## PWA

`service-worker.js` est actif. Il met en cache le shell applicatif et les données nécessaires à l'usage offline.

Toute suppression/renommage de fichier chargé par le service worker doit mettre à jour `APP_SHELL` dans la même tranche et être validée par la recette navigateur.

## Validation permanente

- `npm run check`
- `npm test`
- `npm run recipe:browser`
- `npm run smoke:product`

Les workflows GitHub sont une partie de l'architecture de maintenance ; ils ne doivent pas contenir de diagnostics temporaires ni deux propriétaires concurrents pour le même snapshot généré.
