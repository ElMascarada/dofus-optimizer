# Données source

## Source primaire

Le projet utilise Dofusdude (`dofus3`, langue `fr`) comme source de synchronisation des données de jeu.

Endpoints synchronisés hors navigateur pour l'équipement :

- `/dofus3/v1/fr/items/equipment?page[size]=-1&fields[item]=effects,conditions,is_weapon,parent_set`
- `/dofus3/v1/fr/sets?page[size]=-1&fields[set]=effects,equipment_ids`
- `/dofus3/v1/fr/mounts?page[size]=-1&fields[mount]=effects`
- `/dofus3/v1/meta/elements`
- `/dofus3/v1/meta/version`

Pour les sorts, le pipeline lit le numéro de version renvoyé par `/meta/version`, puis télécharge dans la **release GitHub Dofusdude exactement correspondante** :

- `spells.json`
- `spell_levels.json`
- `spell_variants.json`
- `breeds.json`
- `effects.json`
- `fr.json`
- `spell_pairs.json`
- `spell_scripts.json`
- `spell_states.json`
- `spell_types.json`

Tous ces assets de sorts proviennent donc de la même version Dofusdude et de la même version du jeu. Ils ne sont jamais assemblés depuis plusieurs releases.

Le navigateur ne charge jamais les endpoints `/all` ni la base brute. La synchronisation est une opération de build/maintenance ; seules les données normalisées sont publiées.

## Périmètre équipement

Le snapshot normalisé conserve :

- les équipements niveau 190–200 dont le slot est compris ;
- tous les Dofus et trophées compris, même sous le niveau 200 ;
- tous les familiers/montiliers compris ;
- toutes les montures exposées par Dofusdude ;
- les panoplies utilisées par ces équipements.

Les jets d'équipement sont normalisés au **maximum du jet naturel** (`int_maximum`) pour comparer les stuffs à qualité égale. Les résistances fixes et les résistances en pourcentage sont des statistiques distinctes.

## Sorts : SOURCE TRUTH vs RUNTIME COMBAT CATALOG

Le pipeline sorts maintient désormais deux artefacts aux responsabilités différentes.

### SOURCE TRUTH

`data/normalized/spell-source-truth.json` est un catalogue d'inspection, d'audit et de future interprétation sémantique. Il conserve, lorsque la source les expose, l'identité et les niveaux des sorts, leurs textes FR, paramètres de lancer, instances d'effets normales et critiques, métadonnées brutes utiles, relations de sorts/états et références vers `spell_pairs`, `spell_scripts`, `spell_states` et `spell_types`.

Chaque instance d'effet reçoit un statut sémantique :

- `known-runtime` : la mécanique individuelle est déjà comprise par le runtime actuel ;
- `structural` : une relation structurelle explicite est conservée mais n'est pas exécutée comme mécanique de combat ;
- `unresolved` : la donnée existe dans la source mais le moteur ne sait pas encore comment la jouer.

Un effet `unresolved` reste une donnée. Il ne devient ni bonus, ni malus, ni dommage, ni déclencheur actif par défaut. Aucun script, trigger ou texte descriptif n'est interprété silencieusement pour inventer une sémantique de combat.

`scripts/normalize-spells.mjs` produit également :

- `data/normalized/spell-source-truth-coverage.json` : couverture machine de la vérité source ;
- `data/normalized/spell-source-truth-coverage.md` : couverture lisible, incluant les compteurs d'effets et la distinction `ABSENT_FROM_SOURCE` / `PRESENT_BUT_UNRESOLVED`.

### RUNTIME COMBAT CATALOG

`data/normalized/spell-data.json` reste le catalogue combat certifié actuel. Le runtime continue de ne consommer que les mécaniques explicitement supportées et ne lit pas automatiquement `spell-source-truth.json`.

Le contrat est donc : **IMPORTER != ACTIVER**. Enrichir la vérité source ne change pas, à lui seul, le comportement du combat.

## Périmètre sorts V0.10

Le catalogue de sorts combat certifié conserve uniquement les sorts de classe offensifs que le moteur sait calculer sans approximation :

- niveau de sort le plus élevé disponible à un personnage niveau 200 ;
- coût PA, taux critique, portée et limites de lancer ;
- dégâts directs immédiats Terre, Feu, Eau, Air ou Neutre ;
- vols de vie de ces éléments pour leur composante dégâts ;
- jets normaux et critiques appariés strictement.

Les familles d'effets élémentaires sont auditées contre `effects.json` et leurs libellés français avant normalisation. Les dégâts « meilleur élément », différés, déclenchés ou conditionnels sont exclus du catalogue combat plutôt que transformés par heuristique.

`scripts/normalize-spells.mjs` continue de produire pour le runtime :

- `data/normalized/spell-data.json` : classes et sorts offensifs certifiés ;
- `data/normalized/spell-coverage-report.json` : couverture machine ;
- `data/normalized/spell-coverage-report.md` : couverture lisible et raisons d'exclusion.

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
