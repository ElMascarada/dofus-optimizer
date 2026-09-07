# Dofus Optimizer

**Dofus Optimizer est un optimiseur de plan de combat Dofus.**

Le stuff n'est pas l'objectif du produit et n'a pas de valeur autonome : équipements, PA/PM, Dofus, trophées, compagnon et forgemagie sont des moyens permettant d'exécuter et de maximiser le meilleur plan de combat sous les contraintes du joueur.

## Contrat produit

L'ordre logique cible est :

1. charger une vérité de jeu certifiée ;
2. comprendre les sorts, passifs et mécaniques applicables ;
3. simuler l'état du combat et construire les séquences réellement jouables ;
4. maximiser le tour offensif demandé `Tn` ;
5. rechercher les ressources et l'équipement qui rendent ce plan possible et meilleur ;
6. respecter toutes les contraintes dures demandées.

Pour un objectif `T2`, les actions du T1 ne valent que par ce qu'elles préparent pour le T2. Pour un objectif `T3`, T1 et T2 ne valent que par ce qu'ils préparent pour le T3. Les dégâts des tours de préparation ne sont pas ajoutés au score du tour cible.

Une mécanique non comprise ne doit jamais être transformée silencieusement en simple ligne de dégâts.

Le contrat normatif complet est dans [`docs/PRODUCT_CONTRACT.md`](docs/PRODUCT_CONTRACT.md). Les écarts entre ce contrat et l'implémentation actuelle sont explicités dans [`PROJECT_STATE.md`](PROJECT_STATE.md) et [`docs/DOFUS_MODEL.md`](docs/DOFUS_MODEL.md).

## Application actuelle

Entrée navigateur : `index.html`.

Chemin Optimiseur principal :

`index.html` → `js/optimizer-v2-app.js` → `js/optimizer-worker.js` → `js/architecture-search-v2.js` → `optimizer/candidate-search.js` → évaluateur combat.

L'Atelier vit sous `js/workshop/`. Les primitives Search Memory vivent sous `js/search-memory/` ; le stockage produit par défaut est actuellement inerté, voir l'architecture courante.

Voir [`docs/ARCHITECTURE_CURRENT.md`](docs/ARCHITECTURE_CURRENT.md).

## Données et connaissance du jeu

Les équipements et sorts sont synchronisés depuis Dofusdude puis normalisés hors navigateur. Le runtime ne doit activer que des données et mécaniques explicitement comprises/certifiées. La vérité source riche des sorts est conservée séparément lorsqu'elle n'est pas encore interprétable avec certitude.

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

GitHub et le code exécutable sont la source de vérité sur **ce qui existe aujourd'hui**. `docs/PRODUCT_CONTRACT.md` est la source de vérité sur **ce que le produit doit devenir**. Les documents historiques ne sont pas conservés dans l'arbre courant : l'historique Git remplit ce rôle.
