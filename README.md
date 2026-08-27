# Dofus Optimizer

Web app statique/PWA destinée à construire, analyser et optimiser des équipements Dofus sous contraintes.

## Produit V2

L’application finale est organisée autour de deux espaces :

- **Atelier** — construction manuelle d’un stuff 16 slots, recherche intelligente d’items, sauvegarde locale, statistiques live, dégâts exacts et rotation T1–T3 ;
- **Optimiseur** — recherche de builds complets à partir de la classe, de l’élément, des contraintes et de l’objectif temporel.

Le parcours canonique est :

```text
Atelier
  -> construire / sauvegarder / analyser
  -> Lock / Reject / Trouver mieux
Optimiseur
  -> cache exact / seeds proches / recherche
  -> résultat certifié
  -> Ouvrir dans l’Atelier
```

## Runtime actuel

Le runtime UI de production est :

```text
index.html
  -> js/workshop/workshop-app.js
     -> WorkshopController
     -> WorkshopEvaluator
     -> BuildRepository / IndexedDB
     -> moteurs canoniques de stats et combat

  -> js/optimizer-v2-app.js
     -> js/optimizer-v2-orchestrator.js
     -> Search Memory V2 / IndexedDB
     -> js/optimizer-worker.js
        -> js/architecture-search-v2.js
        -> js/offensive-slot-refiner.js
        -> js/combat-turn-refiner.js
        -> js/result-diversity.js
     -> js/search-memory/seed-worker.js
```

`js/runtime-meta.js` est la source canonique de version et d’identité des caches runtime.

Les anciens fichiers `app-experimental.js`, `optimizer-session-bridge.js`, `optimizer-stop-bridge.js`, `styles-experimental.css` et `styles-session.css` peuvent rester présents comme historique, mais **ne sont plus des entrypoints de production V2** et ne sont plus préchargés par le service worker final.

## Frontières métier canoniques

- `js/complete-build-evaluator.js` — validation et évaluation finale d’un build complet ;
- `js/candidate-prefilter.js` + `optimizer/candidate-policy.js` — présélection contextuelle ;
- `optimizer/set-core-catalog.js` + `js/set-synergy-index.js` — noyaux de panoplies / architectures ;
- `js/architecture-search-v2.js` — recherche libre ;
- `js/offensive-slot-refiner.js` — raffinement des slots offensifs ;
- `js/combat-turn-refiner.js` — sélection des finalistes combat ;
- `js/turn-optimizer.js` — rotation exacte T1/T2/T3 ;
- `js/temporal-objectives.js` — objectifs T1, T2, T3, cumul, moyenne, pire tour et Constant ;
- `js/spells.js` / `js/combat-state.js` / `js/combat/` — dégâts et états combat génériques ;
- `js/sets.js`, `js/build-legality.js`, `js/characteristics.js`, `js/fm.js` — règles de build ;
- `js/data-loader.js` — validation des snapshots certifiés.

L’UI ne doit pas recalculer ces règles.

## Données

Le navigateur consomme uniquement les snapshots normalisés et certifiés :

- `data/normalized/dofus-data.json` — équipements et panoplies ;
- `data/normalized/spell-data.json` — classes et sorts de combat ;
- rapports de couverture associés dans `data/normalized/`.

Le pipeline de maintenance utilise Dofusdude et synchronise équipements/sorts sur une version de jeu cohérente. Voir `SOURCE_DATA.md` pour les règles de certification et de provenance.

Le runtime ne retombe pas silencieusement sur des données de démonstration et exclut les données qu’il ne sait pas interpréter de manière certifiée.

## Search Memory V2

L’Optimiseur conserve localement :

- les résultats exacts compatibles avec une requête normalisée ;
- des requêtes proches utilisées comme sources de seeds ;
- uniquement des identifiants d’items pour les seeds, qui sont toujours réhydratés et réévalués avec les moteurs courants.

Les versions de données/règles participent à la compatibilité. Un simple polish UI ne change donc pas `appVersion` ni les fingerprints métier.

## Lock / Reject / Trouver mieux

Depuis l’Atelier :

- **Lock** impose réellement l’item verrouillé à la recherche ;
- **Reject** exclut réellement l’item ;
- **Trouver mieux** envoie le stuff complet comme seed/lower bound, mais ne verrouille pas implicitement les autres slots.

Un résultat Optimiseur peut ensuite être rouvert dans l’Atelier en conservant les métadonnées de raffinement utiles.

## Tests, recette et benchmarks

Validation standard :

```bash
npm run check
npm test
npm run recipe:v2
npm run recipe:browser
npm run benchmark:v2
npm run benchmark:search
npm run benchmark:workshop
```

- `recipe:v2` verrouille les contrats du shell/UX final ;
- `recipe:browser` pilote réellement Chrome headless sur l’application servie en HTTP : cold start, Atelier, clavier, équipement, Optimiseur, recherche et retour Atelier ;
- les benchmarks historiques servent de garde-fou de non-régression.

La recette de clôture détaillée est dans `docs/V2_ACCEPTANCE_RECIPE.md`.

## Documentation V2

Lire en priorité :

1. `AGENTS.md`
2. `PROJECT_STATE.md`
3. `docs/OPTIMIZER_V2_SPEC.md`
4. `docs/ARCHITECTURE_TARGET.md`
5. `docs/V2_COMPLETION_PLAN.md`
6. `docs/V2_ACCEPTANCE_RECIPE.md`
7. `docs/PERFORMANCE_V2.md`
8. `docs/TEMPORAL_OBJECTIVES_V2.md`

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

Les normaliseurs doivent préférer l’exclusion explicite à toute approximation silencieuse d’un effet ou d’une condition Dofus inconnue.
