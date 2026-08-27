# Dofus Optimizer — Project State

Dernière mise à jour : 2026-08-27

## État actuel

- dépôt : `ElMascarada/dofus-optimizer` ;
- base stricte de la tranche : `main@74f9b7a4f36342799d3697aa1410f06474ce514f` ;
- PR active : #51 — `polish: finalize V2 UX and acceptance recipe` ;
- branche : `polish/v2-final-recipe` ;
- scope strict : **Tranche 7 — Polish / recette V2** ;
- aucun moteur métier n’est modifié par la passe de clôture du gate CI ;
- après merge vert de #51, il n’existe plus de tranche V2 suivante : toute évolution repart d’un nouveau scope depuis `main`.

## V2 complète avant clôture de #51

La V2 couvre désormais le parcours produit complet :

- Fondation V2 / moteur combat générique ;
- `CandidatePolicy` / `CandidatePrefilter` canoniques ;
- `SetCoreCatalog` + recherche hybride set-core / standalone ;
- Atelier V2 : 16 slots, stats live, dégâts sorts, persistence, bibliothèque et Smart Item Search ;
- Optimiseur V2 simplifié : `Classe → Élément → Contraintes → Objectif → Optimiser` ;
- Search Memory V2 : cache exact IndexedDB, requêtes proches et seeds réévalués ;
- Lock / Reject / Trouver mieux ;
- tours idéaux T1/T2/T3, rotations exactes et objectifs temporels finaux dont `Constant` ;
- optimisations finales de performance de la Tranche 6 ;
- polish UI global, états produit, navigation, responsive/clavier et recette de clôture de la Tranche 7.

## Tranche #51 — Polish / recette V2

### Runtime final

Le shell visible est exclusivement V2 :

- Atelier comme vue initiale ;
- Optimiseur V2 comme second onglet ;
- thème final néo-rétro noir `#000000`, gris `#CCCFCA`, rouge `#DC2636` ;
- états `loading`, `empty`, `error` explicites ;
- navigation clavier des onglets et ouverture de slot Atelier au clavier ;
- responsive mobile raisonnable ;
- anciens entrypoints UI absents du runtime chargé ;
- `appVersion` métier inchangée pour éviter toute invalidation artificielle de Search Memory.

Aucun moteur de recherche, d’évaluation, de combat, de légalité, de mémoire ou de scoring n’a été réécrit pour cette tranche.

### Recette navigateur réellement exécutée

`npm run recipe:browser` pilote Chrome headless via CDP et valide réellement :

1. démarrage local et chargement réel des catalogues ;
2. Atelier initial `0 / 16` et version UI `v0.14.2…` ;
3. ouverture clavier d’un slot et équipement d’un vrai item jusqu’à `1 / 16` ;
4. navigation vers l’Optimiseur et activation après sélection d’une vraie classe ;
5. vrai Worker avec contrainte impossible → état terminal `empty`, sans erreur, contrôles restaurés ;
6. vraie recherche libre → arrêt manuel → sortie propre de l’état de recherche, sans état `error`.

Le round-trip résultat complet → Atelier, les 16 slots, Lock/Reject et Trouver mieux restent couverts par les tests Node canoniques ; le smoke navigateur ne prétend pas les rejouer.

## Diagnostic CI #554

Optimizer CI #554 a exécuté avec succès :

- `Syntax check` ;
- le step `Tests` au niveau workflow ;
- `V2 browser acceptance recipe` ;
- `V2 migration baseline benchmark` ;
- `Candidate search benchmark` ;
- `Workshop recalculation benchmark` ;
- upload du rapport.

Le gate final `Fail when tests failed` a néanmoins échoué parce que `npm test` avait retourné un statut non nul capturé par le step `Tests`.

Cause exacte dans le rapport : **2 assertions de texte UI obsolètes**, pas un défaut runtime :

- `tests/optimizer-v2-ui.test.mjs` attendait `Ouvrir dans l’Atelier` alors que le CTA final est `Ouvrir et ajuster dans l’Atelier` ;
- `tests/temporal-objectives-v2.test.mjs` attendait `Constant = moyenne harmonique` alors que l’aide finale dit `Constant utilise la moyenne harmonique T1–T3…`.

La correction de clôture ne touche donc que ces deux contrats de test, plus l’alignement documentaire demandé.

## Validation finale exigée avant READY

Le HEAD final de #51 doit repasser la CI standard complète avec :

- syntaxe verte ;
- `npm test` entièrement vert ;
- smoke navigateur vert ;
- benchmark V2 vert ;
- benchmark Candidate Search vert ;
- benchmark Workshop vert ;
- gate final vert.

La PR #51 reste Draft tant que ce HEAD exact n’est pas entièrement vert. Elle ne doit pas être mergée automatiquement.

## Frontières / invariants à préserver

1. `CompleteBuildEvaluator` reste la validation finale de toute solution.
2. `CandidatePolicy`, `CandidatePrefilter` et `SetCoreCatalog` restent canoniques.
3. Aucun profil de recherche, beam, budget ou règle de légalité ne change dans la Tranche 7.
4. Le moteur combat, les objectifs temporels et leurs formules restent inchangés.
5. Search Memory et ses fingerprints restent inchangés.
6. Le polish ne doit pas devenir une refonte métier déguisée.
7. Les tests de clôture doivent suivre le texte UI réellement livré, sans affaiblir les invariants fonctionnels.

## Reprise rapide

Lire dans cet ordre :

1. `AGENTS.md`
2. `PROJECT_STATE.md`
3. `docs/V2_COMPLETION_PLAN.md`
4. `docs/V2_ACCEPTANCE_RECIPE.md`
5. `docs/PERFORMANCE_V2.md` uniquement pour les références de performance.
