# État courant du projet

Ce document décrit l'état **réel aujourd'hui** et les écarts connus avec le contrat produit. Pour l'historique, utiliser Git et les PR mergées.

## Produit

Dofus Optimizer est un optimiseur de **plan de combat**. Le tour offensif ciblé est l'objectif ; le stuff, les statistiques et les ressources sont les variables permettant de rendre ce plan légal et meilleur.

La version runtime est définie uniquement dans `js/runtime-meta.js`.

## Runtime actif

- UI principale : `index.html`
- Optimiseur : `js/optimizer-v2-app.js`
- Worker : `js/optimizer-worker.js`
- Génération d'architectures : `js/architecture-search-v2.js`
- Recherche de candidats : `optimizer/candidate-search.js`
- Atelier : `js/workshop/`
- Primitives Search Memory : `js/search-memory/` ; le repository produit par défaut est actuellement inerté
- PWA/offline : `service-worker.js`

Voir `docs/ARCHITECTURE_CURRENT.md` pour la carte détaillée.

## Contrats actuellement protégés

1. Un build rendu doit être légal.
2. Les minima demandés sont des contraintes dures, pas des préférences de score.
3. Si l'ensemble faisable est non vide, la recherche doit pouvoir produire un résultat faisable.
4. Le score combat vient d'un plan de sorts jouable pour le mode temporel réellement pris en charge.
5. La donnée Dofus inconnue n'est pas devinée.
6. Une sémantique de sort riche non comprise reste explicitement non résolue au lieu d'être silencieusement réduite à du dégât.

## Écarts connus avec le contrat produit

Le contrat canonique demandé est plus ambitieux que le runtime courant. Ces écarts sont **des travaux futurs, pas des fonctionnalités déjà présentes** :

- **Connaissance des sorts** : la vérité source riche est importée mais sa couverture d'interprétation runtime reste très incomplète. `spell-source-truth.json` conserve les sémantiques non certifiées en `source-unresolved`.
- **Horizon T3** : le helper temporel courant simule explicitement T1→T2 pour un objectif T2, mais l'objectif T3 ne simule pas encore T1 et T2 comme tours de préparation. Le contrat cible exige T1→T2→T3 avec score uniquement sur T3.
- **FM** : le runtime courant expose encore une politique historique `+3 % dommages sorts / slot`, `+8 dommages critiques`, Exo PA/PM. Elle ne correspond pas encore au contrat cible de budget de 9 objets FM avec arbitrage 1 % / 2 % dommages sorts, +8 do crit sous condition de ligne native, et coût d'opportunité des exos.
- **Interface** : l'UI courante utilise encore des champs permanents de contraintes et des sélecteurs FM séparés. La cible validée est `PA/PM + autorisation exo`, contraintes ajoutées par menu, puis bloc FM Oui/Non.
- **Scénario combat complet** : plusieurs mécaniques de buffs, états, charges, critiques, Dofus/passifs et interactions inter-tours restent à certifier avant de prétendre à un planner exhaustif.

## Priorité produit après nettoyage

Première revue sémantique Terre : `data/knowledge/iop-terre-source-semantics.json` classe uniquement Pression (13106) et Concentration (13123), hors runtime. Chacun conserve quatre occurrences d'effets et un script non résolus, sans référence d'état explicite. Le calcul isolé des six lignes Terre normales/critiques est démontré, mais ne certifie pas leur applicabilité aux cibles. Restent non certifiés : masques/zones, érosion de Pression et scripts liés 16115/16118 sans métadonnées. Les deux sorts restent exclus du planner certifié ; aucun comportement runtime n'est modifié. Les assertions déterministes remplacent le diagnostic temporaire.

P0 : **Spell Knowledge Certification**.

1. auditer 100 % de la banque de sorts et les informations réellement disponibles en source ;
2. enrichir offline la connaissance avec une interprétation structurée, assistée par IA, sans activation automatique ;
3. classer explicitement les mécaniques résolues/non résolues ;
4. étendre les primitives runtime et tests par familles sémantiques ;
5. certifier d'abord un T1 représentatif (Iop Terre), puis la préparation T2, puis la préparation T3 ;
6. seulement ensuite juger/optimiser plus agressivement la recherche d'équipement autour de ces plans.

Iop Terre / T1 sert de premier scénario représentatif. Une séquence telle que `Colère de Iop + Fureur + Concentration` doit être redécouverte par le moteur lorsqu'elle est réellement optimale ; elle ne doit jamais être codée en dur.

## Maintenance

Les gates permanents sont :

- tests/syntaxe Node ;
- recette navigateur réelle ;
- product smoke ;
- benchmarks de régression des chemins principaux.

Les données et icônes ont une seule chaîne de synchronisation canonique : `.github/workflows/sync-dofus-data.yml`.

Les tests des snapshots synchronisés vérifient le schéma source enrichi v2 et ses jointures de métadonnées, sans assimiler une jointure à une certification sémantique. La séparation source/runtime est protégée par une vérification de non-mutation du catalogue courant ; le snapshot runtime publié est déjà passé par `apply:curated`, dont la réapplication doit être idempotente.

Aucun nouveau travail produit ne doit repartir d'un ancien checkpoint documentaire ou d'une branche historique : repartir de `main`, du code courant et de cette documentation canonique.
