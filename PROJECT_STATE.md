# DOFUS Optimizer — Project State

## État courant

État canonique au **14 septembre 2026**, après merge de la PR **#127**.

Main de référence au début de ce slice documentaire :

`edd876980b199fdad96c10d9ebe2ae8b788bd2c8`

Le produit actif est désormais stabilisé autour de deux surfaces distinctes :

- **Optimiseur Equipment-Only** : recherche du meilleur équipement légal sous contraintes, sans dépendance classe/sorts/rotations ;
- **Atelier** : construction et modification manuelle d'un build, statistiques live, remplacement/verrouillage/rejet d'items et outils combat propres à l'Atelier.

Le travail combat historique n'est pas supprimé, mais il n'est pas une dépendance de l'Optimiseur actif.

## Optimiseur actif

### Chemin runtime

```text
Equipment-Only UI
        ↓
js/optimizer-app.js
        ↓
js/optimizer-worker.js
        ↓
js/equipment-search-request.js
        ↓
┌──────────────────────────────┬───────────────────────────────────────┐
│ mono élément                 │ 2/3 éléments ou Multi                 │
│ equipment-search-v2          │ combined-set-core-search              │
└──────────────────────────────┴───────────────────────────────────────┘
        ↓                              ↓
complete build evaluation       exact/contextual Dofus closure
        └───────────────┬──────────────┘
                        ↓
js/complete-equipment-build-evaluator.js
                        ↓
final synthetic-offense ranking
```

### Contrat utilisateur courant

L'Optimiseur expose :

- **Éléments** : Terre, Feu, Eau, Air ; 1 à 3 éléments explicites, ou Multi exclusif ;
- **Type de dégâts** : Petites lignes / Mixte / Grosses lignes ;
- **Critiques** : Auto / Crit / Sans crit ;
- **PA minimum / PM minimum** ;
- contraintes avancées supportées par le moteur ;
- **FM Oui / Non**.

Quand `FM Oui` :

- Exo PA +1 et Exo PM +1 sont présents structurellement dès le début ;
- la recherche part d'une base personnage 8 PA / 4 PM ;
- les deux exos consomment deux slots forgeables ;
- sept assignments offensifs restent à optimiser entre `+1 % dommages sorts` et `+8 dommages critiques` lorsque l'item est éligible et que ce choix améliore le résultat.

Le produit vise **5 stuffs réellement utiles et distincts** lorsqu'ils existent. Un seul résultat est acceptable si aucune diversité pertinente supplémentaire n'existe.

## Scoring et score public

L'Optimiseur actif n'exécute pas de vrais sorts. Il utilise les profils synthétiques certifiés pour comparer les builds.

Pour plusieurs éléments :

1. chaque axe demandé est évalué indépendamment ;
2. le score primaire est le **minimum** des axes demandés ;
3. la moyenne sert de second critère ;
4. le tie-break final est déterministe.

Depuis **#123**, l'UI expose un **score de dégâts théoriques transparent** dérivé de `result.syntheticOffense`. Le renderer n'affiche pas l'ancien score heuristique opaque `result.score` comme valeur publique.

Le score théorique est une mesure standardisée de la valeur offensive du stuff sous le profil demandé ; il ne prétend pas être le dégât d'un sort réel.

## Recherche combinée — état certifié

La fermeture qualité **#120** reste le socle du moteur combiné :

```text
candidate pools
→ set cores avec bonus activés
→ architecture retention
→ equipment completion
→ companion context
→ Dofus/trophy closure
→ authoritative final evaluator
```

Les protections canoniques restent :

- union sémantique des pools candidats ;
- bonus de panoplie appliqués avant jugement du core ;
- préservation des lignées parent→set terminal ;
- réserve d'architectures quasi complètes ;
- meilleur descendant + spécialistes sémantiques par architecture ;
- contexte compagnon avant le dernier trim inter-architectures ;
- fermeture Dofus/trophées dans le contexte réel du build ;
- validation finale autoritative.

Invariant permanent :

> **FEASIBLE SET NON-EMPTY ⇒ SEARCH MUST RETURN A RESULT**

Invariant qualité :

> **Une architecture sémantiquement distincte ne doit pas disparaître uniquement parce que son score partiel est faible avant que son contexte final soit visible.**

Ne pas remplacer ces réserves par un élargissement arbitraire du beam.

## Baselines recherche déjà certifiées

Baselines historiques de la fermeture #120, catalogue réel Steam Machine, `FM Oui`, PA >= 12, PM >= 6 :

