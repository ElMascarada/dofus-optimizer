# Dofus Optimizer — Project State

Dernière mise à jour : 2026-08-27

## Base de cette tranche

- dépôt : `ElMascarada/dofus-optimizer`
- `main` de départ : `c896c5e2ef426b255e32b4348443602e1fc9f4e9`
- ce commit est le merge de la PR #40 Set Core Catalog
- le commit Set Core `e5a1256e16374e3a615b26bbb5ecb39a6b860139` est présent dans l'historique
- branche active : `feat/v2-workshop-foundation`
- PR : #41 — `feat: add V2 workshop foundation`
- statut attendu : Draft pendant implémentation/validation, puis READY si le head final reste vert

## Architecture V2 déjà mergée

- spécification V2 et architecture cible documentées ;
- moteur de sorts/combat générique et registre de mécaniques ;
- Candidate Policy / CandidatePrefilter canoniques ;
- `CompleteBuildEvaluator` comme vérité finale build ;
- `SetCoreCatalog` canonique 2/3/4 pièces et voie hybride set-core / standalone.

## Tranche Atelier V2 foundation

Objectif : disposer d'un Atelier manuel réellement utilisable, sans lancer l'optimiseur automatique.

### Shell produit

`index.html` contient désormais deux vues de premier niveau :

```text
[ ATELIER ] [ OPTIMISEUR ]
```

L'Atelier est la vue initiale. L'Optimiseur historique reste dans son propre `#optimizer-view` et conserve `js/app-experimental.js`, ses contrôles, son Worker et son rendu existants.

### État canonique

`js/workshop/workshop-build.js` porte :

- `classId` ;
- `equipmentBySlot` ;
- `fmPolicy` ;
- `selectedSpells` ;
- 16 emplacements canoniques : coiffe, cape, amulette, 2 anneaux, ceinture, bottes, arme, bouclier, familier/monture et 6 Dofus/trophées/Prysmaradite.

La limite Prysmaradite reste déléguée à `specialSlotRulesAreValid`. L'UI ne redéfinit pas la règle.

### Calculs

Chemin d'un changement d'item :

```text
WorkshopController
  -> WorkshopBuild
  -> WorkshopEvaluator
    -> CompleteBuildEvaluator
       structure / conditions / sets / caractéristiques / FM / stats
    -> evaluateSpell
       dégâts normaux / critiques / chance critique / mécaniques génériques
  -> rendu stats + sorts
```

Aucun module Atelier n'importe ni `optimizer-worker.js`, ni Candidate Search, ni Architecture Search.

La politique FM Atelier est volontairement neutre dans cette fondation (`0% Do sorts`, pas de +Do Crit automatique, pas d'exo supplémentaire). Le modèle conserve `fmPolicy` pour une évolution explicite ultérieure.

### UI ajoutée

- `workshop-controller.js` : orchestration sans DOM métier ;
- `equipment-grid.js` : rendu des 16 slots ;
- `item-browser.js` : filtre par slot + recherche par nom + icône + type/niveau + stats + panoplie ;
- `stats-panel.js` : PA, PM, PO, Vitalité, Initiative, éléments, Puissance, Critique, Do Crit, dommages, résistances et panoplies actives ;
- `spell-panel.js` : normal min-max, critique min-max, probabilité critique ;
- `workshop-app.js` : bootstrap de la vue et wiring des composants ;
- `styles-workshop.css` : fondation néo-rétro noir `#000000`, gris `#CCCFCA`, rouge `#DC2636`.

## Tests Atelier

`tests/workshop.test.mjs` couvre les 10 invariants demandés :

1. équiper/remplacer/retirer ;
2. deux anneaux distincts ;
3. six slots Dofus ;
4. restriction Prysmaradite ;
5. bonus de panoplie exact ;
6. stats après changement ;
7. dégâts modifiés par les stats ;
8. critique ;
9. changement d'item sans Worker optimizer ;
10. shell Optimiseur historique conservé.

Checkpoint CI fonctionnel `934659c85afb65bfcefdec7fe94a23bd0d77fb50` :

- `npm run check` : vert ;
- `npm test` : **240/240** ;
- `npm run benchmark:v2` : vert ;
- `npm run benchmark:search` : vert ;
- `npm run benchmark:workshop` : vert ;
- GitHub Actions `Optimizer CI` run #453 (`33044268861`) : vert.

## Performance Atelier observée

Benchmark Node 22 sur runner GitHub, snapshot réel, stuff complet, alternance de deux coiffes, 30 recalculs, 26 sorts offensifs évalués :

- médiane : **0,637 ms** ;
- p95 : **1,124 ms** ;
- maximum : **1,317 ms**.

Le benchmark échoue si le p95 dépasse 100 ms. Le temps mesuré exclut le chargement initial des JSON et cible uniquement le chemin interactif attendu : item connu → stats + dégâts unitaires.

## Invariants à préserver

1. L'Atelier ne lance jamais une recherche d'équipements sur un simple changement d'item.
2. `CompleteBuildEvaluator` reste la vérité des stats, conditions, panoplies et FM.
3. `evaluateSpell` / moteur combat reste la vérité des dégâts affichés.
4. Les règles de slots spéciales ne sont pas recodées dans les composants UI.
5. L'Optimiseur historique reste fonctionnel jusqu'à sa migration explicite.
6. `SetCoreCatalog` reste lecture seule depuis l'UI si une tranche future l'expose.
7. Le catalogue d'items UI provient uniquement de `loadDofusData()`.

## Hors scope confirmé

- IndexedDB / sauvegarde / bibliothèque de builds ;
- recherche sémantique `multi do crit`, `terre ini`, etc. ;
- Trouver mieux ;
- Lock / Reject ;
- mémoire des recherches / seeds ;
- nouvelle Candidate Policy ;
- nouveau Set Core engine ;
- refonte de l'Optimiseur ;
- nouvelle mécanique de classe.

## Préparation recommandée pour la PR suivante

Priorité logique : **persistence Atelier / bibliothèque de builds** derrière un repository IndexedDB versionné. `WorkshopBuild` est déjà sérialisable conceptuellement et `WorkshopController` fournit une frontière naturelle pour charger/sauvegarder sans contaminer `CompleteBuildEvaluator`.

Une tranche ultérieure pourra ensuite ajouter la recherche intelligente d'items, puis `Trouver mieux` / seeds, sans changer les responsabilités des panneaux UI actuels.

## Reprise rapide

Lire dans cet ordre :

1. `PROJECT_STATE.md` ;
2. `docs/OPTIMIZER_V2_SPEC.md` ;
3. `docs/ARCHITECTURE_TARGET.md` ;
4. `docs/MIGRATION_PLAN.md` ;
5. `js/workshop/workshop-build.js` ;
6. `js/workshop/workshop-controller.js` ;
7. `js/workshop/workshop-evaluator.js` ;
8. `js/workshop/workshop-app.js` ;
9. `tests/workshop.test.mjs` ;
10. `scripts/benchmark-workshop.mjs`.
