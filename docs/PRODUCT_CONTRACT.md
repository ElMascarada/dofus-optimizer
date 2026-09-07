# Contrat produit

Ce document définit la **direction produit canonique**. Il peut être plus ambitieux que le runtime courant ; les écarts réels sont listés dans `PROJECT_STATE.md` et `docs/DOFUS_MODEL.md`.

## Objectif primaire

Dofus Optimizer est un optimiseur **combat-plan-first**.

> **Le stuff ne veut rien dire tout seul. Le résultat important est le meilleur tour offensif réellement exécutable.**

L'ordre logique cible est :

1. comprendre la vérité Dofus pertinente ;
2. comprendre les sorts, passifs et interactions ;
3. simuler l'état du combat ;
4. construire les séquences réellement jouables ;
5. maximiser le tour offensif demandé `Tn` ;
6. rechercher les ressources, équipements, Dofus, trophées, compagnon, exos et FM qui permettent et maximisent ce plan sous contraintes.

Aucune statistique ni aucun équipement n'a de valeur intrinsèque pour l'optimiseur. Sa valeur provient de son effet sur le meilleur plan de combat réalisable.

## Sémantique exacte de l'objectif Tn

### T1

Le score est le dégât du T1. Il n'existe pas de tour de préparation antérieur.

### T2

Le score est **uniquement le dégât du T2**.

T1 est un tour de préparation. Ses dégâts ne sont pas additionnés au score et peuvent parfaitement être nuls si cela améliore davantage T2. T1 peut notamment :

- lancer un buff de caractéristiques/puissance ;
- préparer un sort dont le lancer suivant est renforcé ;
- poser/consommer un état utile au T2 ;
- charger une mécanique telle qu'Accumulation/Fureur ;
- produire des critiques utiles à une mécanique de Dofus telle que Turquoise ;
- engager un cooldown, une charge ou un compteur si cela améliore T2.

### T3

Le score est **uniquement le dégât du T3**.

T1 et T2 sont des tours de préparation. Le moteur doit pouvoir choisir leurs actions exclusivement pour maximiser l'état offensif disponible au T3. Leurs dégâts propres ne sont pas ajoutés au score T3.

Le même principe doit pouvoir s'étendre plus tard à un horizon `Tn` quelconque : les tours `T1..T(n-1)` servent le tour cible.

Les modes d'agrégation multi-tour (`sum`, `average`, `min`, `constant`) peuvent exister comme objectifs distincts, mais ils ne redéfinissent pas la sémantique des objectifs ciblés `T1/T2/T3` ci-dessus.

## État de combat à conserver

Un planner complet doit être capable de faire transiter au minimum les informations pertinentes suivantes entre actions et tours :

- PA/PM disponibles ;
- buffs/debuffs et durées ;
- états ;
- cooldowns/intervalles de relance ;
- limites de lancer ;
- charges et compteurs ;
- améliorations du prochain lancer d'un sort ;
- critiques réalisés et compteurs dépendants des critiques ;
- effets différés ;
- bonus de dommages finaux et leur ordre d'application ;
- passifs/Dofus/trophées/compagnons actifs ;
- toute autre mécanique certifiée qui peut changer la meilleure séquence.

L'historique nécessaire à une mécanique doit être représenté explicitement plutôt que reconstruit par heuristique.

## Scénario offensif de référence

Pour l'optimisation de plafond offensif par défaut :

- cible unique ;
- cible passive ;
- `0 %` de résistances ;
- aucun comportement adverse à simuler ;
- placement supposé compatible avec le plan candidat : mêlée si nécessaire, distance si nécessaire ;
- objectif : maximiser les dégâts du tour cible tout en respectant les vraies règles des sorts et ressources.

La classe n'est pas étiquetée globalement « mêlée » ou « distance » : c'est le **plan candidat** qui détermine son contexte de frappe. Les choix de compagnon associés au contexte mêlée/distance doivent être dérivés de données certifiées. L'acceptation produit prévoit notamment un arbitrage entre les options de compagnon de type Porécypithon pour un plan distance et Mate pour un plan mêlée ; leurs valeurs exactes doivent être vérifiées dans la source courante avant toute règle runtime.

## PA / PM : ressources, pas objectifs

Le jeu et le produit travaillent autour d'un plafond permanent de référence de `12 PA / 6 PM`, sous réserve des règles de jeu certifiées.

Le moteur ne doit pas maximiser PA/PM pour eux-mêmes :

