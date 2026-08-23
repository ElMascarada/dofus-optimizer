# Dofus Optimizer — V0.9

Web app statique/PWA destinée à rechercher un équipement Dofus optimal sous contraintes.

## État actuel

La V0.9 branche l'interface sur le **snapshot Dofus certifié réel** généré par le pipeline Dofusdude :

- équipements et panoplies réels issus de `data/normalized/dofus-data.json` ;
- Dofus, trophées, Prysmaradites, familiers, montures et équipement niveau 190–200 selon les règles de sélection ;
- passifs connus conservés sous forme structurée ;
- objets dont les effets ou conditions ne sont pas compris exclus du snapshot de calcul ;
- recherche exacte lazy branch-and-bound dans un **Web Worker**, pour ne pas bloquer l'interface ;
- plusieurs sorts avec poids différents ;
- optimisation T1, T2, T3, somme T1–T3, moyenne ou pire tour ;
- contraintes minimales sur PA/PM/PO, vitalité et résistances ;
- bonus de panoplie ;
- répartition automatique des 995 points de caractéristiques par paliers ;
- FM offensive : `+X % dommages aux sorts` ou `+8 dommages critiques` lorsque l'objet n'a pas de Do Crit natifs, uniquement sur les slots forgeables ;
- classement Top N des builds ;
- contextes optionnels pour les Prysmaradites dont le calcul dépend du combat, sans valeur implicite inventée.

Les **sorts affichés dans l'UI sont encore le fixture de test**. Ils servent à valider le moteur avec la vraie base d'équipement en attendant l'intégration du catalogue de sorts réel.

## Données

Le pipeline est : snapshot brut hors navigateur → normalisation stricte → rapport de couverture → snapshot certifié.

Fichiers principaux :

- `data/normalized/dofus-data.json` — snapshot compact utilisé par l'application ;
- `data/normalized/coverage-report.md` — rapport lisible de couverture ;
- `data/normalized/coverage-report.json` — diagnostics détaillés, y compris les passifs temporels encore non modélisés.

Le navigateur ne retombe jamais silencieusement sur des objets de démonstration si le snapshot réel ne charge pas : il affiche une erreur et désactive le calcul.

## Lancer localement

Un serveur HTTP est nécessaire pour charger le JSON et le Web Worker :

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

- `index.html` — shell de l'application et contrôles de contexte.
- `styles.css` — composants et thème sombre.
- `js/config.js` — slots, statistiques, paliers et defaults.
- `js/data-loader.js` — chargement et validation du snapshot certifié.
- `js/optimizer-worker.js` — exécution du solveur hors du thread UI.
- `js/stats.js` — opérations sur les statistiques et contraintes.
- `js/characteristics.js` — allocation automatique des points.
- `js/spells.js` — calcul multi-sort / multi-tour et distinction sorts/armes.
- `js/passives.js` — moteur générique de passifs temporels/contextuels.
- `js/dofus-passives.js` — registre audité des passifs Dofus/Prysmaradites connus.
- `js/fm.js` — règle `% Do Sorts` vs `+8 Do Crit`.
- `js/sets.js` — bonus de panoplies.
- `js/build-legality.js` — conditions d'équipement et règles de slots spéciales.
- `js/search-space.js` — dominance et bornes sûres de recherche.
- `js/solver.js` — recherche exacte lazy branch-and-bound et Top N.
- `js/sample-data.js` — sorts de test temporaires ; l'équipement de ce fichier n'est plus utilisé par l'UI.
- `js/app.js` — UI et orchestration.
- `js/dofusdude-normalizer.js` — mapping strict effets/conditions/slots Dofusdude.
- `scripts/sync-dofusdude.mjs` — récupération des snapshots bruts hors navigateur.
- `scripts/normalize-dofusdude.mjs` — snapshot compact certifié + rapport de couverture.
- `SOURCE_DATA.md` — provenance et stratégie de validation des données.

## Principe de fiabilité

Le solveur ne doit jamais deviner silencieusement un effet Dofus. Tout effet importé doit être soit :

1. normalisé vers une statistique connue ;
2. explicitement classé comme effet temporel/conditionnel pris en charge ;
3. explicitement reconnu comme effet non numérique sans incidence sur l'objectif modélisé ;
4. déclaré `unmapped`/pending et donc exclu des recherches certifiées.

Lorsqu'un passif modélisé nécessite un contexte de combat, l'absence de ce contexte rend le build non évaluable au lieu d'utiliser une hypothèse cachée.
