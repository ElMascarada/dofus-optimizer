# Dofus Optimizer V2 — Plan de migration

## État au 27 août 2026

Les tranches Fondation V2, moteur de sorts/combat générique, Candidate Policy / recherche d'équipements et **SetCoreCatalog** sont mergées sur `main`.

La tranche active est maintenant le **premier Atelier V2 utilisable**. Elle avance volontairement le shell produit et le cœur de l'éditeur manuel avant la persistence : cette PR ne sauvegarde rien, ne lance aucune recherche automatique et ne modifie aucune politique du solveur.

La cible reste inchangée : Atelier et Optimiseur consomment les mêmes données et moteurs, puis la persistence/seeds/recherche hybride complète pourront être branchées derrière des contrats explicites.

## Règle générale

La migration est découpée en PRs courtes. Une PR d'architecture ne change pas volontairement les résultats du solveur. Tout changement de score, de Top N ou de rotation doit être isolé, mesuré et justifié séparément.

## PR 0 — Fondation V2

Objectif : rendre le dépôt suffisamment lisible et protégé pour commencer la migration.

Livrables :

- audit du runtime réellement exécuté ;
- baseline transversale de non-régression ;
- benchmark V2 reproductible ;
- spécification produit V2 ;
- architecture actuelle et architecture cible ;
- runtime UI canonique explicitement choisi ;
- suppression uniquement de l'ancienne UI clairement morte ;
- source unique de version/cache runtime ;
- contrats/interfaces préparatoires sans changement d'heuristique.

Gate : syntaxe + suite Node + benchmark V2 verts.

## PR 1 — OptimizerClient et suppression des patches Worker

Objectif : déplacer les responsabilités de `optimizer-session-bridge.js` et `optimizer-stop-bridge.js` vers une API explicite.

Étapes cibles : ownership du Worker, requête sérialisable, arrêt/finalisation, cache derrière repository et suppression progressive des patches globaux historiques.

## PR 2 — Registre déclaratif de mécaniques de combat

Objectif : rendre le moteur de combat générique indépendant des noms/IDs de classes et sorts.

État : fondation générique mergée. Les mécaniques supportées passent par le registre et `evaluateSpell` / le moteur de rotation restent les sources canoniques de dégâts.

## PR 3 — SearchPolicy + préfiltrage unique

Objectif : rendre la politique de recherche lisible sans réécrire le solveur.

État : terminé et mergé. La Candidate Policy porte Pareto, réserves spécialistes/contraintes, profils de recherche et diagnostics. `CandidatePrefilter` est la frontière catalogue → pools.

## PR #40 — SetCoreCatalog + recherche hybride set-core / standalone

Objectif : transformer les données réelles de panoplies en noyaux réutilisables sans rendre le solveur dépendant des panoplies.

État : terminé et mergé.

Livré :

- cores 2/3/4 pièces générés depuis `items` + `sets` ;
- bonus exacts, profils et légalité ;
- dominance prudente ;
- compatibilité core/core ;
- injection Candidate Policy avec `reason: "set-core"` ;
- voie standalone toujours indépendante ;
- diagnostics et benchmark standalone/hybride.

## PR #41 — Atelier V2 foundation — tranche active

Objectif : livrer le premier éditeur manuel utilisable sans optimiser automatiquement le stuff.

Architecture :

```text
index.html
  -> shell [Atelier] [Optimiseur]
  -> js/workshop/workshop-app.js
    -> WorkshopController
      -> WorkshopBuild
      -> WorkshopEvaluator
        -> CompleteBuildEvaluator
        -> evaluateSpell / CombatMechanicRegistry
    -> equipment-grid
    -> item-browser
    -> stats-panel
    -> spell-panel
```

Livrables de la tranche :

1. navigation Atelier / Optimiseur, l'écran historique restant intact dans sa vue ;
2. `WorkshopBuild` canonique avec classe, 16 emplacements, politique FM et sorts sélectionnés ;
3. équipement/remplacement/retrait manuel ;
4. navigateur du catalogue certifié : filtre de slot, recherche nom, icône, stats, panoplie ;
5. stats, conditions, bonus de panoplie et FM issus uniquement de `CompleteBuildEvaluator` ;
6. dégâts normaux/crit, chance critique et support des mécaniques via `evaluateSpell` ;
7. aucune création de Worker / Candidate Search / Architecture Search sur changement d'item ;
8. benchmark dédié de recalcul d'un stuff complet ;
9. fondation visuelle noir `#000000`, gris `#CCCFCA`, rouge `#DC2636` ;
10. tests des invariants Atelier et non-régression du shell Optimiseur.

Hors scope strict : IndexedDB, bibliothèque de stuffs, recherche sémantique, Trouver mieux, Lock/Reject, seeds, nouvelle Candidate Policy, nouveau Set Core engine, refonte Optimiseur et nouvelles mécaniques de classe.

Gate : `npm run check`, `npm test`, `benchmark:v2`, `benchmark:search`, `benchmark:workshop` et CI verts.

## PR suivante recommandée — Persistence / bibliothèque Atelier

Après #41, la prochaine tranche peut introduire le repository IndexedDB derrière l'état Atelier sans modifier les calculs métier :

1. `SearchRepository` / `BuildRepository` persistant ;
2. sauvegarde, liste, renommage et suppression des builds Atelier ;
3. versionnement par data version / engine epoch ;
4. migrations/effacement sûrs ;
5. aucune dépendance IndexedDB dans `CompleteBuildEvaluator` ou le moteur combat.

La recherche intelligente (`multi do crit`, etc.), Trouver mieux et les seeds restent des tranches ultérieures.

## Persistence IndexedDB

Objectif historique : remplacer le cache principal `localStorage` par un repository persistant et porter les builds Atelier. Cette tranche reste nécessaire ; #41 ne l'implémente pas.

## Recherche par seeds

Objectif : utiliser la mémoire des calculs comme accélérateur, jamais comme résultat automatiquement valide. Chaque seed repasse les règles courantes.

## Recherche hybride complète

Objectif : terminer la formalisation des trois voies seed, set cores et recherche libre via un contrat commun `BuildCandidate`, avec dédoublonnage et diagnostics par origine.

## Résultats interactifs Lock / Reject

Objectif : intégrer Lock/Reject comme propriétés natives de la requête et réoptimiser sans hacks DOM/Worker.

## Discipline de benchmark

`npm run benchmark:v2` reste obligatoire pour les migrations qui touchent au calcul global. `npm run benchmark:search` protège Candidate Policy / Set Cores. `npm run benchmark:workshop` mesure uniquement le chemin synchrone connu **item changé → stats + dégâts unitaires**, sans Worker.

Le rapport distingue toujours :

- **fingerprint fonctionnel** : stabilité attendue pour une PR comportementalement neutre côté solveur ;
- **temps** : mesure de détection de régression grossière, à comparer sur un même environnement.

## Critères pour déclarer une tranche terminée

- documentation à jour ;
- tests ciblés de la tranche ;
- tests historiques toujours verts ;
- benchmarks concernés exécutés ;
- CI verte ;
- aucun merge automatique par l'agent.
