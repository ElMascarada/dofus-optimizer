# Connaissance et sémantique des sorts

## Pourquoi ce document existe

La qualité du produit dépend de la qualité du plan de combat. Un sort ne peut donc pas être traité comme une simple ligne de dégâts si ses effets modifient le tour, le prochain tour, une cible, un état, une ressource ou une condition de lancer.

## Deux niveaux de vérité

### Runtime combat

`data/normalized/spell-data.json` contient la représentation que le moteur combat sait utiliser directement.

Elle alimente la sélection de sorts, les évaluateurs et le planner.

### Vérité source riche

`data/normalized/spell-source-truth.json` conserve une représentation beaucoup plus riche issue des données source.

Le snapshot courant contient 836 entrées de sorts de classe émises ; elles sont actuellement marquées `source-unresolved` lorsque la sémantique complète n'est pas certifiée par le moteur. Le fichier généré lui-même est la source de vérité pour les compteurs exacts de couverture.

Les informations conservées peuvent inclure :

- identité et niveau ;
- coût PA et contraintes de ciblage/lancer ;
- effets et ordre ;
- triggers ;
- durées/délais ;
- masques et zones ;
- relations variantes/paires explicitement joignables ;
- références de scripts ;
- références d'états lorsqu'elles sont certifiables depuis la source.

## Règle d'activation

`source-unresolved` signifie : **connu dans la source, pas encore compris de façon suffisante pour être actif**.

Une référence de script ou un effet non immédiat ne doit jamais être interprété par intuition. La bonne réponse est de conserver la donnée et de marquer la limite.

## Registre de mécaniques

Les mécaniques explicitement comprises peuvent être représentées dans `js/combat/mechanics/` et reliées au planner via le registre combat.

Une mécanique de classe doit avoir :

1. une preuve source ;
2. une règle déterministe clairement définie ;
3. un test de mécanique ;
4. un test de plan/rotation si elle change l'ordre optimal ;
5. idéalement un test d'acceptation reliant le plan au choix d'équipement.

## Audit P0 à réaliser après le nettoyage

Produire une matrice de couverture par sort/mécanique :

```text
information disponible dans la source
  -> information préservée par la normalisation
  -> information comprise par le runtime
  -> information consommée par le planner
  -> impact sur le score / la recherche de stuff
```

Commencer par Iop Terre / T1, puis généraliser par familles sémantiques plutôt que par hacks de sorts isolés.

Pour chaque entrée non couverte, classer la cause :

- effet source non mappé ;
- trigger/délai ;
- état ;
- script ;
- ciblage/zone ;
- variation conditionnelle/aléatoire ;
- relation inter-sort ;
- autre primitive absente du moteur.

## Critère de qualité

L'objectif n'est pas de faire passer 100 % des sorts en `runtime-supported` artificiellement. L'objectif est que chaque activation corresponde à une sémantique réellement comprise et testée.

La couverture augmente quand le moteur devient plus juste, pas quand le garde-fou devient plus permissif.
