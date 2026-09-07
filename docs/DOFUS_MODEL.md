# Modèle Dofus courant

Ce document décrit ce que le produit modélise aujourd'hui. Il ne remplace ni les données normalisées ni les règles exécutables.

## Personnage et équipement

La recherche compose un build à partir des slots définis par le runtime et applique les règles de légalité, conditions d'items, panoplies, caractéristiques et politiques FM/exo prises en charge.

Les contraintes utilisateur telles que PA, PM, initiative, vitalité, caractéristiques ou résistances sont traitées par le moteur de recherche selon leur contrat courant ; les minima durs doivent être satisfaits avant optimisation de qualité.

Les effets d'équipement inconnus ne sont pas inventés. Leur prise en charge doit passer par la normalisation/certification.

## Sorts

Le produit possède deux niveaux de connaissance distincts :

- `spell-data.json` : représentation combat directement consommable ;
- `spell-source-truth.json` : représentation source plus riche, pouvant rester non résolue.

La présence d'un sort dans le catalogue combat ne signifie pas nécessairement que tous ses effets source sont compris.

## Combat

Le moteur sait notamment raisonner sur le coût PA, les lancers et le temps, ainsi que sur les mécaniques explicitement intégrées au runtime. Des mécaniques de classe spécifiques sont enregistrées dans `js/combat/mechanics/`.

Le score d'un build découle du plan de sorts évalué, pas d'une simple somme de caractéristiques offensives.

## Temps

Le runtime définit trois tours de référence : T1, T2 et T3.

Modes disponibles :

- `t1` : score du T1 ;
- `t2` : score du T2 avec simulation préalable nécessaire ;
- `t3` : score du T3 ;
- `sum` : somme des tours actifs ;
- `average` : moyenne ;
- `min` : minimum ;
- `constant` : agrégation favorisant une performance soutenue.

Les formules exactes et les tours simulés sont définis dans `js/temporal-objectives.js`.

## Recherche

Le chemin courant combine :

- préfiltrage et espace de candidats ;
- architectures/panoplies ;
- recherche guidée par contraintes ;
- évaluations de build complet ;
- score combat/temporal ;
- mécanismes de complétude et de réparation destinés à empêcher les heuristiques de perdre tout build faisable.

Les heuristiques servent à réduire le coût de recherche. Elles ne doivent pas redéfinir la légalité ni rendre impossible un ensemble faisable.

## Limite sémantique actuelle

La principale limite connue n'est pas l'absence de données source : le pipeline conserve déjà beaucoup d'informations riches sur les sorts. La limite est la **couverture d'interprétation** du runtime.

Pour étendre le modèle :

1. prouver le sens de la donnée source ;
2. définir sa représentation runtime ;
3. ajouter des tests de vérité mécanique ;
4. l'intégrer au planner ;
5. vérifier que la recherche de stuff réagit correctement au nouveau plan.

Ne pas contourner cette chaîne par un bonus de scoring ad hoc.
