# Dofus Optimizer V2 — Plan de migration

## Règle générale

La migration est découpée en PRs courtes. Une PR d'architecture ne change pas volontairement les résultats du solveur. Tout changement de score, de Top N ou de rotation doit être isolé, mesuré et justifié séparément.

## PR 0 — Fondation V2 (cette PR)

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

Toute modification des valeurs de beam appartient à une PR performance séparée.

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

## PR 6 — Recherche hybride

Objectif : formaliser trois voies : seed, cores de panoplies, recherche libre.

Étapes :

1. interfaces communes de `BuildCandidate` ;
2. voie seeds ;
3. voie set cores ;
4. voie libre ;
5. fusion/dédoublonnage ;
6. évaluation finale unique ;
7. diagnostics par origine de candidat.

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

Le rapport conserve deux informations distinctes :

- **fingerprint fonctionnel** : doit être identique pour une PR comportementalement neutre ;
- **temps** : peut varier avec le runner, mais sert à détecter une régression grossière et à comparer plusieurs exécutions sur la même CI.

## Critères pour déclarer la fondation terminée

- documentation V2 présente ;
- runtime actuel documenté ;
- ancienne UI morte supprimée ;
- version/cache centralisés ;
- baseline explicite des cas critiques ;
- benchmark automatique ;
- CI verte ;
- PR laissée en Draft tant que les contrôles ne sont pas terminés ;
- aucun merge automatique par l'agent.
