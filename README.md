# Dofus Optimizer

Optimiseur de stuff Dofus orienté **plan de combat**.

## Contrat produit

Le projet ne cherche pas d'abord le stuff qui a le plus gros score statique. Il doit d'abord déterminer le meilleur tour réellement jouable pour l'objectif choisi, puis chercher l'équipement qui permet et maximise ce plan de combat.

En pratique :

1. charger une vérité de jeu certifiée ;
2. comprendre les sorts et leurs contraintes/mécaniques ;
3. construire les tours jouables ;
4. évaluer l'objectif temporel (T1, T2, T3, etc.) ;
5. optimiser le stuff autour de ce plan ;
6. respecter toutes les contraintes minimales demandées.

Un mécanisme de sort non compris ne doit jamais être transformé silencieusement en simple dégât.

Voir [`docs/PRODUCT_CONTRACT.md`](docs/PRODUCT_CONTRACT.md).

## Application actuelle

Entrée navigateur : `index.html`.

Chemin Optimiseur principal :

`index.html` → `js/optimizer-v2-app.js` → `js/optimizer-worker.js` → `js/architecture-search-v2.js` → `optimizer/candidate-search.js` → évaluateur combat.

L'Atelier vit sous `js/workshop/`. La mémoire de recherche vit sous `js/search-memory/`.

Voir [`docs/ARCHITECTURE_CURRENT.md`](docs/ARCHITECTURE_CURRENT.md).

## Données

Les données équipement et sorts sont synchronisées depuis Dofusdude puis normalisées hors navigateur. Le runtime ne doit consommer que des données certifiées ; la vérité source riche des sorts est conservée séparément lorsqu'elle n'est pas encore interprétable avec certitude.

Voir [`SOURCE_DATA.md`](SOURCE_DATA.md), [`docs/DOFUS_MODEL.md`](docs/DOFUS_MODEL.md) et [`docs/SPELL_KNOWLEDGE.md`](docs/SPELL_KNOWLEDGE.md).

## Commandes utiles

```bash
npm test
npm run check
npm run smoke:product
npm run recipe:browser
npm run benchmark:v2
npm run benchmark:search
npm run benchmark:workshop
npm run sync:normalize
```

Le CI produit doit s'exécuter sur le runner Dofus self-hosted défini dans `.github/workflows/ci.yml`.

## Règle de maintenance

GitHub et le code exécutable sont la source de vérité. Les documents historiques ne sont pas conservés dans l'arbre courant : l'historique Git remplit ce rôle.
