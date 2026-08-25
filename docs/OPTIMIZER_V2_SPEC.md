# Dofus Optimizer V2 — Spécification produit

## Statut

Cette spécification décrit la cible V2. Elle ne constitue pas l'autorisation de développer l'Atelier dans la PR de fondation.

## Navigation principale

Dofus Optimizer V2 possède deux onglets de premier niveau :

1. **Atelier**
2. **Optimiseur**

Les deux onglets utilisent le même catalogue d'équipements, le même moteur de statistiques, le même moteur de combat et la même mémoire locale. Aucun calcul métier ne doit être dupliqué dans l'UI.

## Atelier

L'Atelier est un éditeur manuel de stuff destiné à construire, inspecter et améliorer un build existant.

Fonctions cibles :

- création et modification manuelle d'un stuff complet ;
- sauvegarde locale persistante ;
- recherche intelligente d'items par nom, type, stats et compatibilité avec le build ;
- statistiques du build recalculées en temps réel ;
- dégâts exacts par sort à partir du même moteur que l'Optimiseur ;
- calcul du meilleur **T1**, **T2**, **T3** et d'une rotation **constante** ;
- bouton **Trouver mieux** qui utilise le build courant comme seed de recherche ;
- possibilité de reprendre un résultat de l'Optimiseur dans l'Atelier sans conversion destructive.

L'Atelier n'est pas développé dans la PR de fondation.

## Optimiseur

Le parcours principal est :

**Classe → Élément → Contraintes → Objectif temporel**

### Classe

La classe détermine le catalogue de sorts et le registre de mécaniques déclaratives disponibles. Le moteur de combat générique ne reçoit pas de branche conditionnelle par nom de classe.

### Élément

Le joueur choisit Terre, Feu, Eau, Air ou Multi. Ce choix influence la sélection des sorts et le préfiltrage des candidats, sans supprimer les pièces nécessaires aux contraintes.

### Contraintes

Les contraintes sont des règles dures du build, notamment PA, PM, PO, Vitalité et résistances. Elles doivent influencer la conservation des candidats **avant** le solveur final afin qu'une pièce défensive ou structurelle utile ne soit pas éliminée uniquement parce qu'elle est moins offensive.

### Objectif temporel

L'utilisateur peut optimiser T1, T2, T3, T1–T3, moyenne, pire tour ou les objectifs temporels ajoutés ensuite. Le calcul de rotation et le calcul d'équipement restent deux responsabilités séparées.

## Résultats interactifs

Chaque résultat permet :

- **Lock item** : conserver une pièce comme contrainte stricte puis réoptimiser le reste ;
- **Reject item** : exclure une pièce puis réoptimiser ;
- ouverture dans l'Atelier ;
- relance proche à partir du résultat comme seed.

Lock et Reject doivent être des données de requête explicites. Ils ne doivent pas être injectés en interceptant globalement `window.Worker` ni en réparant le DOM après rendu.

## Mémoire locale

La V2 utilise **IndexedDB** comme stockage persistant pour :

- builds Atelier ;
- requêtes normalisées ;
- résultats calculés ;
- métadonnées de compatibilité/version ;
- seeds de recherches proches ;
- préférences nécessaires à la reprise locale.

`localStorage` peut rester réservé à de petits flags de migration ou préférences triviales, mais ne doit plus porter le cache principal de recherche.

## Réutilisation des recherches

Une requête déjà calculée et toujours compatible avec la version des données/moteurs doit être réutilisée immédiatement.

La clé d'une recherche doit dépendre explicitement de :

- version/epoch de calcul ;
- version du snapshot Dofus ;
- classe et sorts/mécaniques disponibles ;
- élément ;
- contraintes ;
- objectif temporel ;
- politique FM ;
- contexte de combat ;
- items lock/reject ;
- paramètres qui influencent réellement le résultat.

## Recherche proche

Une nouvelle recherche proche d'une requête connue réutilise les meilleurs résultats connus comme **seeds**. Le cache n'est donc pas seulement un raccourci exact : il devient une mémoire de bons points de départ.

La proximité est déterminée sur la requête normalisée, pas sur la ressemblance textuelle du formulaire.

## Recherche hybride

La stratégie cible combine trois sources de candidats :

1. **Seeds** : builds déjà connus et pertinents ;
2. **Cores de panoplies** : architectures de sets prometteuses ;
3. **Recherche libre** : exploration hors seeds/panoplies pour éviter l'enfermement dans les solutions connues.

La fusion de ces voies doit préserver les contraintes dures et produire des candidats évalués par une seule fonction finale de vérité.

## Invariants produit

- Un build affiché respecte toutes les contraintes demandées.
- Les dégâts affichés proviennent du moteur de combat canonique.
- Une recherche identique donne le même résultat à politique de recherche identique.
- Arrêter une recherche doit finaliser proprement les meilleurs candidats déjà disponibles lorsque cela est possible.
- La mémoire locale ne doit jamais rendre un résultat incompatible avec la version courante des données ou du moteur.
