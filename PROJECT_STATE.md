# Dofus Optimizer — Project State

Dernière mise à jour : 2026-08-27

## État actuel

- dépôt : `ElMascarada/dofus-optimizer` ;
- base de la tranche : `main@e31843aa74fd5207098966083b4c8f38aee431fb`, merge de la PR #44 ;
- PR active : #45 — `feat: add simplified optimizer v2 flow` ;
- branche : `feat/v2-optimizer-simplified` ;
- scope strict : **Tranche 2 — Optimiseur V2 simplifié** ;
- ne pas commencer la Tranche 3 avant merge vert de #45.

## V2 disponible sur la branche #45

- Fondation V2 / moteur combat générique.
- `CandidatePolicy` / `CandidatePrefilter` canoniques.
- `SetCoreCatalog` + recherche hybride set-core / standalone.
- Atelier V2 #41 : 16 slots, stats live et dégâts sorts.
- Persistence / bibliothèque / Smart Item Search #44.
- Nouveau parcours Optimiseur visible :

```text
Classe
→ Élément
→ Contraintes
→ Objectif
→ Optimiser
```

L'ancien contrôleur `app-experimental.js` reste dans le dépôt mais n'est plus chargé par le parcours produit principal.

## Tranche #45 — Optimiseur V2 simplifié

Implémenté :

- classes issues du catalogue de sorts ;
- éléments `Terre / Feu / Eau / Air / Multi` ;
- contraintes `PA / PM / PO / Vitalité / Initiative / Résistances Terre-Feu-Eau-Air` ;
- objectifs existants `T1 / T2 / T3 / T1–T3 / Moyenne / Pire tour` ;
- aucune définition artificielle de `Constant` ;
- `js/optimizer-v2-orchestrator.js` construit le contrat Worker sans calcul métier ;
- le Worker existant reste la porte d'entrée de `CandidatePolicy`, `SetCoreCatalog`, recherche, moteur combat et `CompleteBuildEvaluator` ;
- résultats : équipement, score, stats principales et dégâts par tour disponibles ;
- `Ouvrir dans l’Atelier` reconstruit un `WorkshopBuild` via la frontière Atelier puis le remet à `WorkshopController` ;
- le build ouvert devient un brouillon Atelier normal et continue d'utiliser l'autosave #44 ;
- arrêt manuel simple conservant les résultats partiels déjà renvoyés par le Worker.

## Frontières canoniques préservées

- Build final / stats / conditions / sets / FM : `CompleteBuildEvaluator`.
- Sorts / dégâts : moteur combat générique + `evaluateSpell`.
- Recherche candidats : `CandidatePolicy` + `CandidatePrefilter`.
- Panoplies : `SetCoreCatalog`.
- Atelier : `WorkshopBuild` → `WorkshopController` → `WorkshopEvaluator`.
- Persistence Atelier : `BuildRepository` → store IndexedDB injecté.
- Optimiseur V2 UI : formulaire → `createOptimizerV2Request()` → Worker existant.

Aucun changement de solveur, Candidate Policy, SetCoreCatalog, beams/pools, seed/cache, Lock/Reject, `Trouver mieux`, Constant ou mécanique de sort n'est inclus dans #45.

## Validation

Checkpoint code nettoyé `fa805c7bed534d11ee030cff5d2b987f2d4059cf` :

- Optimizer CI #493 : **SUCCESS** ;
- Sync spell icons #90 : **SUCCESS** ;
- syntax check : vert ;
- tests : verts après migration des gardes UI historiques vers le nouveau parcours ;
- `benchmark:v2` : vert ;
- `benchmark:search` : vert ;
- `benchmark:workshop` : vert.

Le passage READY reste conditionné à une CI verte sur le HEAD final de la PR après documentation.

## Invariants à préserver

1. L'UI ne recalcule pas le métier.
2. Une contrainte active influence la conservation des candidats avant le solveur final.
3. Toute solution finale repasse par `CompleteBuildEvaluator`.
4. Un changement/recherche manuel d'item Atelier ne lance pas l'optimiseur.
5. La persistence Atelier reste ID-only et reconstructible depuis le catalogue courant.
6. La voie standalone reste disponible avec les Set Cores.
7. Le moteur combat générique ne connaît pas directement les classes/sorts spéciaux.
8. Cache/seeds, Lock/Reject et `Trouver mieux` restent hors #45.

## Prochaine tranche canonique après merge vert de #45

**Tranche 3 — Mémoire des recherches + cache exact + seeds proches**.

Ne pas la démarrer depuis la branche #45. Repartir du `main` mergé et vert.

## Reprise rapide

Lire dans cet ordre :

1. `AGENTS.md`
2. `PROJECT_STATE.md`
3. `docs/V2_COMPLETION_PLAN.md`
4. puis uniquement les modules nécessaires à la tranche.
