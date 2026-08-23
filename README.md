# Dofus Optimizer — prototype V0.1

Web app statique/PWA destinée à rechercher un équipement Dofus optimal sous contraintes.

## V0.1

Le prototype pose les contrats de calcul avant d'intégrer toute la base de jeu :

- plusieurs sorts, avec poids différents ;
- optimisation T1, T2, T3, somme T1–T3, moyenne ou pire tour ;
- contraintes minimales sur PA/PM/PO, vitalité et résistances ;
- bonus de panoplie ;
- répartition automatique des 995 points de caractéristiques par paliers ;
- FM offensive simplifiée : `+X % dommages aux sorts` ou `+8 dommages critiques` lorsque l'objet n'a pas de Do Crit natifs ;
- classement Top N des builds ;
- architecture de données prévue pour un snapshot Dofusdude vendored ;
- tests Node sans dépendance.

Le dataset livré ici est volontairement un **fixture de démonstration**, pas la base Dofus complète. Le script `scripts/sync-dofusdude.mjs` prépare la récupération brute de Dofusdude ; la prochaine étape consiste à finaliser la normalisation des effets réels et son rapport de couverture avant d'autoriser le solveur à utiliser le snapshot complet.

## Lancer localement

Un simple serveur statique suffit :

```bash
python -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.

Tests :

```bash
npm test
npm run check
```

## Architecture

- `index.html` — shell de l'application.
- `styles.css` — composants et thème sombre.
- `js/config.js` — slots, statistiques, paliers et defaults.
- `js/stats.js` — opérations sur les statistiques et contraintes.
- `js/characteristics.js` — allocation automatique des points.
- `js/spells.js` — calcul multi-sort / multi-tour.
- `js/fm.js` — règle `% Do Sorts` vs `+8 Do Crit`.
- `js/sets.js` — bonus de panoplies.
- `js/solver.js` — recherche, pruning de contraintes et Top N.
- `js/sample-data.js` — petit dataset permettant de tester immédiatement.
- `js/app.js` — UI et orchestration.
- `scripts/sync-dofusdude.mjs` — récupération des snapshots bruts.
- `SOURCE_DATA.md` — provenance et stratégie de validation des données.

## Principe de fiabilité

Le solveur ne doit jamais deviner silencieusement un effet Dofus. Tout effet importé doit être soit :

1. normalisé vers une statistique connue ;
2. explicitement classé comme effet temporel/conditionnel pris en charge ;
3. déclaré `unmapped` et donc exclu des recherches certifiées.

Le futur snapshot complet sera accompagné d'un rapport de couverture.
