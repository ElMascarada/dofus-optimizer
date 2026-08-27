# Dofus Optimizer — Project State

Dernière mise à jour : 2026-08-27

## État actuel

- dépôt : `ElMascarada/dofus-optimizer` ;
- base de la tranche : `main@be1d8a956fd24cb6059b89815472d0528be9e9ba`, merge vert de la PR #47 ;
- PR active : #48 — `feat: add V2 lock reject and find better flow` ;
- branche : `feat/v2-lock-reject-find-better` ;
- scope strict : **Tranche 4 — Lock / Reject + Trouver mieux** ;
- `Constant` et les objectifs temporels finaux restent explicitement hors scope.

## V2 déjà mergée avant #48

- Fondation V2 / moteur combat générique.
- `CandidatePolicy` / `CandidatePrefilter` canoniques.
- `SetCoreCatalog` + recherche hybride set-core / standalone.
- Atelier V2 : 16 slots, stats live, dégâts sorts, persistence, bibliothèque et Smart Item Search.
- Optimiseur V2 simplifié : `Classe → Élément → Contraintes → Objectif → Optimiser`.
- Ouverture d'un résultat Optimiseur en `WorkshopBuild` via la frontière Atelier.
- Search Memory V2 #47 : `NormalizedSearchQuery`, cache exact IndexedDB, requêtes proches, seeds ID-only réévalués par les moteurs courants.

## Tranche #48 — Lock / Reject + Trouver mieux

Implémenté sur la branche :

- `WorkshopBuild` porte désormais `lockedSlots` et `rejectedItemIds` comme état applicatif explicite ;
- Lock est attaché à un slot Atelier stable et survit à la persistence ; retirer ou rejeter l'item retire le lock correspondant ;
- Reject retire l'item du build courant et l'ajoute à une blacklist persistée ; un bouton permet d'effacer les rejets ;
- contrôles Lock / Reject directement sur chaque slot, notamment les six slots Dofus / trophées / Prysmaradites ;
- bouton Atelier **Trouver mieux**, actif seulement pour un stuff complet avec classe ;
- `workshopOptimizationContext()` dérive du build courant :
  - les seuls slots explicitement lockés en `lockedItemsBySlot` ;
  - les rejets en `rejectedItemIds` ;
  - le build complet courant comme seed ID-only ;
- `createOptimizerV2Request()` transforme les locks en `requiredItemIds`, déjà imposés strictement par la recherche d'architectures ;
- les items rejetés sont exclus du catalogue transmis à la recherche ; un conflit Lock + Reject est refusé explicitement ;
- `NormalizedSearchQuery` passe en schéma 2 : locks et rejects participent au fingerprint et à la compatibilité des requêtes proches ;
- le seed Atelier ne participe pas au fingerprint : il reste une proposition/lower bound, jamais une contrainte implicite sur les slots non lockés ;
- les seeds proches et le seed Atelier sont dédupliqués, puis tout seed qui manque un required item ou contient un reject est éliminé avant réévaluation ;
- un cache exact compatible reste réutilisable ; avec `Trouver mieux`, le résultat en cache est conservé et seul le seed Atelier est réévalué avant fusion ;
- les résultats ouverts dans l'Atelier replacent les items lockés dans leurs slots Atelier exacts et conservent la blacklist ;
- aucune modification de `CandidatePolicy`, `SetCoreCatalog`, des beams/pools ou de `CompleteBuildEvaluator` ;
- aucun patch global DOM / Worker.

## Frontières canoniques

- Build final / stats / conditions / sets / FM : `CompleteBuildEvaluator`.
- Sorts / dégâts : moteur combat générique + `evaluateSpell` / combat turn optimizer.
- Recherche candidats : `CandidatePolicy` + `CandidatePrefilter`.
- Panoplies : `SetCoreCatalog`.
- Recherche libre : `optimizer-worker.js`.
- Atelier : `WorkshopBuild` → `WorkshopController` → `WorkshopEvaluator`.
- Persistence Atelier : `BuildRepository` → IndexedDB dédié, snapshots Atelier schéma 2 pour Lock/Reject.
- Mémoire Optimiseur : `NormalizedSearchQuery` schéma 2 → `SearchMemoryRepository` → IndexedDB Search V2.
- Seeds : résultat ID-only compatible → catalogue courant → filtre Lock/Reject → `CompleteBuildEvaluator` → moteur combat → fusion avec recherche libre.

## Invariants à préserver

1. L'UI ne recalcule pas le métier.
2. Un Lock devient une contrainte stricte de requête et l'item doit rester présent dans tout résultat accepté.
3. Un Reject exclut strictement l'item du catalogue de la recherche et des seeds réutilisés.
4. Seuls les slots explicitement lockés deviennent des contraintes ; le reste du stuff Atelier reste libre d'évoluer.
5. Le build Atelier courant est un seed/lower bound, pas une prison.
6. Un hit exact n'est servi que si requête canonique, Lock/Reject et versions data/rules/search sont compatibles.
7. Tout seed est réhydraté depuis le catalogue courant puis réévalué avant réutilisation.
8. Les seeds complètent la recherche libre ; ils ne réduisent aucun pool/beam et ne remplacent ni Set Cores ni standalone.
9. Toute solution recalculée repasse par `CompleteBuildEvaluator`.
10. Un changement/recherche manuel d'item Atelier ne lance pas l'optimiseur ; seul `Trouver mieux` déclenche explicitement la réoptimisation.
11. `Constant` et les plages/objectifs temporels finaux ne font pas partie de #48.

## Validation de #48

Checkpoint code avant mise à jour documentaire : `5705293577a1d1edf83f3be896eac7881a930196`.

Optimizer CI #521 sur ce checkpoint : validations métier terminées avec succès :

- syntax check / `npm run check` : vert ;
- tests historiques + tests Lock/Reject/Trouver mieux : verts ;
- `benchmark:v2` : vert ;
- `benchmark:search` : vert ;
- `benchmark:workshop` : vert.

La CI du HEAD documentaire final doit encore être verte avant passage READY. Ne pas merger automatiquement.

## Prochaine tranche canonique après merge vert de #48

**Tranche 5 — objectifs temporels finaux / Constant**, uniquement après instruction explicite et depuis un nouveau `main` mergé et vert.

Ne pas commencer cette tranche depuis la branche #48.

## Reprise rapide

Lire dans cet ordre :

1. `AGENTS.md`
2. `PROJECT_STATE.md`
3. `docs/V2_COMPLETION_PLAN.md`
4. puis uniquement les modules nécessaires à la tranche.
