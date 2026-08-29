# Dofus Optimizer — Project State / Recovery

Dernière mise à jour : 2026-08-29

## État directeur

Le projet est en **Recovery produit**.

Baseline auditée :

```text
main@95cec150bbd3d0e0a41b1b3a26c5c4df9210e6ee
```

PR #62 (`ui: show combat preview in optimizer results`) reste une PR UI Draft distincte. Elle ne change pas le contrat Recovery ci-dessous.

La priorité immédiate n'est plus d'ajouter de la sophistication Search ou UI. Le produit doit d'abord retrouver une vérité combat unique et vérifiable.

> **UI et sophistication Search restent gelées tant que la vérité combat n'est pas stabilisée.**

## Objectif produit canonique

Dofus Optimizer doit :

> **Trouver le build qui maximise les dégâts réels dans le scénario demandé, parmi les builds qui respectent les contraintes utilisateur.**

Les contraintes déterminent uniquement l'admissibilité du build.

Elles ne sont pas des sous-objectifs et ne donnent aucun score par elles-mêmes :

```text
contraintes != objectif
PA / PM / Initiative ne donnent aucun score en eux-mêmes
score final = performance combat du scénario demandé
```

Exemple : avec `Iop / Terre / T1 / 12 PA minimum / 6 PM minimum / Initiative >= 5000`, l'objectif reste de maximiser les dégâts T1 Terre parmi les builds qui satisfont aussi `Initiative >= 5000`.

## Vérité combat unique

Un même build, évalué dans le même scénario et avec le même état de départ, doit produire une seule valeur de dégâts canonique.

Optimizer et Workshop doivent partager cette vérité combat. Le Search peut employer des heuristiques ou des scores proxy pour explorer, mais le classement et la valeur finale exposés au produit doivent provenir de la réévaluation canonique.

Écart produit actuellement certifié :

```text
Optimizer score / plan = 4746.31
Workshop T1           = 4662.55
```

Cet écart interdit de considérer les deux chemins comme deux vérités équivalentes.

Audit du 2026-08-29 :

- l'Optimizer T1 produit son score final depuis un `combatPlan` optimisé pour `turnMode = t1` ;
- le Workshop reconstruit le build, puis `analyzeWorkshopTurns()` optimise actuellement un objectif `turnMode = sum` sur T1+T2+T3 et expose ensuite la tranche T1 de ce plan ;
- la conversion Optimizer → Workshop transporte les items, la politique FM et les IDs uniques des sorts présents dans la séquence, mais pas le contexte complet qui a produit le résultat : objectif temporel, scénario, caractéristiques/FM résolues, stats temporelles, séquence ordonnée et multiplicités de casts ;
- `evaluateWorkshopBuild()` réoptimise donc caractéristiques et FM avec un contexte de sorts reconstruit avant de relancer le planificateur.

La convergence de ces chemins fait partie des Phases 1 et 2. Aucune correction moteur n'est incluse dans cette mise à jour documentaire.

## Modes produit cibles

À terme, les seuls modes d'optimisation produit sont :

```text
T1
T2
Moyenne combat
```

`T3`, `T1 + T2 + T3`, `Pire tour` et `Constant` peuvent encore exister dans le runtime historique pendant la Recovery, mais ne sont plus des objectifs produit cibles.

### T1

Maximiser exclusivement les dégâts du tour 1.

Les dégâts des autres tours n'ont aucune valeur dans le score T1.

### T2

Maximiser exclusivement les dégâts du tour 2.

Le T1 entier est disponible comme tour de préparation. Toute action T1 est admissible si elle permet d'augmenter le meilleur burst T2 :

- buffs ;
- charges ;
- états ;
- préparation de sorts ;
- effets conditionnels ;
- actions sans dégâts ;
- autres préparations représentables par le modèle combat.

Les dégâts infligés au T1 n'ont aucune valeur propre dans le score T2.

Le moteur devra représenter un véritable état persistant entre T1 et T2. Pour le scénario T2 canonique initial, on peut supposer :

```text
aucun dégât ennemi subi pendant le tour de préparation
```

afin de rendre déterministes les conditions associées.

### Moyenne combat

Maximiser les dégâts moyens sur le combat.

L'horizon précis et les règles d'arrêt seront définis ultérieurement avant implémentation/certification de ce mode.

## Effets et items conditionnels

Aucun item ne doit être rendu artificiellement obligatoire pour un mode.

Les effets doivent être modélisés avec leur vraie valeur, leur condition et leur timing afin que le meilleur choix émerge du build global. Exemples structurants :

- **Nébuleux** : +20 % dommages finaux au T1 lorsque son effet est applicable ;
- **Ocre** : peut apporter 1 PA supplémentaire au T2 si sa condition est satisfaite ;
- **Vulbis** : peut apporter +10 % dommages finaux au T2 si sa condition est satisfaite.

