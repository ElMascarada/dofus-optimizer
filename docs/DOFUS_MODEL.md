# Modèle Dofus courant

Ce document sépare volontairement **ce que le runtime sait faire aujourd'hui** de **ce que le contrat produit exige à terme**. Il ne remplace ni les données normalisées ni les règles exécutables.

## 1. Personnage et équipement — état courant

La recherche compose un build depuis les slots du runtime et applique les règles de légalité, conditions d'items, panoplies, caractéristiques et politiques FM/exo prises en charge.

Les minima utilisateur (PA, PM, initiative, vitalité, résistances, etc.) sont traités comme des contraintes dures lorsqu'ils sont actifs. Les heuristiques de recherche servent à trouver plus vite ; elles ne doivent pas redéfinir la légalité.

Le produit manipule 16 slots au total dans son build courant, dont 9 slots d'équipement ordinaires éligibles au futur budget FM spécial : coiffe, cape, amulette, deux anneaux, ceinture, bottes, arme, bouclier. Les autres slots incluent le compagnon et six emplacements Dofus/trophées.

## 2. Sorts — état courant

Le produit possède deux niveaux de connaissance distincts :

- `data/normalized/spell-data.json` : représentation combat directement consommable ;
- `data/normalized/spell-source-truth.json` : représentation source plus riche, pouvant rester non résolue.

La présence d'un sort dans le catalogue combat ne signifie pas que tous ses effets source sont compris. Les mécaniques spécifiques explicitement prises en charge peuvent vivre dans `js/combat/mechanics/`.

Le problème P0 actuel est la **couverture d'interprétation**, pas seulement l'import de données.

## 3. Combat — état courant

Le moteur sait raisonner sur le coût PA, les lancers, le temps et les mécaniques explicitement intégrées au runtime. Le score d'un build découle d'un plan de sorts évalué, pas d'une simple somme de caractéristiques offensives.

Ce moteur n'est toutefois pas encore un simulateur exhaustif de toutes les mécaniques Dofus. Les buffs/états/charges/passifs non certifiés doivent rester hors activation plutôt qu'être inventés.

## 4. Temps — état courant vs contrat

Le runtime définit T1, T2, T3 et les modes `sum`, `average`, `min`, `constant`.

Dans `js/temporal-objectives.js` aujourd'hui :

- `t1` score T1 ;
- `t2` score T2 et demande explicitement une simulation `[T1, T2]` ;
- `t3` score T3 mais la fonction de tours simulés ne demande actuellement que T3 ;
- `sum`, `average`, `min`, `constant` évaluent plusieurs tours selon leurs formules courantes.

**Écart important :** le contrat produit exige que T3 simule T1 puis T2 comme préparation et ne score que T3. Ce n'est pas encore vrai dans le helper temporel courant et ne doit pas être présenté comme implémenté.

## 5. Scénario combat — cible

Le scénario canonique de plafond offensif demandé par le produit est : cible unique, passive, 0 % résistances, placée en mêlée ou à distance selon les besoins du plan. Le placement n'est pas encore une simulation tactique complète ; il sert à comparer les plans offensifs dans leur contexte légal.

La classification mêlée/distance doit appartenir au plan candidat et non à une étiquette fixe sur la classe.

## 6. PA / PM — contrat

PA et PM sont des ressources du plan, pas des scores à maximiser.

Le produit travaille autour d'un maximum permanent de référence 12 PA / 6 PM selon les règles certifiées. Si l'utilisateur n'impose pas 6 PM et qu'un plan à 5 PM permet davantage de dégâts, le moteur cible doit pouvoir le préférer.

Le runtime courant traite encore ses champs PA/PM comme des minima de recherche. La future UI doit distinguer clairement valeur souhaitée/contrainte et permission d'Exo PA/PM.

## 7. FM — état courant vs contrat

### Runtime courant

`js/optimizer-v2-orchestrator.js` normalise encore la politique historique suivante :

- Exo PA : 0 ou +1 ;
- Exo PM : 0 ou +1 ;
- dommages sorts : toggle conduisant à `+3 % / slot` ;
- dommages critiques : `+8` lorsqu'autorisé.

Cette politique est **l'implémentation actuelle**, pas la cible validée.

### Contrat cible

Le moteur doit disposer d'un budget de 9 objets FM spéciaux, un bonus maximum par objet. Un Exo PA ou PM consomme l'emplacement spécial de l'objet qui le porte, laissant respectivement 8 ou 7 emplacements offensifs selon les exos utilisés.

Le domaine offensif cible est 1 % / 2 % dommages sorts, avec possibilité de +8 dommages critiques lorsque plus rentable et lorsque l'objet n'a pas déjà naturellement cette ligne, après certification des règles exactes.

Le moteur doit choisir cette distribution en fonction du plan combat ; l'interface ne doit pas obliger l'utilisateur à optimiser manuellement la FM.

## 8. Recherche — état courant

Le chemin courant combine :

- préfiltrage et espace de candidats ;
- architectures/panoplies ;
- recherche guidée par contraintes ;
- évaluations de build complet ;
- score combat/temporal ;
- mécanismes de complétude et de réparation destinés à empêcher les heuristiques de perdre tout build faisable.

Les heuristiques servent à réduire le coût de recherche. Elles ne doivent pas redéfinir la légalité ni rendre impossible un ensemble faisable.

## 9. Méthode d'extension du modèle

Pour étendre une mécanique Dofus :

1. prouver ce que la source dit réellement ;
2. préserver la donnée utile dans la normalisation ;
3. produire une interprétation structurée et traçable ;
4. définir la primitive runtime nécessaire ;
5. ajouter des tests de vérité mécanique ;
6. l'intégrer au planner et à l'état inter-tour ;
7. vérifier que la recherche d'équipement réagit au nouveau plan ;
8. seulement alors déclarer la mécanique supportée.

Ne pas contourner cette chaîne par un bonus de scoring ad hoc.