- si l'utilisateur impose `12 PA`, c'est une contrainte dure ;
- si l'utilisateur autorise `6 PM` mais n'en a pas besoin pour le plan, un build à `5 PM` peut gagner s'il produit davantage de dégâts ;
- un PA/PM supplémentaire n'a de valeur que s'il améliore le plan ou satisfait une contrainte.

Les bonus temporaires de combat restent distincts des minima permanents d'équipement lorsqu'une règle l'exige.

## Faisabilité avant qualité

Les minima utilisateur sont des contraintes dures.

Invariant :

> **FEASIBLE SET NON-EMPTY ⇒ SEARCH MUST RETURN A RESULT**

Si au moins un build légal respecte toutes les contraintes minimales raisonnables, la recherche ne doit pas échouer uniquement parce qu'une heuristique de beam, ranking, Pareto, préfiltrage ou diversification a éliminé ce build.

Une fois la faisabilité assurée, le moteur optimise le plan combat demandé.

## Contrat cible de forgemagie

Le build possède **9 emplacements d'équipement éligibles à la FM spéciale** (coiffe, cape, amulette, deux anneaux, ceinture, bottes, arme, bouclier).

Règle cible : un seul bonus spécial par objet éligible.

- aucun Exo PA/PM utilisé → jusqu'à 9 emplacements offensifs libres ;
- Exo PA seul → 8 ;
- Exo PM seul → 8 ;
- Exo PA + Exo PM → 7.

Les cases d'interface « Autoriser Exo PA/PM » donnent une **permission**, pas une obligation. Le moteur doit pouvoir refuser un exo si l'emplacement libéré pour une FM offensive améliore davantage le plan.

Domaine offensif cible à certifier :

- `+1 % dommages sorts` ;
- `+2 % dommages sorts` ;
- ou `+8 dommages critiques` lorsque c'est plus rentable **et uniquement si l'objet ne possède pas déjà naturellement cette ligne**, sous réserve de validation des règles de jeu exactes avant activation.

L'optimiseur choisit la distribution. L'utilisateur ne doit pas avoir à deviner lui-même quelle FM maximise la rotation.

## Vérité des sorts et passifs

Une mécanique inconnue n'est pas équivalente à « aucune mécanique ».

Le moteur doit distinguer :

- la donnée source disponible ;
- l'interprétation structurée ;
- la mécanique réellement supportée par le runtime ;
- la mécanique restant non résolue.

Il est interdit de présenter un sort comme complètement compris si une sémantique pertinente reste non résolue. Il est également interdit d'inventer une règle depuis un nom, un texte ou une ressemblance sans preuve/certification.

Un agent IA peut assister l'interprétation **offline**, mais doit pouvoir conclure `MECHANIC_UNRESOLVED`. Une sortie IA ne devient pas automatiquement du comportement runtime.

## Vérité équipement

Un résultat doit respecter les règles structurelles et conditions d'équipement comprises par le produit : slots, restrictions spéciales, panoplies, PA/PM, FM/exos autorisés, conditions, passifs et autres invariants certifiés.

Les règles de jeu ne sont pas des coefficients de ranking et ne doivent pas être assouplies pour améliorer un score.

## Scénario d'acceptation prioritaire

Iop Terre / T1 sert de premier scénario représentatif de certification sémantique.

Le moteur doit pouvoir découvrir de lui-même un enchaînement optimal tel que `Colère de Iop + Fureur + Concentration` lorsque les données, coûts, contraintes et mécaniques réelles rendent effectivement cet enchaînement optimal.

Pour T2/T3, les scénarios d'acceptation doivent ensuite vérifier les préparations réelles : buffs, charges de sorts, critiques/Turquoise, effets différés et bonus finaux transportés jusqu'au tour cible.

Aucune rotation d'exemple n'est une règle à coder en dur.

## Explicabilité

Un résultat doit pouvoir expliquer au minimum :

- le tour/plan retenu ;
- les actions de préparation pertinentes ;
- les buffs/états/charges transportés ;
- les contraintes satisfaites ;
- l'usage ou non des Exo PA/PM ;
- la distribution FM retenue ;
- pourquoi un compromis (par exemple 5 PM + davantage de dégâts) bat une autre option.

## Hiérarchie de vérité

En cas de contradiction :

1. données/règles Dofus certifiées pour les faits de jeu ;
2. `docs/PRODUCT_CONTRACT.md` pour l'intention produit ;
3. code runtime + tests pour savoir ce qui est **déjà implémenté** ;
4. `PROJECT_STATE.md` / `docs/DOFUS_MODEL.md` pour les écarts connus ;
5. historique Git/anciennes PR uniquement comme contexte historique.
