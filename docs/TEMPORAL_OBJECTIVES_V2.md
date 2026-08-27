# Objectifs temporels V2

Ce document fixe le contrat mathématique final des objectifs temporels de Dofus Optimizer V2.

## Horizon certifié

La V2 optimise les trois tours certifiés `T1`, `T2`, `T3`. Les états combat persistants entre tours (buffs, états, charges, cooldowns et effets différés) sont conservés par `optimizeCombatSequence`.

Une plage arbitraire au-delà de T3 n'est pas exposée dans cette tranche : elle augmenterait l'horizon d'état du moteur et relève de la tranche Performance finale. Les modes finaux restent donc définis sur l'horizon certifié T1–T3.

## Définitions

Pour `D1`, `D2`, `D3`, les dégâts exacts produits respectivement à T1, T2 et T3 :

- `T1` : `D1` ;
- `T2` : `D2` ;
- `T3` : `D3` ;
- `T1 + T2 + T3` : `D1 + D2 + D3` ;
- `Moyenne T1–T3` : `(D1 + D2 + D3) / 3` ;
- `Pire tour` : `min(D1, D2, D3)` ;
- `Constant` : moyenne harmonique `3 / (1/D1 + 1/D2 + 1/D3)`.

Si au moins un des trois dégâts est nul ou négatif, le score `Constant` vaut `0`.

## Pourquoi la moyenne harmonique pour Constant

`Pire tour` et `Constant` doivent rester deux objectifs distincts.

`Pire tour` ne regarde que le minimum. `Constant` doit à la fois conserver une notion de débit de dégâts et pénaliser les écarts entre tours, sans coefficient arbitraire. Pour un total de dégâts fixé, la moyenne harmonique est maximale lorsque les trois valeurs sont égales. Elle chute fortement lorsqu'un tour devient faible et vaut zéro lorsqu'un tour ne produit aucun dégât.

Exemples :

- `100 / 100 / 100` → Constant `100` ;
- `200 / 100 / 100` → Constant `120` ;
- `300 / 300 / 0` → Constant `0`.

## Source de vérité

La formule canonique vit dans `js/temporal-objectives.js`.

Elle est consommée par :

- `js/spells.js` pour le scoring rapide / FM / upper bounds ;
- `js/turn-optimizer.js` pour le scoring de la rotation exacte ;
- l'Atelier pour les métriques T1/T2/T3 affichées sur un build fixé.

Aucune UI ne recalcule la formule indépendamment.

## Atelier

Sur un stuff complet et fixé, l'Atelier lance uniquement `optimizeCombatSequence` avec l'objectif cumul T1–T3. Il n'appelle ni Candidate Search, ni Architecture Search, ni l'Optimizer Worker.

Les cartes T1/T2/T3 et la rotation détaillée proviennent du même plan cohérent ; les effets inter-tour sont donc conservés. Le recalcul léger de `WorkshopEvaluator` reste séparé de cette analyse exacte.
