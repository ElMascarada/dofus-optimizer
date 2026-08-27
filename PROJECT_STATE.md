# Dofus Optimizer — Project State

Dernière mise à jour : 2026-08-27

## État actuel

- dépôt : `ElMascarada/dofus-optimizer` ;
- base stricte de la tranche : `main@6d94dbb32f416b0ac3caccbc212f5eb2e48e2cd0`, merge vert de la PR #48 ;
- PR active : #49 — `feat: finalize V2 temporal objectives and ideal turns` ;
- branche : `feat/v2-final-turn-objectives` ;
- scope strict : **Tranche 5 — Tours idéaux / objectifs temporels finaux** ;
- Tranche 6 Performance finale et Tranche 7 polish/recette restent explicitement hors scope.

## V2 déjà mergée avant #49

- Fondation V2 / moteur combat générique.
- `CandidatePolicy` / `CandidatePrefilter` canoniques.
- `SetCoreCatalog` + recherche hybride set-core / standalone.
- Atelier V2 : 16 slots, stats live, dégâts sorts, persistence, bibliothèque et Smart Item Search.
- Optimiseur V2 simplifié : `Classe → Élément → Contraintes → Objectif → Optimiser`.
- Search Memory V2 : cache exact IndexedDB, requêtes proches, seeds ID-only réévalués par les moteurs courants.
- Lock / Reject / Trouver mieux : contraintes explicites de requête et seed Atelier sans enfermer les slots non lockés.

## Tranche #49 — Tours idéaux / objectifs temporels finaux

Implémenté sur la branche :

- nouveau module canonique `js/temporal-objectives.js` pour les objectifs T1, T2, T3, cumul, moyenne, pire tour et `Constant` ;
- `Constant` est défini mathématiquement comme la moyenne harmonique T1–T3 : `3 / (1/T1 + 1/T2 + 1/T3)` ; si un tour vaut 0, le score Constant vaut 0 ;
- la même définition est utilisée par le scoring rapide (`spells.js`) et le moteur de rotation exact (`turn-optimizer.js`) ;
- `Constant` est traité comme un objectif multi-tour par le refiner existant, sans modification de ses budgets, beams ou pools ;
- l'Atelier expose T1/T2/T3 et `Constant` sur un stuff complet ;
- l'Atelier affiche une rotation exacte T1–T3 avec dégâts, PA, ordre des sorts et conservation des buffs/états/charges/cooldowns inter-tour ;
- l'analyse Atelier utilise uniquement `optimizeCombatSequence` sur le build fixé ; elle n'appelle ni Candidate Search, ni Architecture Search, ni l'Optimizer Worker ;
- `WorkshopEvaluator` reste un recalcul léger : l'analyse exacte des tours est déclenchée séparément au rendu d'un build complet puis mémorisée pour ce rendu ;
- l'horizon certifié reste T1–T3 ; aucune plage arbitraire au-delà de T3 n'est ajoutée dans cette tranche afin de ne pas empiéter sur la Tranche Performance ;
- définition et choix documentés dans `docs/TEMPORAL_OBJECTIVES_V2.md` ;
- tests ciblés ajoutés dans `tests/temporal-objectives-v2.test.mjs`.

## Frontières canoniques

- Build final / stats / conditions / sets / FM : `CompleteBuildEvaluator`.
- Sorts / dégâts : moteur combat générique + `evaluateSpell` / `optimizeCombatSequence`.
- Objectifs temporels : `js/temporal-objectives.js`.
- Recherche candidats : `CandidatePolicy` + `CandidatePrefilter`.
- Panoplies : `SetCoreCatalog`.
- Recherche libre : `optimizer-worker.js`.
- Atelier : `WorkshopBuild` → `WorkshopController` → `WorkshopEvaluator` ; l'analyse exacte T1–T3 est une lecture combat séparée sur build fixé.
- Persistence Atelier : `BuildRepository` → IndexedDB.
- Mémoire Optimiseur : `NormalizedSearchQuery` → `SearchMemoryRepository` → IndexedDB Search V2.

## Invariants à préserver

1. L'UI ne recalcule pas le métier.
2. Les dégâts affichés proviennent du moteur combat canonique.
3. La définition de chaque objectif temporel est centralisée dans `temporal-objectives.js`.
4. `Constant` ne doit jamais diverger entre scoring rapide et rotation exacte.
5. Un simple changement/recherche manuel d'item Atelier ne lance jamais Candidate Search, Architecture Search ou l'Optimizer Worker.
6. L'analyse T1–T3 d'un stuff fixé peut lancer le moteur combat, mais pas la recherche d'équipement.
7. Les états inter-tour doivent être conservés dans une rotation T1–T3 cohérente.
8. Aucun budget de recherche ne doit être augmenté pour cette tranche.
9. La plage personnalisée > T3 n'est pas implémentée tant que son coût/horizon d'état n'est pas traité explicitement.
10. La Tranche Performance finale et le polish UI global restent hors #49.

## Validation de #49

Validation fonctionnelle sur le code de tranche :

- `npm run check` : vert ;
- tests historiques + tests temporels : verts après correction d'un fixture de test de moyenne harmonique ;
- `npm run benchmark:v2` : vert ;
- `npm run benchmark:search` : vert ;
- `npm run benchmark:workshop` : vert ;
- `npm run report:spell-support` : vert sur CI #529 ;
- CI standard #528 : verte sur `c41c9caedfb90bd0ca68471d00a85524ffeb75c0` ;
- CI #529 avec vérification temporaire explicite `report:spell-support` : verte sur `85ed16aa4da52deedc24526a4c42085540136bca` ;
- le workflow CI temporairement enrichi pour cette vérification a ensuite été restauré exactement à sa version de départ.

Le HEAD documentaire final doit encore repasser la CI standard verte avant passage READY. Ne pas merger automatiquement.

## Prochaine tranche canonique après merge vert de #49

**Tranche 6 — Performance finale**, uniquement après instruction explicite et depuis un nouveau `main` mergé et vert.

Ne pas commencer cette tranche depuis la branche #49.

## Reprise rapide

Lire dans cet ordre :

1. `AGENTS.md`
2. `PROJECT_STATE.md`
3. `docs/V2_COMPLETION_PLAN.md`
4. puis uniquement les modules nécessaires à la tranche.
