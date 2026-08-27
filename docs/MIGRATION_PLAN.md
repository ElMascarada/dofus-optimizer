# Dofus Optimizer V2 — Plan de migration

## État au 26 août 2026

Les tranches Fondation V2, moteur de sorts/combat générique et Candidate Policy / recherche d'équipements sont mergées sur `main`.

La tranche active ajoute maintenant un **SetCoreCatalog canonique** et formalise la recherche hybride minimale **set-core + standalone**. Elle avance volontairement une partie de l'ancienne PR 6, car la Candidate Policy fournit désormais la frontière propre nécessaire. Elle ne dépend ni d'IndexedDB ni des seeds.

Ce découpage ne change pas la cible : la recherche hybride complète restera **seeds + set cores + recherche libre**, avec une seule évaluation finale de vérité.

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

Interdits :

- Atelier ;
- IndexedDB produit ;
- réécriture du solveur ;
- déplacement de la logique Huppermage si cela modifie le comportement ;
- modification des beams ou des scores.

Gate : syntaxe + suite Node + benchmark V2 verts.

## PR 1 — OptimizerClient et suppression des patches Worker

Objectif : déplacer les responsabilités de `optimizer-session-bridge.js` et `optimizer-stop-bridge.js` vers une API explicite.

Étapes :

1. introduire `OptimizerClient` autour du Worker natif ;
2. déplacer l'injection `requiredItemIds` dans le contrat de requête ;
3. déplacer cache hit / écriture cache derrière un repository temporaire ;
4. déplacer l'arrêt/finalisation partielle dans le client ;
5. brancher `app-experimental.js` sur le client ;
6. supprimer les remplacements globaux de `window.Worker` ;
7. déplacer le rendu « Imposer » dans le renderer canonique ;
8. supprimer le `MutationObserver` de la modal.

Gate : fingerprints et benchmark identiques à la fondation.

## PR 2 — Registre déclaratif de mécaniques de combat

Objectif : rendre `turn-optimizer.js` totalement générique.

Étapes :

1. figer les tests Huppermage/Iop actuels ;
2. introduire le registre de mécaniques ;
3. reproduire la mécanique Huppermage actuelle via une définition déclarative ;
4. migrer les hooks/états spécifiques hors du moteur ;
5. vérifier que les mécaniques Iop existantes restent pilotées par données ;
6. interdire par test les noms/IDs de classe dans le moteur générique.

Gate : séquences, scores et états identiques sur fixtures.

## PR 3 — SearchPolicy + préfiltrage unique

Objectif : rendre la politique de recherche lisible sans réécrire le solveur.

Étapes :

1. extraire **à valeurs identiques** toutes les constantes beam/capacité ;
2. créer `SearchPolicy` ;
3. supprimer les pool builders concurrents entre préfiltre et recherche d'architectures ;
4. faire de `CandidatePrefilter` l'unique frontière catalogue → pools ;
5. conserver explicitement des voies pour PA/PM/PO/Vita/Initiative/résistances ;
6. comparer résultats et benchmark avant/après chaque extraction.

État : terminé et mergé. La Candidate Policy porte maintenant Pareto, réserves spécialistes/contraintes, profils de recherche et diagnostics.

Toute modification des valeurs de beam appartient à une PR performance séparée.

## Tranche active — SetCoreCatalog + recherche hybride set-core / standalone

Objectif : transformer les données réelles de panoplies en noyaux réutilisables sans rendre le solveur dépendant des panoplies.

Étapes :

1. générer automatiquement les combinaisons légales de 2/3/4 pièces ;
2. agréger `stats items + bonus de panoplie exact atteint` ;
3. profiler les cores sur les axes élémentaires, crit/do-crit, initiative, vita, résistances, mêlée/distance, PA/PM/PO ;
4. éliminer uniquement les dominances prouvables et conserver les conditions différées pour validation finale ;
5. injecter les membres des cores retenus via la Candidate Policy avec `reason: "set-core"` ;
6. utiliser les mêmes cores comme ancres de la recherche d'architectures ;
7. conserver une voie standalone indépendante dans chaque recherche ;
8. exposer compatibilité core/core, diagnostics de génération, pertinence, injection et origine de recherche ;
9. comparer qualité, branches et temps avec/sans cores sur les scénarios de référence.

