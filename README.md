# Dofus Optimizer — V0.10

Web app statique/PWA destinée à rechercher un équipement Dofus optimal sous contraintes.

## État actuel

La V0.10 utilise des **équipements et sorts Dofus réels certifiés**, synchronisés sur la même version du jeu :

- équipements et panoplies issus de `data/normalized/dofus-data.json` ;
- catalogue offensif de classes issu de `data/normalized/spell-data.json` ;
- Dofus, trophées, Prysmaradites, familiers, montures et équipement niveau 190–200 selon les règles de sélection ;
- passifs connus conservés sous forme structurée ;
- objets dont les effets ou conditions ne sont pas compris exclus du snapshot de calcul ;
- recherche exacte lazy branch-and-bound dans un **Web Worker**, pour ne pas bloquer l'interface ;
- sélection d'une classe puis de plusieurs sorts réels, avec poids et nombre de lancers T1/T2/T3 ;
- coût PA réel du combo imposé comme contrainte à chaque tour ;
- choix explicite Mêlée/Distance lorsqu'un sort peut être lancé dans les deux cadres ;
- optimisation T1, T2, T3, somme T1–T3, moyenne ou pire tour ;
- contraintes minimales sur PA/PM/PO, vitalité et résistances ;
- bonus de panoplie ;
- répartition automatique des 995 points de caractéristiques par paliers ;
- FM offensive : `+X % dommages aux sorts` ou `+8 dommages critiques` lorsque l'objet n'a pas de Do Crit natifs, uniquement sur les slots forgeables ;
- classement Top N des builds ;
- contextes optionnels pour les Prysmaradites dont le calcul dépend du combat, sans valeur implicite inventée.

Sur Dofus **3.6.10.10**, le normaliseur certifie actuellement **222 sorts offensifs directs à élément fixe sur 19 classes**. Les dégâts « meilleur élément », différés ou conditionnels sont volontairement exclus tant qu'ils ne sont pas simulés exactement.

## Données

Le pipeline est : snapshot brut hors navigateur → normalisation stricte → rapport de couverture → snapshots certifiés.

Fichiers principaux :

- `data/normalized/dofus-data.json` — équipements et panoplies utilisés par l'application ;
- `data/normalized/coverage-report.md` — couverture des équipements ;
- `data/normalized/coverage-report.json` — diagnostics détaillés des équipements et passifs ;
- `data/normalized/spell-data.json` — classes et sorts offensifs certifiés ;
- `data/normalized/spell-coverage-report.md` — couverture lisible du catalogue de sorts ;
- `data/normalized/spell-coverage-report.json` — diagnostics du normaliseur de sorts.

Le navigateur ne retombe jamais silencieusement sur des données de démonstration. Il vérifie également que les équipements et les sorts proviennent de la **même version Dofus** avant d'activer l'optimiseur.

### Périmètre certifié des sorts

Le modèle V0.10 inclut :

- dégâts directs immédiats Terre, Feu, Eau, Air et Neutre ;
- vols de vie de ces cinq éléments pour leur composante dégâts ;
- jets normaux et critiques ;
- coût PA, taux critique, portée et limites de lancer ;
- niveau de sort le plus élevé réellement accessible à un personnage niveau 200.

Il exclut plutôt que d'approximer : poisons, dégâts déclenchés ou différés, dégâts « meilleur élément » et autres mécaniques nécessitant une simulation d'état/action plus riche.

## Lancer localement

Un serveur HTTP est nécessaire pour charger les JSON et le Web Worker :

```bash
python -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.

Tests :

```bash
npm test
npm run check

# lorsque la machine a accès au réseau
npm run sync:normalize
```

## Architecture

- `index.html` — shell de l'application et contrôles de classe/sorts/contexte.
- `styles.css` — composants et thème sombre.
- `js/config.js` — slots, statistiques, paliers et defaults.
- `js/data-loader.js` — chargement et validation des snapshots certifiés.
- `js/spell-selection.js` — sélection UI des sorts, portée et coût PA du combo.
- `js/optimizer-worker.js` — exécution du solveur hors du thread UI.
- `js/stats.js` — opérations sur les statistiques et contraintes.
- `js/characteristics.js` — allocation automatique des points.
- `js/spells.js` — calcul multi-sort / multi-tour, contraintes PA et distinction sorts/armes.
- `js/dofus-spell-normalizer.js` — normalisation stricte des sorts de classe DofusDude.
- `js/passives.js` — moteur générique de passifs temporels/contextuels.
- `js/dofus-passives.js` — registre audité des passifs Dofus/Prysmaradites connus.
- `js/fm.js` — règle `% Do Sorts` vs `+8 Do Crit`.
- `js/sets.js` — bonus de panoplies.
- `js/build-legality.js` — conditions d'équipement et règles de slots spéciales.
- `js/search-space.js` — dominance et bornes sûres de recherche.
- `js/solver.js` — recherche exacte lazy branch-and-bound et Top N.
- `js/app.js` — UI et orchestration.
- `scripts/sync-dofusdude.mjs` — récupération des équipements bruts hors navigateur.
- `scripts/sync-spells.mjs` — récupération des sources de sorts depuis la release DofusDude correspondant exactement à la version courante.
- `scripts/normalize-dofusdude.mjs` — snapshot compact certifié des équipements + rapport de couverture.
- `scripts/normalize-spells.mjs` — snapshot compact certifié des sorts + rapport de couverture.
- `SOURCE_DATA.md` — provenance et stratégie de validation des données.

## Principe de fiabilité

Le solveur ne doit jamais deviner silencieusement un effet Dofus. Toute donnée importée doit être soit :

1. normalisée vers une statistique ou un dégât connu ;
2. explicitement classée comme effet temporel/conditionnel pris en charge ;
3. explicitement reconnue comme effet sans incidence sur l'objectif modélisé ;
4. déclarée `unmapped`/pending et donc exclue des recherches certifiées.

Lorsqu'un passif modélisé nécessite un contexte de combat, l'absence de ce contexte rend le passif non évaluable. Lorsqu'une mécanique de sort nécessite une simulation non encore disponible, le sort est exclu du catalogue certifié plutôt qu'approximé.