Les choix Ocre, Vulbis, Pourpre, Dofus des Glaces, Prysmaradite, critique, trophées, familiers/montiliers, bonus de panoplie et exos restent dépendants du build global et du scénario.

## Recovery roadmap

### Phase 0 — Gel produit / baseline

Figer une baseline reproductible, les scénarios canoniques et les écarts connus. Aucun nouveau chantier UI/Search de sophistication.

### Phase 1 — Contrat combat

Définir explicitement les entrées, l'état de départ, l'objectif temporel, les hypothèses et la sortie canonique d'une évaluation combat.

### Phase 2 — Vérité unique des dégâts

Faire converger Optimizer et Workshop vers la même évaluation canonique et éliminer les doubles vérités de score/dégâts.

### Phase 3 — Modèle temporel / stateful des sorts

Représenter correctement préparation, buffs, charges, cooldowns, états et effets persistants entre les tours, notamment pour T2.

### Phase 4 — Validité et contraintes

Garantir que les contraintes servent uniquement d'admissibilité finale et que toutes les règles de build/conditions sont certifiées avec le même contexte.

### Phase 5 — Planificateur de rotation

Certifier que le planificateur maximise réellement l'objectif du scénario demandé, sans valoriser les dégâts hors objectif.

### Phase 6 — Search équipement

Rebrancher et ajuster l'exploration équipement autour de la vérité combat stabilisée. Les heuristiques peuvent accélérer la recherche mais ne définissent pas le score final.

### Phase 7 — Performance / multicœur

Optimiser l'efficacité algorithmique puis utiliser un parallélisme CPU contrôlé lorsque cela améliore réellement la couverture sans saturation inutile.

### Phase 8 — Certification produit

Certifier les scénarios canoniques, la légalité, l'exécutabilité, les dégâts et l'ordre du Top 5 après réévaluation canonique.

### Phase 9 — UI / UX

Reprendre l'amélioration de présentation uniquement après stabilisation et certification de la vérité produit.

## Scénarios minimum de certification

Au minimum :

```text
Iop / Terre / T1 / 12 PA / 6 PM
Iop / Terre / T2 / 12 PA / 6 PM
Iop / Terre / T1 / 12 PA / 6 PM / Initiative >= 5000
```

Pour chacun, tout résultat affiché doit respecter les contraintes et être réévaluable par la vérité combat canonique.

Contrat de classement Top 5 :

```text
damage(#1) >= damage(#2) >= damage(#3) >= damage(#4) >= damage(#5)
```

Les valeurs `damage(#n)` sont celles obtenues après réévaluation de chaque build par la vérité combat canonique dans exactement le scénario demandé, pas un proxy Search.

## Cadrage architecture Recovery

Candidat actuel le plus naturel pour le noyau de vérité combat : le planificateur exécutable `optimizeCombatSequence()` (`js/turn-optimizer.js`) et la pile générique d'état/mécaniques/dégâts qu'il appelle, car Optimizer et Workshop l'utilisent déjà pour produire des rotations exécutables.

`CompleteBuildEvaluator` reste la frontière naturelle pour la structure du build, les conditions, bonus de panoplie, caractéristiques, FM, statistiques et contraintes. Son objectif offensif synthétique peut servir d'heuristique de Search, mais ne doit pas devenir une seconde vérité combat exposée au produit.

La Phase 2 devra définir un contexte combat partagé et explicite afin que les deux surfaces appellent la même évaluation avec les mêmes entrées.

## Risques à traiter avant certification

- T2 actuel ne matérialise pas encore un vrai T1 complet de préparation avant le burst T2 ;
- le beam search et ses fonctions de priorité restent des heuristiques et peuvent écarter des états préparatoires utiles ;
- certaines conditions/passifs dépendent encore d'un contexte de scénario incomplet ou explicitement ignoré pendant certaines recherches ;
- caractéristiques/FM et rotation ont une dépendance circulaire : le contexte utilisé pour optimiser les stats doit être cohérent avec la rotation canonique ;
- les fingerprints/cache devront évoluer lorsque le contrat combat canonique changera ;
- le Product Smoke doit à terme certifier l'égalité de la vérité combat et l'ordre réel du Top 5, pas seulement la présence de deux valeurs positives.

## Reprise obligatoire pour un futur agent

1. Lire `AGENTS.md`.
2. Lire **ce fichier** comme cadrage directeur actuel.
3. Ne pas relancer une tranche V2 historique comme roadmap active.
4. Ne pas modifier UI ou sophistication Search avant stabilisation de la vérité combat, sauf instruction directeur explicite.
5. Travailler phase par phase depuis le `main` mergé demandé par le directeur.