Gate : suite Node, `benchmark:v2` et `benchmark:search` verts ; un core doit pouvoir battre le standalone et le standalone doit pouvoir battre les cores.

Hors scope de cette tranche : seeds, IndexedDB, Atelier, Lock/Reject, mémoire locale et nouvelles mécaniques de classe.

## PR 4 — Persistence IndexedDB

Objectif : remplacer le cache principal `localStorage` par un repository persistant.

Étapes :

1. implémenter `SearchRepository` IndexedDB ;
2. migrer cache exact et résultats ;
3. conserver un mécanisme d'invalidation par version/epoch ;
4. migrer les builds sauvegardés ;
5. prévoir migration/effacement sûr d'anciens caches locaux.

Gate : cache miss/hit produit le même résultat.

## PR 5 — Recherche par seeds

Objectif : utiliser la mémoire des calculs comme accélérateur, pas seulement comme cache exact.

Étapes :

1. définir la distance entre requêtes normalisées ;
2. retrouver les recherches proches ;
3. extraire leurs meilleurs builds comme seeds ;
4. réévaluer chaque seed selon les règles courantes ;
5. fusionner seeds et recherche actuelle sans réduire la recherche libre.

Gate : un seed ne peut jamais contourner contraintes/conditions.

## PR 6 — Recherche hybride complète

Objectif : terminer la formalisation des trois voies : seed, cores de panoplies, recherche libre.

La tranche SetCoreCatalog aura déjà livré la voie set-core et la coexistence avec le standalone. Il restera principalement :

1. interface commune explicite de `BuildCandidate` pour les trois origines ;
2. branchement des seeds issus de la persistence ;
3. fusion/dédoublonnage générique entre seeds, cores et recherche libre ;
4. diagnostics homogènes par origine de candidat ;
5. vérification que chaque origine repasse par `CompleteBuildEvaluator`.

## PR 7 — Shell produit V2

Objectif : introduire la navigation **Atelier / Optimiseur** sans encore développer toutes les fonctions Atelier.

L'ancien écran Optimiseur est migré dans le nouveau shell sans changement de résultat.

## PR 8 — Atelier

Objectif : développer l'éditeur manuel :

- construction de stuff ;
- sauvegarde ;
- recherche d'items ;
- stats temps réel ;
- dégâts par sort ;
- T1/T2/T3/constant ;
- Trouver mieux.

Cette étape ne commence qu'une fois les couches de moteur/persistence stables.

## PR 9 — Résultats interactifs Lock / Reject

Objectif : intégrer Lock/Reject comme propriétés natives de la requête et réoptimiser sans hacks DOM/Worker.

## Discipline de benchmark

Le script `npm run benchmark:v2` doit être exécuté avant/après les migrations qui touchent :

- préfiltrage ;
- architecture search ;
- combat ;
- finalisation partielle ;
- cache/repository ;
- protocole Worker.

`npm run benchmark:search` compare également la voie standalone à la voie hybride pour les changements Candidate Policy / Set Cores. Il doit reporter :

- cores générés / éliminés / pertinents / injectés ;
- candidats injectés par les cores ;
- branches explorées ;
- temps de préfiltrage et de recherche ;
- meilleur score ;
- origine du meilleur résultat quand disponible.

Le rapport conserve deux informations distinctes :

- **fingerprint fonctionnel** : doit être identique pour une PR comportementalement neutre ;
- **temps** : peut varier avec le runner, mais sert à détecter une régression grossière et à comparer plusieurs exécutions sur la même CI.

## Critères pour déclarer une tranche terminée

- documentation à jour ;
- tests ciblés de la tranche ;
- tests historiques toujours verts ;
- benchmark automatique exécuté ;
- CI verte ;
- aucun merge automatique par l'agent.
