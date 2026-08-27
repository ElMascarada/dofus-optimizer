# Dofus Optimizer V2 — Completion Plan

Ce document est la roadmap de fin de course. Il doit permettre à une nouvelle fenêtre de reprendre le rôle de lead sans dépendre d'un historique de conversation.

## Déjà terminé

- [x] Fondation V2 / architecture / baseline
- [x] Moteur de sorts et combat générique
- [x] Candidate Policy / préfiltrage / Pareto / contraintes
- [x] SetCoreCatalog / recherche hybride set-core + standalone
- [x] Atelier V2 foundation : 16 slots, stats live, dégâts sorts, shell produit
- [x] Persistence Atelier + bibliothèque de builds + Smart Item Search (PR #44)
- [x] Optimiseur V2 simplifié (PR #45)
- [ ] Mémoire des recherches + cache exact + seeds — implémentée par la PR #47, à considérer terminée après merge vert de cette PR

## Tranche 1 — Persistence Atelier + bibliothèque + Smart Item Search

### Dépendances

Atelier #41 mergé.

### Statut

Livrée par la PR #44.

### Scope

- IndexedDB versionné ;
- `BuildRepository` séparé de l'UI ;
- sauvegarder / charger / renommer / dupliquer / supprimer ;
- autosave du draft courant ;
- reconstruction d'un `WorkshopBuild` depuis les IDs canoniques ;
- gestion propre d'un item disparu après changement de données ;
- vocabulaire déterministe de recherche d'items ;
- requêtes telles que `multi do crit`, `terre ini`, `eau distance`, `grosse vita res`, `anneau PA multi` ;
- ranking explicable par tags/raisons ;
- recherche pré-indexée rapide.

### Hors scope

- `Trouver mieux` ;
- seeds de solveur ;
- mémoire des recherches Optimiseur ;
- Lock/Reject ;
- refonte de l'onglet Optimiseur.

### Done

- CRUD builds + autosave fiables ;
- migrations/versionnement couverts ;
- recherche intelligente déterministe testée ;
- aucune dépendance optimizer sur simple recherche d'item ;
- `npm run check`, `npm test`, benchmarks pertinents et CI verts.

## Tranche 2 — Optimiseur V2 simplifié

### Dépendances

PR #44 mergée sur `main@e31843aa74fd5207098966083b4c8f38aee431fb` au démarrage de la tranche.

### Statut

Livrée par la PR #45, mergée avant le démarrage de la Tranche 3.

### Scope livré

Le parcours historique visible est remplacé par :

```text
Classe
→ Élément
→ Contraintes
→ Objectif
→ Optimiser
```

- Classe issue du catalogue canonique de sorts ;
- Élément : Terre / Feu / Eau / Air / Multi ;
- contraintes : PA, PM, PO, Vitalité, Initiative et quatre résistances élémentaires ;
- objectifs existants : T1, T2, T3, T1–T3, Moyenne, Pire tour ;
- `Constant` n'est pas créé artificiellement ;
- la requête est construite par un adaptateur d'orchestration et envoyée au Worker existant ;
- aucun calcul métier n'est recodé dans l'UI ;
- les résultats exposent équipement, score, stats et dégâts par tour disponibles ;
- un résultat peut être reconstruit en `WorkshopBuild` puis ouvert dans l'Atelier ;
- l'Atelier et sa persistence #44 restent la frontière normale après ouverture d'un résultat.

### Hors scope respecté

- réécriture du solveur ;
- modification de Candidate Policy ;
- modification de SetCoreCatalog ;
- modification des beams/pools ;
- seeds ou cache de recherches ;
- Lock / Reject ;
- `Trouver mieux` ;
- définition finale de `Constant` ;
- nouvelles mécaniques de sorts.

### Done

- nouveau parcours principal utilisable ;
- ancien comportement de calcul conservé via le même contrat Worker et les mêmes moteurs ;
- aucune logique métier dupliquée dans l'UI ;
- résultats ouvrables dans l'Atelier via `WorkshopBuild` / `WorkshopController` ;
- tests ciblés classe / élément / contraintes / objectif / requête / légalité / Atelier / persistence présents ;
- CI et benchmarks verts sur le HEAD final.

## Tranche 3 — Mémoire des recherches + cache exact + seeds

### Dépendance

PR #45 mergée sur le `main@f5cd11661fb0c349db6c3597d5102eca2653fd5a` utilisé comme base stricte.

### Statut

Implémentation portée par la PR #47 `feat: add search memory, exact cache and seeds`. La Tranche 4 reste bloquée jusqu'au merge vert de #47.

### Scope livré dans #47

- repository IndexedDB Search V2 indépendant de la persistence Atelier ;
- forme canonique `NormalizedSearchQuery` ;
- fingerprint stable avec vérification d'égalité canonique avant service d'un hit ;
- versions explicites `data / rules / search` ;
- version data liée aux snapshots items et sorts ;
- hit exact compatible consulté **avant** création du Worker optimizer lourd ;
- résultats persistés ID-only puis réhydratés depuis le catalogue courant ;
- un item disparu invalide proprement le cache exact ;
- recherche conservatrice de requêtes proches ;
- meilleurs builds compatibles utilisés comme seeds dédupliqués ;
- tout seed est résolu contre les items courants puis repasse par `CompleteBuildEvaluator` avant réutilisation ;
- le scoring combat des seeds réutilise le moteur combat existant ;
- Worker seed séparé du Worker principal ;
- fusion seed + résultats libres avec déduplication et diversité existante ;
- la recherche libre set-core + standalone reste inchangée et n'est jamais réduite par les seeds ;
- erreurs IndexedDB/seeds non bloquantes : fallback systématique vers la recherche libre ;
- diagnostics cache hit/miss, fingerprint, proximité, seeds tentés/valides/retenus/rejetés ;
- arrêt manuel conservant les partiels et terminant les deux Workers.

### Hors scope respecté

- modification de `optimizer-worker.js` ;
- modification du solveur ;
- modification de `CandidatePolicy` / `CandidatePrefilter` ;
- modification de `SetCoreCatalog` ;
- modification des beams/pools ;
- Lock / Reject ;
- `Trouver mieux` ;
- définition de `Constant` ;
- plage de tours personnalisée ;
- nouvelles mécaniques de sorts.

### Done

- même requête compatible = aucun recalcul lourd ;
- requête proche = seeds utilisés sans compromettre qualité/légalité ;
- chaque seed est réévalué avec les règles et données courantes ;
- cache incompatible ou incomplet jamais servi ;
- la voie libre reste disponible indépendamment des seeds ;
- diagnostics cache hit / miss / seed disponibles ;
- tests ciblés de fingerprint, versioning, repository ID-only, invalidation, proximité, seeds et fusion présents ;
- `benchmark:v2`, `benchmark:search` et `benchmark:workshop` verts ;
- CI finale verte requise avant passage READY.

## Tranche 4 — Lock / Reject + Trouver mieux

### Dépendance

Ne démarrer qu'après merge vert de la PR #47 depuis un nouveau `main` propre. Ne pas repartir de `feat/v2-search-memory-seeds`.

### Scope

- Lock d'un item comme contrainte stricte de requête ;
- Reject d'un item comme exclusion stricte ;
- réoptimisation incrémentale autour d'un résultat ;
- bouton Atelier `Trouver mieux` ;
- build Atelier utilisé comme seed/lower bound, pas comme prison sauf slots explicitement lockés ;
- possibilité de rejeter facilement Dofus/trophées/Prysmaradites.

### Done

- Lock conserve l'item ;
- Reject garantit son exclusion ;
- les nouvelles contraintes invalident/réutilisent seulement ce qui est compatible ;
- aucun patch DOM/Worker global ;
- résultats finaux repassent par `CompleteBuildEvaluator`.

## Tranche 5 — Tours idéaux / objectifs temporels finaux

### Scope

- cartes/indicateurs T1, T2, T3 en haut de l'Atelier ;
- affichage de la rotation exacte par tour ;
- finalisation de la définition `Constant` ;
- objectif sur plage de tours personnalisée si le coût reste maîtrisé ;
- calcul combat seul sur build fixé, sans recherche d'équipement.

### Règle

Ne pas appeler un objectif `Constant` tant que sa définition mathématique n'est pas figée et testée.

### Done

- tours idéaux compréhensibles ;
- rotation affichable ;
- objectifs temporels documentés et testés ;
- benchmark combat non régressé.

## Tranche 6 — Performance finale

### Priorité d'optimisation

1. réutiliser tout calcul déjà connu ;
2. dédupliquer les états combat ;
3. pré-calculer les vecteurs/items/sets nécessaires ;
4. limiter le combat exact aux meilleurs candidats ;
5. pipeline cheap → coarse → precise ;
6. paralléliser les finalistes entre workers si les benchmarks montrent un gain réel.

### Interdit

- sacrifier les contraintes ;
- masquer une régression en réduisant arbitrairement la qualité ;
- ajouter GPU/WASM sans mesure démontrant le besoin.

### Done

- benchmarks reproductibles avant/après ;
- qualité/fingerprint protégés ;
- gains documentés ;
- stop/finalisation propre des meilleurs résultats déjà connus.

## Tranche 7 — Polish / recette V2

### Scope

- cohérence visuelle néo-rétro ;
- noir `#000000`, gris `#CCCFCA`, rouge `#DC2636` ;
- hiérarchie visuelle forte sans surcharge cyberpunk ;
- parcours Atelier ↔ Optimiseur fluide ;
- mobile/desktop raisonnables ;
- messages d'erreur/états vides propres ;
- nettoyage des restes historiques uniquement après preuve qu'ils ne sont plus exécutés ;
- recette complète et documentation finale.

### Done V2

La V2 est terminée quand :

1. l'Atelier permet de construire, rechercher, sauvegarder et analyser un stuff ;
2. l'Optimiseur utilise l'interface simple Classe → Élément → Contraintes → Objectif ;
3. une recherche identique compatible ressort instantanément ;
4. une recherche proche réutilise des seeds ;
5. Lock / Reject / Trouver mieux fonctionnent nativement ;
6. les tours idéaux et objectifs temporels sont clairs ;
7. toutes les solutions affichées respectent les contraintes ;
8. les dégâts proviennent du moteur canonique ;
9. les benchmarks et la CI sont verts ;
10. une nouvelle fenêtre peut reprendre le projet en lisant `AGENTS.md`, `PROJECT_STATE.md` et ce document.
