# Dofus Optimizer V2 — Completion Plan

Ce document est la roadmap de fin de course. Il doit permettre à une nouvelle fenêtre de reprendre le rôle de lead sans dépendre d'un historique de conversation.

## Déjà terminé

- [x] Fondation V2 / architecture / baseline
- [x] Moteur de sorts et combat générique
- [x] Candidate Policy / préfiltrage / Pareto / contraintes
- [x] SetCoreCatalog / recherche hybride set-core + standalone
- [x] Atelier V2 foundation : 16 slots, stats live, dégâts sorts, shell produit
- [x] Persistence Atelier + bibliothèque de builds + Smart Item Search (PR #44)

## Tranche 1 — Persistence Atelier + bibliothèque + Smart Item Search

### Dépendances

Atelier #41 mergé.

### Statut

Livrée par la PR #44. La tranche suivante ne doit partir que du `main` après merge vert de #44.

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

### Scope

Remplacer le parcours historique visible par :

```text
Classe
→ Élément
→ Contraintes
→ Objectif
→ Optimiser
```

L'interface doit consommer les contrats existants ; ne pas réécrire le solveur.

### Objectifs

Au minimum exposer proprement les objectifs déjà supportés et préparer le contrat final :

- T1 ;
- T2 ;
- T3 ;
- T1–T3 / moyenne / pire tour selon les modes existants ;
- extension ultérieure explicite vers Constant et plage personnalisée.

### Done

- nouveau parcours principal utilisable ;
- ancien comportement de calcul non régressé ;
- aucune logique métier dupliquée dans l'UI ;
- résultats ouvrables dans l'Atelier si le contrat est déjà prêt ;
- CI verte.

## Tranche 3 — Mémoire des recherches + cache exact + seeds

### Scope

- repository IndexedDB des requêtes et résultats ;
- forme canonique `NormalizedSearchQuery` ;
- fingerprint stable ;
- invalidation par versions data/rules/search ;
- hit exact = résultat immédiat ;
- recherche de requêtes proches ;
- meilleurs builds connus utilisés comme seeds ;
- tout seed réévalué avec les règles courantes ;
- fusion seed + set-core + standalone sans réduire la voie libre.

### Done

- même requête compatible = aucun recalcul lourd ;
- requête proche = seeds utilisés sans compromettre qualité/légalité ;
- cache incompatible jamais servi ;
- diagnostics cache hit / miss / seed disponibles ;
- benchmarks recherche verts.

## Tranche 4 — Lock / Reject + Trouver mieux

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
