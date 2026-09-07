# Contrat produit

## Objectif primaire

Dofus Optimizer est un optimiseur **combat-plan-first**.

L'ordre logique est obligatoire :

1. comprendre les sorts et les règles applicables ;
2. construire les tours réellement jouables ;
3. déterminer le meilleur plan pour l'objectif temporel demandé ;
4. rechercher le stuff qui permet ce plan tout en respectant les contraintes ;
5. maximiser la qualité combat parmi les builds faisables.

Le stuff n'est donc pas l'objectif autonome du produit : il sert le plan de combat.

## Faisabilité avant qualité

Les minima utilisateur sont des contraintes dures.

Invariant :

> **FEASIBLE SET NON-EMPTY ⇒ SEARCH MUST RETURN A RESULT**

Si au moins un build légal respecte toutes les contraintes minimales raisonnables, la recherche ne doit pas échouer uniquement parce qu'une heuristique de beam, de ranking, de Pareto, de préfiltrage ou de diversification a éliminé ce build.

Une fois la faisabilité assurée, le moteur optimise l'objectif combat choisi.

## Tour réellement jouable

Le score ne doit provenir que d'une séquence compatible avec :

- PA disponibles ;
- limites de lancer ;
- cooldowns/intervals compris ;
- état temporel simulé ;
- mécaniques de sort explicitement prises en charge ;
- autres règles de combat certifiées par le runtime.

Les modes temporels courants sont définis par le code (`t1`, `t2`, `t3`, `sum`, `average`, `min`, `constant`). Le code fait foi pour leurs agrégations exactes.

## Vérité de sort

Une mécanique inconnue n'est pas équivalente à « aucune mécanique ».

Le moteur doit distinguer :

- la partie runtime certifiée ;
- la vérité source importée mais non encore interprétée.

Il est interdit de présenter un sort comme complètement compris si une sémantique pertinente reste `source-unresolved`. Il est également interdit de déduire automatiquement une mécanique depuis un texte, un nom ou une ressemblance avec un autre sort sans règle certifiée.

## Vérité équipement

Un build retourné doit respecter les règles structurelles et les conditions d'équipement comprises par le produit : slots, restrictions spéciales, panoplies, PA/PM, FM/exos autorisés, conditions et autres invariants codés.

Les règles de jeu ne sont pas des coefficients de ranking et ne doivent pas être assouplies pour améliorer un score.

## Scénario d'acceptation prioritaire

Iop Terre / T1 sert de scénario représentatif pour la prochaine tranche sémantique.

Le moteur doit pouvoir découvrir de lui-même un enchaînement optimal tel que `Colère de Iop + Fureur + Concentration` lorsque les données, coûts, contraintes et mécaniques réelles rendent effectivement cet enchaînement optimal.

La séquence n'est **pas** une règle à coder en dur. Une modification de données ou de contexte doit pouvoir conduire à une autre meilleure séquence.

## Hiérarchie de vérité

En cas de contradiction :

1. règles certifiées et données normalisées courantes ;
2. code runtime et tests protégeant le comportement ;
3. ce contrat et la documentation courante ;
4. historique Git/anciennes PR uniquement comme contexte historique.
