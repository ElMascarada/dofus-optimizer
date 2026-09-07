# Architecture courante

Ce document décrit uniquement l'architecture réellement utilisée par le produit courant. La cible fonctionnelle est dans `docs/PRODUCT_CONTRACT.md`.

## Entrée navigateur

`index.html` charge l'interface Atelier + Optimiseur et enregistre le service worker.

Deux surfaces produit partagent les mêmes données normalisées :

- Atelier : construction/édition manuelle d'un build ;
- Optimiseur : recherche automatisée sous contraintes avec évaluation combat.

Le message produit canonique reste : **le plan de combat est l'objectif, l'équipement est un moyen**.

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

Le worker isole le calcul coûteux de l'UI. Les messages entre UI et worker constituent une frontière produit : les modifier exige de préserver les états d'arrêt/erreur/résultat.

## Recherche équipement

`optimizer/` porte les politiques et primitives de recherche récentes : profils, guidance, bornes, Pareto/complétude et sélection de candidats.

Les modules sous `js/` fournissent les règles partagées : légalité, statistiques, FM, sets, caractéristiques, préfiltrage, évaluation de build et recherche d'architectures.

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

Le but architectural est de faire remonter la vérité sémantique des sorts vers le planner, puis le plan combat vers la recherche d'équipement — jamais de fabriquer une rotation depuis un score statique de stuff.

### Limite temporelle actuelle

`js/temporal-objectives.js` distingue tours scorés et tours simulés. L'objectif T2 demande actuellement `[T1, T2]` en simulation, mais T3 ne demande encore que T3. Le contrat cible `T1/T2 préparation -> score T3` reste donc à implémenter après la certification sémantique.

## Atelier

`js/workshop/` contient l'application Atelier, ses événements, son modèle de build et ses recalculs.

L'Atelier et l'Optimiseur doivent partager les mêmes règles de légalité/statistiques plutôt que maintenir deux vérités métier.

## Search Memory

`js/search-memory/` contient encore les primitives de requête, sérialisation, stockage, distance, seeds et fusion.

**État produit courant :** `SearchMemoryRepository` instancié sans options utilise un `InertSearchStore`. Le parcours produit n'exploite donc pas actuellement de cache persistant par défaut, même si les primitives et tests de stockage restent disponibles pour outils/tests.

Cette couche ne doit pas être présentée comme une optimisation active tant que cette inertie est volontaire. Si elle est réactivée un jour, un cache ne devra jamais rendre valide un résultat qui ne l'est plus selon la vérité courante.

## Données

`js/data-loader.js` charge les snapshots normalisés nécessaires au runtime et applique les règles de curation prévues.

Pipeline de maintenance :

```text
Dofusdude
  -> scripts de sync
  -> normalisation / conservation de la vérité source
  -> curation/certification
  -> snapshots sous data/normalized/
  -> data-loader
  -> runtime
```

La vérité source riche des sorts est volontairement séparée du catalogue combat actif tant que son interprétation n'est pas certifiée.

## FM actuelle

La politique FM actuellement construite par `js/optimizer-v2-orchestrator.js` reste historique (`+3 % dommages sorts / slot`, +8 do crit, Exo PA/PM). Le budget cible de 9 objets avec arbitrage 1 % / 2 % / do crit n'est pas encore implémenté ; voir `docs/DOFUS_MODEL.md`.

## PWA

`service-worker.js` est actif. Il met en cache le shell applicatif et les données nécessaires à l'usage offline.

Toute suppression/renommage de fichier du shell doit mettre à jour `APP_SHELL` dans la même tranche et être validée par la recette navigateur.

## Validation permanente

- `npm run check`
- `npm test`
- `npm run recipe:browser`
- `npm run smoke:product`
- benchmarks CI des chemins principaux

Les workflows GitHub sont une partie de l'architecture de maintenance ; ils ne doivent pas contenir de diagnostics temporaires ni deux propriétaires concurrents pour le même snapshot généré.
