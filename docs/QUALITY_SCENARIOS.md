# Campagne qualité — scénarios canoniques

Ce document définit la matrice de validation produit utilisée après la fermeture moteur #120 et la fermeture visuelle #127.

Objectif : détecter les pertes de qualité **réelles** de l'Optimiseur Equipment-Only sans transformer chaque doute en retuning arbitraire.

La campagne se joue sur le **catalogue réel Steam Machine**. Elle doit permettre de répondre à quatre questions :

1. le moteur retourne-t-il un résultat lorsqu'un témoin faisable existe ?
2. le meilleur résultat visible est-il réellement compétitif sous l'objectif demandé ?
3. les 5 résultats affichés sont-ils utiles et distincts ?
4. Crit / Sans crit / FM / Dofus / compagnon / contraintes restent-ils sémantiquement cohérents ?

## Règles de campagne

Avant tout correctif :

- capturer le résultat actuel ;
- identifier le **premier étage où un meilleur témoin disparaît** ;
- ne pas modifier plusieurs étages de recherche à la fois ;
- ne pas résoudre une perte par augmentation opaque du beam ;
- ne pas hardcoder un nom d'item pour récupérer un témoin ;
- ne pas modifier le scoring final pour cacher une perte de complétude ;
- conserver `evaluateCompleteEquipmentBuild()` comme autorité finale.

Invariant permanent :

> **FEASIBLE SET NON-EMPTY ⇒ SEARCH MUST RETURN A RESULT**

## Capture minimale par scénario

Pour chaque run, enregistrer au minimum :

- nombre de résultats finaux ;
- route moteur (`mono` / combined native) ;
- score théorique primaire ;
- moyenne / scores élémentaires lorsque plusieurs axes existent ;
- PA / PM finaux ;
- Crit / Do Crit ;
- compagnon ;
- bouclier ;
- six Dofus/trophées ;
- liste des 16 items ;
- FM structurelles et offensives ;
- temps d'exécution ;
- identité des 5 stuffs affichés et différence réelle entre eux.

Aucun nom d'item observé ne devient automatiquement une règle produit.

## Matrice principale

| ID | Éléments | Type dégâts | Critiques | FM | PA/PM | But |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 | Terre | Petites lignes | Auto | Oui | 12/6 | contrôle mono petites lignes / dégâts fixes |
| Q2 | Feu | Grosses lignes | Crit | Oui | 12/6 | contrôle mono grosses lignes / stats + crit |
| Q3 | Eau | Mixte | Sans crit | Oui | 12/6 | contrôle mono sans-crit |
| Q4 | Feu + Eau | Petites lignes | Auto | Oui | 12/6 | baseline combined petites lignes |
| Q5 | Feu + Eau | Grosses lignes | Auto | Oui | 12/6 | baseline combined grosses lignes |
| Q6 | Terre + Feu + Air | Mixte | Auto | Oui | 12/6 | contrôle tri-élément équilibré |
| Q7 | Multi | Grosses lignes | Auto | Oui | 12/6 | baseline quatre axes équilibrés |
| Q8 | Multi | Grosses lignes | Sans crit | Oui | 12/6 | cohérence Multi sans-crit |
| Q9 | témoin dérivé d'un run précédent | même profil que le témoin | identique | identique | identique | invariant contraintes / faisabilité |
| Q10 | build issu de Q4 ou Q7 | Atelier → Trouver mieux | — | — | — | round-trip Atelier / verrouillage / rejet |

## Q1 — Mono Terre / Petites lignes / Auto

But : vérifier que le chemin mono valorise correctement les petites lignes sans tomber dans un build uniquement « grosse stat ».

Attendus :

- résultat légal ;
- PA >= 12, PM >= 6 ;
- présence cohérente de dégâts fixes/élémentaires dans les builds compétitifs ;
- Crit/Do Crit peuvent être retenus si leur espérance finale est supérieure ;
- jusqu'à 5 résultats réellement différents si le catalogue le permet.

Le scénario sert aussi de source possible pour le témoin Q9.

## Q2 — Mono Feu / Grosses lignes / Crit

But : vérifier la pression caractéristiques + Puissance + branche critique sur un profil grosses lignes.

Attendus :

- pas de cible critique hardcodée ;
- la probabilité critique effective suit la formule synthétique canonique ;
- Turquoise ou un compagnon crit ne sont légitimes que si le score final le justifie ;
- aucun item n'est favorisé par son nom.

## Q3 — Mono Eau / Mixte / Sans crit

But : verrouiller la sémantique Sans crit.

Attendus :

- Crit et Do Crit ne participent pas à l'objectif offensif ;
- aucun Dofus/trophée/compagnon ne gagne **uniquement** grâce à Crit ou Do Crit ;
- le moteur doit encore trouver un résultat si le catalogue contient une solution faisable.

## Q4 — Feu + Eau / Petites lignes / Auto

Baseline historique #120 :

- `FM Oui`, PA >= 12, PM >= 6 ;
- meilleur score certifié : **3895.335**.

Cette valeur est un témoin de non-régression, pas une constante à coder.

But : vérifier que les deux axes restent réellement optimisés et qu'un build mono déguisé ne gagne pas par moyenne.

Attendus :

- route combined native ;
- minimum Feu/Eau compétitif ;
- aucun axe sacrifié pour gonfler l'autre ;
- score courant à comparer à la baseline et aux témoins Atelier.

## Q5 — Feu + Eau / Grosses lignes / Auto

