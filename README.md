# Dofus Optimizer

Web app statique/PWA destinée à rechercher un équipement Dofus optimal sous contraintes.

## Runtime actuel

Le runtime canonique est :

```text
index.html
  -> js/app-experimental.js
    -> js/optimizer-worker.js
      -> js/architecture-search-v2.js
      -> js/offensive-slot-refiner.js
      -> js/combat-turn-refiner.js
      -> js/result-diversity.js
```

`js/runtime-meta.js` est la source canonique de version et d'identité des caches runtime.

Les bridges `optimizer-session-bridge.js` et `optimizer-stop-bridge.js` font encore partie de la production actuelle pour le cache/items imposés et l'arrêt avec finalisation partielle. Leur remplacement par un client Worker explicite est planifié pour la migration V2.

La description complète de l'état réel et de la cible se trouve dans :

- `docs/ARCHITECTURE_CURRENT.md` ;
- `docs/ARCHITECTURE_TARGET.md` ;
- `docs/OPTIMIZER_V2_SPEC.md` ;
- `docs/MIGRATION_PLAN.md`.

## Données

Le navigateur consomme uniquement les snapshots normalisés et certifiés :

- `data/normalized/dofus-data.json` — équipements et panoplies ;
- `data/normalized/spell-data.json` — classes et sorts de combat ;
- rapports de couverture associés dans `data/normalized/`.

Le pipeline de maintenance utilise Dofusdude et synchronise équipements/sorts sur une version de jeu cohérente. Voir `SOURCE_DATA.md` pour les règles de certification et de provenance.

Le runtime ne retombe pas silencieusement sur des données de démonstration et exclut les données qu'il ne sait pas interpréter de manière certifiée.

## Modules principaux

- `js/app-experimental.js` — UI canonique et orchestration actuelle ;
- `js/optimizer-worker.js` — orchestration hors thread UI ;
- `js/candidate-prefilter.js` — préfiltrage initial des équipements ;
- `js/architecture-search-v2.js` — génération/recherche d'architectures ;
- `js/complete-build-evaluator.js` — validation et évaluation finale d'un build complet ;
- `js/offensive-slot-refiner.js` — raffinement des slots offensifs ;
- `js/combat-turn-refiner.js` — sélection des builds à passer au solveur de rotations ;
- `js/turn-optimizer.js` — moteur de séquences de combat T1/T2/T3 ;
- `js/spells.js` / `js/combat-state.js` — dégâts, statistiques temporelles et états génériques ;
- `js/sets.js` — bonus de panoplie ;
- `js/build-legality.js` — conditions d'équipement et règles de slots ;
- `js/characteristics.js` — allocation automatique des caractéristiques ;
- `js/fm.js` — politique de FM ;
- `js/data-loader.js` — validation des snapshots certifiés ;
- `js/runtime-meta.js` — version et identifiants de cache runtime ;
- `js/optimizer-protocol.js` — contrat de messages préparatoire au futur `OptimizerClient` ;
- `js/combat-mechanics-registry.js` — interface de registre déclaratif préparatoire, pas encore branchée au moteur actuel.

`js/architecture-search.js` et `js/solver.js` sont historiques mais encore conservés car ils restent couverts/référencés. L'ancienne UI `js/app.js`, non exécutée, a été supprimée dans la fondation V2.

## Tests et benchmark

```bash
npm test
npm run check
npm run benchmark:v2
```

`npm run benchmark:v2` fige les scénarios critiques avant les migrations structurelles : mono-tour, T1-T3, contraintes PA/PM, Initiative, Vitalité, résistances, panoplies, buffs/états et arrêt manuel.

La CI archive les sorties de tests et de benchmark pour permettre une comparaison avant/après des PRs de migration.

## Lancer localement

Un serveur HTTP est nécessaire pour charger les JSON, modules et Web Workers :

```bash
python -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.

## Synchronisation des données

Lorsque la machine a accès au réseau :

```bash
npm run sync:normalize
```

Les normaliseurs doivent préférer l'exclusion explicite à toute approximation silencieuse d'un effet ou d'une condition Dofus inconnue.
