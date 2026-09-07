# Connaissance et sémantique des sorts

## Pourquoi ce document existe

La qualité du produit dépend de la qualité du plan de combat. Un sort ne peut pas être traité comme une simple ligne de dégâts si ses effets modifient le tour courant, un tour futur, une cible, un état, une ressource, une charge ou une condition de lancer.

Le problème à résoudre n'est donc pas seulement « avoir les données Dofus », mais **transformer la donnée disponible en connaissance structurée, certifiée et exécutable**.

## Deux niveaux de vérité existants

### Runtime combat

`data/normalized/spell-data.json` contient la représentation que le moteur combat sait utiliser directement.

Elle alimente la sélection de sorts, les évaluateurs et le planner.

### Vérité source riche

`data/normalized/spell-source-truth.json` conserve une représentation plus riche issue des données source.

Le snapshot courant émet 836 entrées de sorts de classe. Les sémantiques non complètement certifiées restent `source-unresolved`; le fichier généré lui-même est la source de vérité pour les compteurs exacts de couverture à un SHA donné.

Les informations préservées peuvent inclure :

- identité et niveau ;
- coût PA et contraintes de ciblage/lancer ;
- effets et ordre ;
- triggers ;
- durées/délais ;
- masques et zones ;
- relations variantes/paires explicitement joignables ;
- références de scripts ;
- références d'états lorsqu'elles sont certifiables depuis la source.

## Règle fondamentale

`source-unresolved` signifie : **connu dans la source, pas encore compris de façon suffisante pour être actif**.

Une référence de script, un effet conditionnel ou un effet non immédiat ne doit jamais être interprété par intuition. La bonne réponse est de conserver la donnée et de marquer la limite.

> **Une mécanique inconnue n'est jamais équivalente à une mécanique inexistante.**

## Agent IA de compréhension — cible

Une étape offline d'analyse IA doit contrôler la banque de sorts et produire une proposition de sémantique structurée. Elle ne s'exécute pas à chaque optimisation et ne remplace pas le runtime déterministe.

Pipeline cible :

```text
source Dofus brute
  -> normalisation / conservation de la preuve
  -> agent IA de compréhension
  -> sémantique structurée + statut de confiance
  -> certification/tests
  -> primitives runtime
  -> planner
```

L'agent doit pouvoir conclure qu'il ne sait pas. Le statut `MECHANIC_UNRESOLVED` est un résultat valide et préférable à une invention.

### Sortie de certification cible

Pour chaque sort/mécanique, l'audit doit pouvoir exposer des champs conceptuels équivalents à :

- `SOURCE_COMPLETE`
- `AI_INTERPRETED`
- `MECHANICS_STRUCTURED`
- `RUNTIME_SUPPORTED`
- `HUMAN_REVIEW`
- `CONFIDENCE`
- `MECHANIC_UNRESOLVED`

Ces noms décrivent le **contrat de certification à construire** ; ils ne doivent pas être confondus avec des champs déjà présents dans le snapshot actuel tant qu'ils ne le sont pas.

La sémantique structurée doit couvrir, lorsque pertinent :

- coût et restrictions de lancer ;
- dégâts et critiques ;
- buffs/debuffs ;
- états ;
- charges/compteurs ;
- amélioration du prochain lancer ;
- cooldowns ;
- effets différés ;
- ordre des effets ;
- triggers ;
- ciblage et distance ;
- dépendances entre sorts ;
- dépendances au tour ;
- interactions avec passifs/Dofus ;
- toute autre primitive nécessaire pour reproduire le comportement certifié.

## Registre de mécaniques runtime

Les mécaniques explicitement comprises peuvent être représentées dans `js/combat/mechanics/` et reliées au planner via le registre combat.

Une mécanique activée doit avoir :

1. une preuve source traçable ;
2. une règle déterministe clairement définie ;
3. un test de mécanique ;
4. un test de transition d'état si elle traverse les tours ;
5. un test de plan/rotation si elle change l'ordre optimal ;
6. idéalement un test d'acceptation reliant le plan au choix d'équipement.

Une sortie IA seule ne satisfait pas ces conditions.

## Audit P0 après nettoyage

Auditer **100 % de la banque de sorts** avec une matrice :

```text
information disponible dans la source
  -> information préservée par la normalisation
  -> information interprétée
  -> information supportée par le runtime
  -> information consommée par le planner
  -> impact réel sur le tour cible
```

Le rapport global doit pouvoir donner au minimum :

- `SPELLS_TOTAL`
- `FULLY_INTERPRETED`
- `RUNTIME_SUPPORTED`
- `UNRESOLVED`
- `NEED_HUMAN_REVIEW`

Pour chaque entrée non couverte, classer la cause :

- effet source non mappé ;
- trigger/délai ;
- état ;
- script ;
- ciblage/zone ;
- variation conditionnelle/aléatoire ;
- relation inter-sort ;
- mécanique de passif/Dofus ;
- primitive d'état inter-tour absente ;
- autre primitive absente du moteur.

## Ordre de certification produit

Commencer par **Iop Terre / T1** comme scénario représentatif, puis étendre par familles sémantiques plutôt que par hacks de sorts isolés.

Ensuite certifier la préparation T2 puis T3 : buffs, Accumulation/Fureur ou équivalents, critiques déclenchant des mécaniques comme Turquoise, bonus finaux et autres états transportés jusqu'au tour cible.

Les noms de rotations servent d'exemples d'acceptation ; le moteur doit les redécouvrir à partir de la vérité du jeu, jamais les reconnaître en dur.

## Critère de qualité

L'objectif n'est pas de faire passer artificiellement 100 % des sorts en `runtime-supported`. L'objectif est que chaque activation corresponde à une sémantique réellement comprise, traçable et testée.

La couverture augmente quand le moteur devient plus juste, pas quand le garde-fou devient plus permissif.