Baseline historique #120 : **3008.88** sur le meilleur résultat certifié.

But : même contrôle que Q4, mais avec pression plus forte sur caractéristiques/Puissance.

Toute baisse notable doit être diagnostiquée avant d'être acceptée comme simple variation catalogue.

## Q6 — Terre + Feu + Air / Mixte / Auto

But : couvrir le chemin 3 éléments explicites sans utiliser le raccourci `multi`.

Attendus :

- trois axes indépendants ;
- minimum des trois comme critère primaire ;
- bonus panoplies calculés avant rejet de l'architecture ;
- aucune lignée set intéressante supprimée seulement parce qu'une pièce isolée est faible.

## Q7 — Multi / Grosses lignes / Auto

Baseline historique #120 : quatre axes du meilleur témoin autour de :

`1391.11 / 1391.11 / 1391.11 / 1391.52`

But : contrôle principal du moteur combined.

Attendus :

- quatre axes Terre / Feu / Eau / Air ;
- primary = minimum des quatre ;
- aucun élément fort ne compense trois axes faibles ;
- Dofus/compagnon fermés dans le contexte réel ;
- build légal 12/6 ;
- le package final doit pouvoir inclure des pièces ressources si elles débloquent un meilleur contexte offensif.

## Q8 — Multi / Grosses lignes / Sans crit

But : combiner le chemin le plus complexe avec la sémantique Sans crit.

Attendus :

- aucun avantage objectif Crit/Do Crit ;
- pas de Turquoise retenu uniquement pour Crit ;
- quatre axes équilibrés ;
- résultat non vide lorsqu'un témoin faisable existe.

Ce scénario est prioritaire si une future régression renvoie `0 résultat`.

## Q9 — Témoin de contrainte dérivé

Q9 ne fixe pas arbitrairement une valeur d'Initiative qui pourrait devenir infaisable.

Procédure :

1. prendre un scénario réussi, de préférence Q1 ;
2. parmi les résultats réellement retournés, choisir un build témoin ;
3. relever son Initiative finale ;
4. relancer exactement la même recherche avec `Initiative minimum = initiative du témoin` ;
5. le témoin prouve mécaniquement que l'ensemble faisable est non vide.

Attendu absolu : **la recherche doit retourner au moins un résultat**.

Si elle retourne zéro, on a une violation directe de l'invariant de complétude, sans débat de scoring.

La même méthode peut ensuite être répétée avec une autre contrainte dure supportée si nécessaire.

## Q10 — Atelier comme contre-exemple contrôlé

Prendre le meilleur build de Q4 ou Q7 puis :

1. `Ouvrir dans l'Atelier` ;
2. vérifier les 16 slots et les stats live ;
3. verrouiller deux items ;
4. rejeter/remplacer un troisième item ;
5. lancer `Trouver mieux` ;
6. vérifier que les items verrouillés restent imposés ;
7. vérifier que l'item rejeté n'est pas réintroduit dans la complétion suivante ;
8. vérifier que la classe Atelier éventuelle n'est pas injectée dans la requête Equipment-Only ;
9. comparer le résultat final avec le build source via l'évaluateur autoritatif.

Ce scénario sert à fabriquer un **witness produit** lorsqu'un utilisateur pense qu'un meilleur build existe : on ne retouche pas le moteur tant que ce témoin n'est pas démontré légalement.

## Critères de diversité des 5 résultats

Les cinq cartes ne sont pas un Top N arbitraire. Elles doivent apporter des alternatives réellement utiles.

Une différence peut être pertinente si elle change par exemple :

- architecture de panoplies ;
- compagnon ;
- bouclier ;
- package Dofus/trophées ;
- distribution Crit / puissance / dégâts fixes ;
- réponse à une contrainte secondaire.

Changer un item marginal sans différence de profil ne suffit pas nécessairement à justifier une carte supplémentaire.

La diversité ne doit jamais remettre un candidat inférieur devant le meilleur score final.

## Classification d'un échec

Avant toute correction, classer le problème :

### A — Feasibility loss

Un témoin légal respecte toutes les contraintes, mais la recherche retourne zéro ou ne peut jamais l'atteindre.

Action : trouver le premier étage où le témoin disparaît.

### B — Quality loss

Le moteur retourne des builds, mais un témoin légal obtient un meilleur score final autoritatif.

Action : comparer la lignée du témoin et du winner, puis identifier le premier trim destructif.

### C — Semantic mismatch

Exemples : Sans crit choisit un package pour Crit, Multi sacrifie trois axes, FM appliquée à un Dofus.

Action : corriger la modélisation ou la propagation du contexte, pas un poids local.

### D — Diversity/display only

Le meilleur build est correct mais les cinq cartes sont redondantes ou la vue masque une information.

Action : corriger le selector de diversité ou la présentation sans toucher au moteur de qualité.

### E — Performance only

Résultat correct mais runtime excessif.

Action : optimiser seulement après avoir verrouillé que les mêmes architectures importantes survivent.

## Ordre de campagne recommandé

Pour éviter de saturer le runner :

1. Q1 ;
2. Q3 ;
3. Q4 ;
4. Q5 ;
5. Q7 ;
6. Q8 ;
7. Q6 ;
8. Q9 dérivé ;
9. Q10 seulement après avoir un build source intéressant.

On ne lance pas tous les scénarios à chaque PR. On exécute uniquement ceux dont le comportement peut être affecté par les fichiers modifiés.