- Feu + Eau / Petites lignes / Auto : meilleur score certifié `3895.335` ;
- Feu + Eau / Grosses lignes / Auto : meilleur score certifié `3008.88` ;
- Multi / Grosses lignes / Auto : 20 résultats légaux dans la sonde native, quatre axes équilibrés autour de `1391.11 / 1391.11 / 1391.11 / 1391.52` ;
- runtime Multi isolé observé autour de 100 s sur la machine de certification de cette époque.

Ces valeurs sont des **témoins de non-régression**, pas des constantes produit à hardcoder.

## Présentation résultat active

Les PR **#123 à #127** ont fermé la migration visuelle sans modifier la recherche :

- score `Dégâts théoriques` en tête ;
- colonne gauche : Vitalité / Initiative, caractéristiques offensives, dégâts, Crit/Do Crit et FM ;
- centre : équipement réel avec images catalogue, portrait neutre et six Dofus/trophées ;
- colonne droite : secondaires/défenses et bonus de panoplies ;
- aucune duplication volontaire d'une même statistique entre gauche et droite ;
- caractéristiques affichables sous forme `stat (stat + puissance)` ;
- dégâts élémentaires affichables sous forme `do élémentaire (do élémentaire + do fixe)` ;
- cible visuelle actuelle : desktop 1920×1080, thème clair crème/ocre/olive inspiré du design system ;
- Atelier et Optimiseur partagent désormais la même grammaire visuelle professionnelle.

Le rendu public reste une couche de présentation : il ne doit jamais modifier le ranking ou la légalité.

## Atelier actif

L'Atelier reste une application séparée dans `js/workshop/`.

Contrats importants :

- Optimiseur → Atelier hydrate un build complet sans imposer de classe ;
- verrouiller un item le transforme en exigence de complétion ;
- rejeter/remplacer un item permet une recherche suivante sans cet item ;
- une classe sélectionnée dans l'Atelier peut servir aux analyses combat locales, mais ne remonte pas dans la requête Equipment-Only ;
- statistiques live et équipement manuel utilisent les primitives métier partagées.

## Runtime, cache et CI

Depuis **#121** :

- version runtime canonique : `0.14.8` ;
- cache Service Worker dérivé de cette version ;
- modules actifs combined-search précachés ;
- cache-buster navigateur partagé entre les entrypoints.

Depuis **#122**, la doctrine CI est ciblée :

- `npm run check` toujours ;
- `test:fast` pour les contrats rapides ;
- tests moteur uniquement lorsque le moteur/recherche change ;
- tests données uniquement lorsque données/sync changent ;
- browser acceptance uniquement pour les surfaces navigateur concernées ;
- probes catalogue lourds et benchmarks uniquement pour les missions qui le justifient ;
- les anciens runs d'une même PR sont annulés lorsqu'un nouveau commit les rend obsolètes.

Doctrine propriétaire : **ne pas retester tout le produit lorsqu'une petite surface isolée change**.

## Dernières certifications visuelles/runtime

- #123 : vue résultat ciblée certifiée ;
- #124 : largeur desktop / anti-chevauchement certifiés ;
- #125 : système visuel professionnel certifié ;
- #126 : Atelier professionnel + sélection active unifiée, browser recipe réel PASS et CI #1003 SUCCESS ;
- #127 : suppression des derniers fonds charbon Atelier, 5/5 tests ciblés PASS, `git diff --check` PASS et CI #1011 SUCCESS.

## Prochain milestone actif — campagne qualité produit

La priorité suivante n'est plus la refonte visuelle.

Le prochain chantier est une **campagne de qualité fonctionnelle de l'Optimiseur** :

1. exécuter une matrice stable de scénarios Mono / Bi / Tri / Multi ;
2. couvrir Petites / Mixte / Grosses lignes et Auto / Crit / Sans crit ;
3. observer les 5 stuffs, leur légalité, leur diversité et leurs packages Dofus/compagnon ;
4. utiliser l'Atelier comme outil de contre-exemple : verrouiller/remplacer un item pour démontrer un meilleur build lorsqu'il existe ;
5. corriger uniquement la **première disparition démontrée** d'une meilleure architecture ;
6. ne jamais retuner un poids ou élargir un beam sans diagnostic structurel.

La matrice canonique de cette campagne est définie dans `docs/QUALITY_SCENARIOS.md`.

## Travail combat PARKED

Le futur produit « meilleur tour de dégâts avec les vrais sorts » reste séparé du moteur de recherche de stuff.

Les modules et vérités combat existants restent valides pour Atelier/tests/historique. Toute réactivation comme produit principal exigera une décision explicite et une architecture dédiée ; elle ne doit pas contaminer la requête Equipment-Only actuelle.
