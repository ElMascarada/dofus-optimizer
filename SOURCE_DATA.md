# Données source

## Principe

Le solveur ne doit jamais inventer silencieusement une donnée de jeu. La synchronisation importe une vérité externe, la normalisation la certifie pour les capacités réellement prises en charge, puis le navigateur ne consomme que les snapshots publiés.

**IMPORTER != ACTIVER.**

## Source primaire

Le projet utilise Dofusdude (`dofus3`, langue `fr`).

Pour l'équipement, la synchronisation récupère les équipements, panoplies, montures, métadonnées d'éléments et version du jeu nécessaires à la normalisation.

Pour les sorts, le pipeline utilise la version Dofus retournée par la source puis télécharge la release GitHub Dofusdude correspondante. Les fichiers de travail incluent notamment :

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

La version exacte et les volumes source du snapshot courant sont enregistrés dans les fichiers normalisés générés ; ne pas les dupliquer manuellement dans la documentation.

## Snapshots publiés

### Équipement

`data/normalized/dofus-data.json` est le catalogue runtime d'équipement certifié.

Le snapshot conserve les items appartenant au périmètre compris par l'application, leurs statistiques normalisées, conditions comprises et panoplies nécessaires. Les jets naturels sont comparés sur une base normalisée cohérente.

Chaque effet/condition doit être compris. Une donnée inconnue reste non certifiée plutôt que d'être convertie par heuristique.

Les rapports associés sont :

- `data/normalized/coverage-report.json`
- `data/normalized/coverage-report.md`

### Sorts combat runtime

`data/normalized/spell-data.json` contient les formes de sorts que le moteur combat sait actuellement calculer avec la certitude exigée par le produit.

Ce catalogue alimente le runtime. Il ne constitue pas une preuve que toute la sémantique Dofus du sort est comprise.

Rapports associés :

- `data/normalized/spell-coverage-report.json`
- `data/normalized/spell-coverage-report.md`

### Vérité source riche des sorts

`data/normalized/spell-source-truth.json` est produit par `scripts/normalize-spell-source-truth.mjs`.

Il préserve les informations source utiles qui dépassent le modèle combat courant : ordres d'effets, triggers, durées, délais, ciblage/masques, relations, scripts liés et autres références explicitement joignables.

Chaque entrée expose un statut sémantique :

- `runtime-supported` : la forme source sélectionnée est entièrement représentée par le runtime certifié ;
- `source-unresolved` : la donnée riche est préservée mais une partie de sa sémantique n'est pas encore certifiée par le runtime.

Une entrée `source-unresolved` ne doit pas devenir active par ressemblance ou heuristique.

## Chaîne canonique

```text
source Dofusdude
  -> sync:data / sync:spells
  -> normalize:data / normalize:spells / normalize:spell-source-truth
  -> apply:curated
  -> sync:spell-icons
  -> snapshots normalisés + assets locaux
```

Commande complète :

```bash
npm run sync:normalize
```

Workflow canonique : `.github/workflows/sync-dofus-data.yml`.

Il n'existe pas de second propriétaire permanent pour la synchronisation des icônes.

## Règle combat

La chaîne produit cible est :

```text
vérité source
  -> sémantique certifiée
  -> mécaniques combat
  -> plan de tour
  -> score temporel
  -> optimisation équipement
```

Un sort dont une mécanique pertinente n'est pas comprise ne doit jamais être présenté comme sémantiquement complet sur la seule base de ses dégâts immédiats.
