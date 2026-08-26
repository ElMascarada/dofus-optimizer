# Dofus Optimizer — Project State

Dernière mise à jour : 2026-08-26

## Base de cette tranche

- dépôt : `ElMascarada/dofus-optimizer`
- `main` de départ : `bf6434dbb82738caaff5ea6393b6d99ac6c64028`
- ce commit est le merge de la PR #38 Candidate Policy / recherche de builds
- le head de la PR #38 (`b244303f4c434350a4c78d49848a7dfc82484c3b`) a passé `Optimizer CI`
- branche active : `feat/v2-set-core-catalog`

## Architecture V2 déjà mergée

- spécification V2 et architecture cible documentées ;
- moteur de sorts/combat rendu générique et mécaniques spécifiques sorties du moteur central ;
- Candidate Policy canonique pour Pareto, réserves spécialistes, contraintes et profils de recherche ;
- `CandidatePrefilter` comme frontière catalogue → pools ;
- `CompleteBuildEvaluator` reste l'unique vérité finale pour structure, conditions, bonus de panoplie, caractéristiques, FM et contraintes.

## Tranche active — Set Cores

Objectif : exploiter les synergies de panoplies comme accélérateur/priorisation sans rendre les panoplies obligatoires.

Implémenté sur la branche :

- `optimizer/set-core-catalog.js` : catalogue canonique généré automatiquement à partir des données `items` + `sets` ;
- génération des cores 2/3/4 pièces quand le bonus exact existe ;
- agrégation `stats items + bonus exact du palier` ;
- profils : terre, feu, eau, air, multi, crit, do-crit, initiative, vita, res, melee, distance, PA, PM, PO ;
- légalité structurelle et conditions différables ;
- dominance prudente uniquement quand elle est prouvable ;
- compatibilité core/core disponible sans lancer une recherche massive de combinaisons ;
- Candidate Policy alimentée par le catalogue et conservation des membres avec `reason: "set-core"` ;
- `set-synergy-index` construit ses plans depuis les cores canoniques au lieu de recalculer ses propres combinaisons ;
- `architecture-search-v2` conserve la voie standalone et expose des diagnostics par origine ;
- tests ciblés des 10 invariants demandés ajoutés ;
- benchmark candidat étendu en comparaison standalone vs hybride et génération sur le snapshot Dofus réel.

## Invariants à préserver

1. Une panoplie n'est jamais obligatoire.
2. La voie standalone est exécutée même lorsque des cores pertinents existent.
3. Un membre individuellement faible peut être protégé si le core complet est pertinent.
4. Les bonus de panoplie sont évalués au palier exact atteint, pas comme une simple somme des items.
5. Aucun core ne contourne `CompleteBuildEvaluator`.
6. Les conditions non décidables sur un core partiel sont différées jusqu'au build complet au lieu d'être déclarées valides.
7. La dominance ne supprime pas un core avec mécanique/condition non comparable.

## Validation en cours

La tranche n'est pas terminée tant que les contrôles suivants ne sont pas verts :

- `npm run check` ;
- `npm test` ;
- `npm run benchmark:v2` ;
- `npm run benchmark:search` ;
- GitHub Actions `Optimizer CI`.

La PR doit rester non mergée tant qu'un de ces gates échoue.

## Hors scope confirmé

- Atelier / UI ;
- IndexedDB ;
- seeds et mémoire locale ;
- Lock / Reject ;
- nouvelles mécaniques de classe ;
- hardcode des meilleures panoplies.

## Reprise rapide

En cas de reprise, lire dans cet ordre :

1. `PROJECT_STATE.md` ;
2. `docs/OPTIMIZER_V2_SPEC.md` ;
3. `docs/ARCHITECTURE_TARGET.md` ;
4. `docs/MIGRATION_PLAN.md` ;
5. `optimizer/set-core-catalog.js` ;
6. `optimizer/candidate-policy.js` ;
7. `js/set-synergy-index.js` ;
8. `js/architecture-search-v2.js` ;
9. `tests/set-core-catalog.test.mjs` ;
10. `scripts/benchmark-candidate-search.mjs`.
