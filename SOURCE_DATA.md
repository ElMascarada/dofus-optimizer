# Données source

## Source primaire

Le projet utilise Dofusdude (`dofus3`, langue `fr`) comme source de synchronisation des données de jeu.

Endpoints synchronisés hors navigateur pour l'équipement :

- `/dofus3/v1/fr/items/equipment?page[size]=-1&fields[item]=effects,conditions,is_weapon,parent_set`
- `/dofus3/v1/fr/sets?page[size]=-1&fields[set]=effects,equipment_ids`
- `/dofus3/v1/fr/mounts?page[size]=-1&fields[mount]=effects`
- `/dofus3/v1/meta/elements`
- `/dofus3/v1/meta/version`

Pour les sorts, le pipeline lit le numéro de version renvoyé par `/meta/version`, puis télécharge dans la **release GitHub Dofusdude exactement correspondante**. La snapshot actuellement épinglée est Dofus `3.6.10.11` et conserve notamment :

- `spells.json`
- `spell_levels.json`
- `spell_variants.json`
- `spell_pairs.json`
- `spell_scripts.json`
- `spell_states.json`
- `spell_types.json`
- `breeds.json`
- `effects.json`
- `fr.json`

Ainsi, équipements et sorts ne peuvent pas provenir silencieusement de deux versions différentes du jeu.

Le navigateur ne charge jamais les endpoints `/all` ni la base brute. La synchronisation est une opération de build/maintenance ; seules les données normalisées sont publiées.

## Deux catalogues de sorts, deux responsabilités

Le principe est **IMPORTER != ACTIVER**.

`data/normalized/spell-data.json` reste le **catalogue combat runtime**. Il contient seulement les dégâts immédiats et effets déterministes déjà certifiés par le moteur. Search, Workshop, planner et calcul de dégâts continuent de consommer cette vérité runtime ; la fondation source-truth ne modifie pas ce chemin.

`data/normalized/spell-source-truth.json` est un **catalogue documentaire de vérité source** produit par `scripts/normalize-spell-source-truth.mjs`. Il conserve, pour les sorts de classe pertinents au niveau 200, les identités et ordres d'effets, triggers, durées, délais, masques/ciblage, relations variantes/paires explicitement joignables, références de scripts liées au sort et références d'états explicitement nommées dans la source.

Le catalogue source-truth n'est consommé par aucun chemin de combat. Une information peut y être correctement importée tout en restant volontairement inactive.

Chaque entrée expose `semanticStatus` :

- `runtime-supported` : la forme sémantique source sélectionnée est entièrement représentée par le catalogue combat existant ;
- `source-unresolved` : la donnée riche est préservée mais une partie de sa sémantique n'est pas certifiée par le runtime et reste inactive.

Un script lié, un trigger non immédiat, un délai, une relation d'état non certifiée ou tout autre mécanisme non compris ne doit jamais être interprété par ressemblance. La référence est conservée et l'entrée reste `source-unresolved`.

Les références `boundScriptUsageData.scriptId` de `spells.json` sont préservées telles quelles. La snapshot contient aussi `spell_scripts.json`, mais aucun join numérique direct vers ce dataset autonome n'est certifié dans cette tranche : `standaloneScriptMetadataJoin` reste donc explicitement `source-unresolved` au lieu d'inventer une correspondance.

## Périmètre équipement

Le snapshot normalisé conserve :

- les équipements niveau 190–200 dont le slot est compris ;
- tous les Dofus et trophées compris, même sous le niveau 200 ;
- tous les familiers/montiliers compris ;
- toutes les montures exposées par Dofusdude ;
- les panoplies utilisées par ces équipements.

Les jets d'équipement sont normalisés au **maximum du jet naturel** (`int_maximum`) pour comparer les stuffs à qualité égale. Les résistances fixes et les résistances en pourcentage sont des statistiques distinctes.

## Périmètre sorts V0.10

Le catalogue de sorts certifié conserve uniquement les sorts de classe offensifs que le moteur sait calculer sans approximation :

- niveau de sort le plus élevé disponible à un personnage niveau 200 ;
- coût PA, taux critique, portée et limites de lancer ;
- dégâts directs immédiats Terre, Feu, Eau, Air ou Neutre ;
- vols de vie de ces éléments pour leur composante dégâts ;
- jets normaux et critiques appariés strictement.

Les familles d'effets élémentaires sont auditées contre `effects.json` et leurs libellés français avant normalisation. Les dégâts « meilleur élément », différés, déclenchés ou conditionnels sont exclus du catalogue plutôt que transformés par heuristique.

`scripts/normalize-spells.mjs` produit :

- `data/normalized/spell-data.json` : classes et sorts offensifs certifiés ;
- `data/normalized/spell-coverage-report.json` : couverture machine ;
- `data/normalized/spell-coverage-report.md` : couverture lisible et raisons d'exclusion.

`scripts/normalize-spell-source-truth.mjs` produit séparément :

- `data/normalized/spell-source-truth.json` : vérité source riche, documentaire et inactive par défaut lorsque la sémantique complète n'est pas certifiée.

## Certification équipement

Le solveur ne doit jamais deviner silencieusement une donnée de jeu.

Chaque effet d'équipement passe dans l'un des états :

- `mapped` : statistique passive comprise et normalisée ;
- `active` : effet actif (par exemple dégâts d'arme), conservé comme source mais pas ajouté aux stats passives ;
- `meta` : effet synthétique Dofusdude, non certifié tant qu'il n'est pas explicitement pris en charge ;
- `unmapped` : effet inconnu ou non numérique.

Les conditions d'équipement suivent le même principe : arbre `and/or`, opérateur et élément doivent être compris. Une condition inconnue rend l'item non certifié.

`scripts/normalize-dofusdude.mjs` produit :

- `data/normalized/dofus-data.json` : uniquement les items certifiés utilisables par l'application ;
- `data/normalized/coverage-report.json` : rapport machine ;
- `data/normalized/coverage-report.md` : rapport lisible avec les effets/conditions encore inconnus.

Aucun nouvel effet inconnu ne doit être transformé automatiquement en statistique ou dégât par heuristique.
