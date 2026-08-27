# Dofus Optimizer — Project State

Dernière mise à jour : 2026-08-27

## État actuel

- dépôt : `ElMascarada/dofus-optimizer` ;
- base de la tranche : `main@f5cd11661fb0c349db6c3597d5102eca2653fd5a`, merge vert de la PR #45 ;
- PR active : #47 — `feat: add search memory, exact cache and seeds` ;
- branche : `feat/v2-search-memory-seeds` ;
- scope strict : **Tranche 3 — Mémoire des recherches + cache exact + seeds** ;
- ne pas commencer la Tranche 4 avant merge vert de #47.

## V2 déjà mergée avant #47

- Fondation V2 / moteur combat générique.
- `CandidatePolicy` / `CandidatePrefilter` canoniques.
- `SetCoreCatalog` + recherche hybride set-core / standalone.
- Atelier V2 : 16 slots, stats live, dégâts sorts, persistence, bibliothèque et Smart Item Search.
- Optimiseur V2 simplifié #45 : `Classe → Élément → Contraintes → Objectif → Optimiser`.
- Ouverture d'un résultat Optimiseur en `WorkshopBuild` via la frontière Atelier.

## Tranche #47 — Search Memory V2

Implémenté sur la branche :

- `js/search-memory/search-query.js` : `NormalizedSearchQuery` canonique, sérialisation stable et fingerprint versionné ;
- versions explicites `data / rules / search` ; la version data dépend des snapshots items + sorts, la version rules du runtime produit et la version search de l'algorithme de mémoire ;
- `js/search-memory/search-repository.js` : repository IndexedDB séparé de l'UI et du solveur, avec `MemorySearchStore` injectable en tests ;
- résultats persistés en **IDs d'items uniquement**, puis réhydratés depuis le catalogue courant ;
- un item disparu invalide proprement le hit exact au lieu de servir un résultat obsolète ;
- un hit exact compatible est servi avant création de `optimizer-worker.js`, donc sans recalcul lourd ;
- recherche conservatrice de requêtes proches : versions, classe, élément, mode temporel, objectif, FM, scénario, profil et contraintes structurelles restent compatibles ;
- extraction dédupliquée de builds connus comme seeds ;
- `js/search-memory/seed-worker.js` : réhydratation et **réévaluation obligatoire de chaque seed avec `CompleteBuildEvaluator` et les règles courantes**, puis scoring combat avec le moteur existant ;
- `js/search-memory/search-result-merge.js` : fusion dédupliquée seed + recherche libre, sans réduire ni remplacer la voie set-core/standalone existante ;
- `optimizer-worker.js`, `CandidatePolicy`, `SetCoreCatalog`, solver, beams et pools restent inchangés ;
- diagnostics `cacheHit`, fingerprint, requêtes proches, seeds tentés/valides/retenus/rejetés ;
- une erreur IndexedDB ou seed n'empêche jamais la recherche libre de continuer ;
- l'arrêt manuel termine le Worker principal et le Worker seed tout en conservant les résultats partiels disponibles.

## Frontières canoniques

- Build final / stats / conditions / sets / FM : `CompleteBuildEvaluator`.
- Sorts / dégâts : moteur combat générique + `evaluateSpell` / combat turn optimizer.
- Recherche candidats : `CandidatePolicy` + `CandidatePrefilter`.
- Panoplies : `SetCoreCatalog`.
- Recherche libre : `optimizer-worker.js` inchangé.
- Atelier : `WorkshopBuild` → `WorkshopController` → `WorkshopEvaluator`.
- Persistence Atelier : `BuildRepository` → IndexedDB dédié.
- Mémoire Optimiseur : `NormalizedSearchQuery` → `SearchMemoryRepository` → IndexedDB Search V2.
- Seeds : résultat ID-only proche → catalogue courant → `CompleteBuildEvaluator` → moteur combat → fusion avec recherche libre.

## Invariants à préserver

1. L'UI ne recalcule pas le métier.
2. Un hit exact n'est servi que si la requête canonique et les versions data/rules/search sont compatibles.
3. Les résultats persistants de recherche stockent des IDs canoniques, pas des copies durables des items.
4. Tout seed est réhydraté depuis le catalogue courant puis réévalué avant réutilisation.
5. Les seeds complètent la recherche libre ; ils ne réduisent aucun pool/beam et ne remplacent ni Set Cores ni standalone.
6. Toute solution recalculée repasse par `CompleteBuildEvaluator`.
7. Une contrainte active influence la conservation des candidats avant le solveur final.
8. Un changement/recherche manuel d'item Atelier ne lance pas l'optimiseur.
9. Lock/Reject et `Trouver mieux` restent hors #47.
10. `Constant` et les plages de tours personnalisées restent hors #47.

## Validation de #47

HEAD code intégré avant documentation : `6ea16824dcf251a44071b8319d1291c5a81aee22`.

Optimizer CI #517 : **SUCCESS** :

- syntax check / `npm run check` : vert ;
- tests : verts, y compris fingerprint/versioning, hit exact ID-only, invalidation, proximité, réévaluation des seeds, fusion et arrêt dual-worker ;
- `benchmark:v2` : vert ;
- `benchmark:search` : vert ;
- `benchmark:workshop` : vert.

La CI du HEAD documentaire final doit encore être verte avant passage READY. Ne pas merger automatiquement.

## Prochaine tranche canonique après merge vert de #47

**Tranche 4 — Lock / Reject + `Trouver mieux`**.

Ne pas la démarrer depuis la branche #47. Repartir du `main` mergé et vert.

## Reprise rapide

Lire dans cet ordre :

1. `AGENTS.md`
2. `PROJECT_STATE.md`
3. `docs/V2_COMPLETION_PLAN.md`
4. puis uniquement les modules nécessaires à la tranche.
