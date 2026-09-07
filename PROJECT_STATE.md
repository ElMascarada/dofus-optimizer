# État courant du projet

Ce document décrit l'état **courant** du produit. Pour l'historique, utiliser Git et les PR mergées.

## Produit

Le produit est un optimiseur Dofus piloté par le combat : le plan/tour jouable est l'objectif primaire, le stuff est la variable d'optimisation qui doit permettre et maximiser ce plan.

La version runtime est définie uniquement dans `js/runtime-meta.js`.

## Runtime actif

- UI principale : `index.html`
- Optimiseur : `js/optimizer-v2-app.js`
- Worker : `js/optimizer-worker.js`
- Génération d'architectures : `js/architecture-search-v2.js`
- Recherche de candidats : `optimizer/candidate-search.js`
- Atelier : `js/workshop/`
- Mémoire de recherche : `js/search-memory/`
- PWA/offline : `service-worker.js`

Voir `docs/ARCHITECTURE_CURRENT.md` pour la carte détaillée.

## Contrats actuellement protégés

1. Un build rendu doit être légal.
2. Les minima demandés sont des contraintes dures, pas des préférences de score.
3. Si l'ensemble faisable est non vide, la recherche doit pouvoir produire un résultat faisable.
4. Le score combat vient d'un plan de sorts jouable pour le mode temporel demandé.
5. La donnée Dofus inconnue n'est pas devinée.
6. Une sémantique de sort riche non comprise reste explicitement non résolue au lieu d'être silencieusement réduite à du dégât.

## Dette produit connue — priorité P0 après nettoyage

La vérité source riche des sorts est déjà importée, mais elle n'est pas encore consommée par le moteur combat de manière générale. Le snapshot courant de `spell-source-truth.json` marque les entrées comme `source-unresolved` lorsque leur sémantique complète n'est pas certifiée.

La prochaine tranche produit doit donc être un **audit de couverture sémantique des sorts**, puis l'activation progressive des mécaniques certifiées. Le scénario représentatif prioritaire est Iop Terre / T1 : l'optimiseur doit être capable de redécouvrir de lui-même le meilleur enchaînement permis par les données et mécaniques réelles, puis optimiser le stuff autour de ce tour.

Ce scénario est un test d'acceptation, pas une rotation à coder en dur.

## Maintenance

Les trois gates permanents sont :

- tests/syntaxe Node ;
- recette navigateur réelle ;
- product smoke.

Les données et icônes ont une seule chaîne de synchronisation canonique : `.github/workflows/sync-dofus-data.yml`.

Aucun nouveau travail produit ne doit repartir d'un ancien checkpoint documentaire ou d'une branche historique : repartir de `main` et de cette documentation canonique.
