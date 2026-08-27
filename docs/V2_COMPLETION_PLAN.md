# Dofus Optimizer V2 — Completion Plan

Ce document est la roadmap de fin de course et, après la Tranche 7, le registre de clôture de la V2.

## Statut global

- [x] Fondation V2 / architecture / baseline
- [x] Moteur de sorts et combat générique
- [x] Candidate Policy / préfiltrage / Pareto / contraintes
- [x] SetCoreCatalog / recherche hybride set-core + standalone
- [x] Atelier V2 : 16 slots, stats live, dégâts sorts, shell produit
- [x] Persistence Atelier + bibliothèque de builds + Smart Item Search — PR #44
- [x] Optimiseur V2 simplifié — PR #45
- [x] Search Memory + cache exact + seeds — PR #47
- [x] Lock / Reject + Trouver mieux — PR #48
- [x] Tours idéaux / objectifs temporels finaux — PR #49
- [x] Performance finale — PR #50
- [x] Polish / recette V2 — PR #51, à considérer définitivement clôturée après merge vert

## Tranche 1 — Persistence Atelier + bibliothèque + Smart Item Search

**Statut : livrée par PR #44.**

Livré :

- IndexedDB versionné et `BuildRepository` séparé de l’UI ;
- sauvegarder / charger / renommer / dupliquer / supprimer ;
- autosave du draft courant ;
- reconstruction d’un `WorkshopBuild` depuis les IDs canoniques ;
- gestion d’items disparus après changement de données ;
- vocabulaire déterministe de recherche d’items ;
- ranking explicable par tags/raisons ;
- recherche pré-indexée rapide.

## Tranche 2 — Optimiseur V2 simplifié

**Statut : livrée par PR #45.**

Parcours canonique :

```text
Classe
→ Élément
→ Contraintes
→ Objectif
→ Optimiser
```

La requête est construite par l’orchestration UI puis transmise au Worker existant. Aucun calcul métier n’est recodé dans l’UI. Un résultat peut être reconstruit en `WorkshopBuild` et rouvert dans l’Atelier.

## Tranche 3 — Mémoire des recherches + cache exact + seeds

**Statut : livrée par PR #47.**

Livré :

- repository IndexedDB Search V2 séparé de la persistence Atelier ;
- `NormalizedSearchQuery` et fingerprint canonique ;
- versions explicites data / rules / search ;
- hit exact compatible consulté avant création du Worker lourd ;
- résultats persistés ID-only puis réhydratés ;
- invalidation propre si données/règles/items ne sont plus compatibles ;
- requêtes proches utilisées comme sources de seeds ;
- tout seed repasse par les évaluateurs courants ;
- Worker seed séparé du Worker principal ;
- fusion avec déduplication/diversité ;
- erreur mémoire non bloquante avec fallback vers recherche libre.

## Tranche 4 — Lock / Reject + Trouver mieux

**Statut : livrée par PR #48.**

Livré :

- Lock = contrainte stricte d’item ;
- Reject = exclusion stricte ;
- build Atelier complet utilisé comme seed/lower bound ;
- seuls les slots explicitement verrouillés deviennent des contraintes ;
- round-trip Optimiseur → Atelier conservant les métadonnées utiles ;
- compatibilité Search Memory inclut Lock/Reject.

## Tranche 5 — Tours idéaux / objectifs temporels finaux

**Statut : livrée par PR #49.**

Livré :

- indicateurs T1 / T2 / T3 dans l’Atelier ;
- rotation exacte T1–T3 sur build fixé ;
- objectifs T1, T2, T3, cumul, moyenne, pire tour ;
- `Constant` défini comme moyenne harmonique T1–T3 ;
- définition partagée par scoring et moteur exact ;
- aucune recherche d’équipement déclenchée par l’analyse d’un build Atelier fixé.

Voir `docs/TEMPORAL_OBJECTIVES_V2.md`.

## Tranche 6 — Performance finale

**Statut : livrée par PR #50.**

Optimisations retenues uniquement après mesure :

- réutilisation des enveloppes/caps sûrs de Candidate Search ;
- score de ranking combat calculé une fois par état unique ;
- aucune baisse de beam/pool/budget ;
- fingerprints, scores, états explorés et résultats protégés par tests/benchmarks.

Voir `docs/PERFORMANCE_V2.md`.

## Tranche 7 — Polish / recette V2

**Statut : portée par PR #51.**

Scope final :

- cohérence visuelle néo-rétro ;
- noir `#000000`, gris `#CCCFCA`, rouge `#DC2636` ;
- hiérarchie visuelle Atelier / Optimiseur ;
- états chargement / vide / erreur explicites ;
- parcours Atelier ↔ Optimiseur fluide ;
- navigation clavier et responsive raisonnables ;
- nettoyage des anciens entrypoints du shell/service worker uniquement après preuve qu’ils ne sont plus exécutés ;
- recette navigateur réelle en CI ;
- documentation finale du runtime V2.

### Garde-fou métier

La Tranche 7 ne modifie aucun moteur métier. Un changement métier n’est autorisé que pour un bug bloquant démontré par la recette. Aucun bug de ce type n’a été nécessaire pour le scope final.

### Recette

Voir `docs/V2_ACCEPTANCE_RECIPE.md`.

La CI standard exécute désormais :

```text
syntax check
→ tests complets
→ recette navigateur V2
→ benchmark:v2
→ benchmark:search
→ benchmark:workshop
```

## Done V2

La V2 est considérée terminée lorsque le HEAD final de PR #51 valide les points suivants :

1. Atelier : construction, recherche, sauvegarde, analyse et rotation exactes ;
2. Optimiseur : Classe → Élément → Contraintes → Objectif ;
3. cache exact compatible ;
4. seeds de requêtes proches réévalués ;
5. Lock / Reject / Trouver mieux natifs ;
6. objectifs temporels finaux et Constant documentés ;
7. solutions finales conformes aux contraintes et à la légalité ;
8. dégâts provenant uniquement du moteur canonique ;
9. benchmarks historiques verts ;
10. recette navigateur cold start → Atelier → Optimiseur → Atelier verte ;
11. UI finale cohérente, accessible au clavier et lisible desktop/mobile ;
12. `README.md`, `PROJECT_STATE.md` et cette roadmap reflètent le runtime réellement exécuté.

Après merge vert de PR #51, **il n’existe plus de Tranche V2 suivante**. Toute nouvelle évolution doit repartir du nouveau `main` comme un nouveau scope produit, de maintenance ou de données.
