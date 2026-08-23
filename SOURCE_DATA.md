# Données source

## Source primaire

Le projet utilise Dofusdude (`dofus3`, langue `fr`) comme source de synchronisation des données de jeu.

Endpoints synchronisés hors navigateur :

- `/dofus3/v1/fr/items/equipment?page[size]=-1&fields[item]=effects,conditions,is_weapon,parent_set`
- `/dofus3/v1/fr/sets?page[size]=-1&fields[set]=effects,equipment_ids`
- `/dofus3/v1/fr/mounts?page[size]=-1&fields[mount]=effects`
- `/dofus3/v1/meta/elements`
- `/dofus3/v1/meta/version`

Le navigateur ne charge jamais les endpoints `/all` ni la base brute. La synchronisation est une opération de build/maintenance.

## Périmètre V0.2

Le snapshot normalisé conserve :

- tous les équipements de niveau 200 dont le slot est compris ;
- tous les Dofus et trophées compris, même sous le niveau 200 ;
- tous les familiers/montiliers compris ;
- toutes les montures exposées par Dofusdude ;
- les panoplies utilisées par ces équipements.

Les jets d'équipement sont normalisés au **maximum du jet naturel** (`int_maximum`) pour comparer les stuffs à qualité égale. Les résistances fixes et les résistances en pourcentage sont des statistiques distinctes.

## Certification

Le solveur ne doit jamais deviner silencieusement une donnée de jeu.

Chaque effet passe dans l'un des états :

- `mapped` : statistique passive comprise et normalisée ;
- `active` : effet actif (par exemple dégâts d'arme), conservé comme source mais pas ajouté aux stats passives ;
- `meta` : effet synthétique Dofusdude, non certifié tant qu'il n'est pas explicitement pris en charge ;
- `unmapped` : effet inconnu ou non numérique.

Les conditions d'équipement suivent le même principe : arbre `and/or`, opérateur et élément doivent être compris. Une condition inconnue rend l'item non certifié.

`scripts/normalize-dofusdude.mjs` produit :

- `data/normalized/dofus-data.json` : uniquement les items certifiés utilisables par l'application ;
- `data/normalized/coverage-report.json` : rapport machine ;
- `data/normalized/coverage-report.md` : rapport lisible avec les effets/conditions encore inconnus.

Aucun nouvel effet inconnu ne doit être transformé automatiquement en statistique par heuristique.
