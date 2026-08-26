# Dofus Optimizer — Project State

Dernière mise à jour : 2026-08-26

## Base de cette tranche

- dépôt : `ElMascarada/dofus-optimizer`
- `main` de départ : `bf6434dbb82738caaff5ea6393b6d99ac6c64028`
- ce commit est le merge de la PR #38 Candidate Policy / recherche de builds
- le head de la PR #38 (`b244303f4c434350a4c78d49848a7dfc82484c3b`) a passé `Optimizer CI`
- branche active : `feat/v2-set-core-catalog`
- PR : #40 — `feat: add canonical V2 set core catalog`

## Architecture V2 déjà mergée

- spécification V2 et architecture cible documentées ;
- moteur de sorts/combat rendu générique et mécaniques spécifiques sorties du moteur central ;
- Candidate Policy canonique pour Pareto, réserves spécialistes, contraintes et profils de recherche ;
- `CandidatePrefilter` comme frontière catalogue → pools ;
- `CompleteBuildEvaluator` reste l'unique vérité finale pour structure, conditions, bonus de panoplie, caractéristiques, FM et contraintes.

## Tranche Set Cores

Objectif : exploiter les synergies de panoplies comme accélérateur/priorisation sans rendre les panoplies obligatoires.

Implémenté :

- `optimizer/set-core-catalog.js` : `SetCoreCatalog` canonique généré automatiquement à partir des données `items` + `sets` ;
- génération des cores 2/3/4 pièces quand le bonus exact existe ;
- agrégation `stats items + bonus exact du palier` ;
- profils : terre, feu, eau, air, multi, crit, do-crit, initiative, vita, res, melee, distance, PA, PM, PO ;
- légalité structurelle et conditions différables ;
- dominance prudente uniquement quand elle est prouvable ;
- compatibilité core/core disponible sans lancer une recherche massive de combinaisons ;
- Candidate Policy alimentée par le catalogue et conservation des membres avec `reason: "set-core"` ;
- `set-synergy-index` construit ses plans depuis les cores canoniques au lieu de recalculer ses propres combinaisons ;
- `architecture-search-v2` conserve la voie standalone et expose des diagnostics par origine ;
- recherche volontairement limitée à des architectures mono-core dans cette tranche ; la compatibilité multi-core est exposée mais l'expansion combinatoire est différée ;
- tests ciblés des 10 invariants demandés ;
- benchmark candidat étendu en comparaison standalone vs hybride et génération sur le snapshot Dofus réel.

## Snapshot / benchmark observé sur la CI de la PR

Le benchmark `benchmark:search` exécuté avec Node 22 sur la CI de la PR rapporte pour le snapshot Dofus chargé :

- 160 panoplies ;
- 1 093 items chargés ;
- 159 panoplies avec au moins un item éligible niveau 190–200 ;
- 500 items de panoplie éligibles ;
- 941 cores 2/3/4 générés ;
- 0 élimination par légalité sur ce snapshot ;
- 0 élimination par dominance sur ce snapshot ;
- 941 cores retenus ;
- génération du catalogue : ~59 ms sur ce run CI.

Les scénarios synthétiques du benchmark injectent 10 plans de core / 4 candidats supplémentaires pour 11 cores pertinents. Le meilleur score reste identique sur les scénarios comparables, et la voie standalone reste gagnante quand elle est meilleure.

Sur les 8 scénarios benchmarkés, le cumul du temps passe d'environ 3 255,7 ms à 3 144,9 ms sur ce run (-3,4 %). Cette mesure n'est pas un engagement de performance : les écarts individuels vont d'environ -95,5 ms à +40,6 ms et doivent être considérés comme bruit/ordre de recherche tant qu'ils ne sont pas reproduits sur plusieurs runs.

Exemples de profils réels observés :

- Frimanoplie 2 pièces : PA +++, feu ++/+++, air ++/+++, PO ++, vita ++, initiative +/++, résistances +/++ selon la combinaison ;
- Grithriloplie 3 pièces : terre +++, eau +++, multi +++, résistances +++, vita +++, PA +++.

## Validation finale

Sur le head `3bd00051eaef7f7e1b8a1074694bfcec064db9bb` :

- `npm run check` : vert ;
- `npm test` : vert, 230/230 ;
- `npm run benchmark:v2` : vert ;
- `npm run benchmark:search` : vert ;
- GitHub Actions `Optimizer CI` run #437 (`33013307155`) : vert.

La PR peut passer READY. Elle ne doit pas être mergée automatiquement par l'agent.

## Invariants à préserver

1. Une panoplie n'est jamais obligatoire.
2. La voie standalone est exécutée même lorsque des cores pertinents existent.
3. Un membre individuellement faible peut être protégé si le core complet est pertinent.
4. Les bonus de panoplie sont évalués au palier exact atteint, pas comme une simple somme des items.
5. Aucun core ne contourne `CompleteBuildEvaluator`.
6. Les conditions non décidables sur un core partiel sont différées jusqu'au build complet au lieu d'être déclarées valides.
7. La dominance ne supprime pas un core avec mécanique/condition non comparable.
8. La compatibilité core/core est une donnée disponible ; la recherche massive de combinaisons de cores n'appartient pas à cette tranche.

## Hors scope confirmé

- Atelier / UI ;
- IndexedDB ;
- seeds et mémoire locale ;
- Lock / Reject ;
- nouvelles mécaniques de classe ;
- hardcode des meilleures panoplies ;
- expansion exhaustive de combinaisons multi-core.

## Préparation recommandée pour la prochaine PR Atelier

L'Atelier peut consommer `SetCoreCatalog` en lecture seule pour afficher/proposer des noyaux et leurs profils, sans dupliquer leur calcul. La prochaine tranche UI doit conserver les frontières actuelles : `CandidatePolicy` pour la pertinence, `SetCoreCatalog` pour les métadonnées de pano, `CompleteBuildEvaluator` pour toute validation/scoring final. Ne pas introduire de logique de panoplie propre à l'UI.

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
