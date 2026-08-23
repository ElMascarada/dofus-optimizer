# Dofus Optimizer — prototype V0.2

Web app statique/PWA destinée à rechercher un équipement Dofus optimal sous contraintes.

## V0.2

Le prototype pose les contrats de calcul avant d'intégrer toute la base de jeu :

- plusieurs sorts, avec poids différents ;
- optimisation T1, T2, T3, somme T1–T3, moyenne ou pire tour ;
- contraintes minimales sur PA/PM/PO, vitalité et résistances ;
- bonus de panoplie ;
- répartition automatique des 995 points de caractéristiques par paliers ;
- FM offensive simplifiée : `+X % dommages aux sorts` ou `+8 dommages critiques` lorsque l'objet n'a pas de Do Crit natifs, uniquement sur les slots réellement forgeables ;
- classement Top N des builds ;
- pipeline Dofusdude : snapshot brut hors navigateur → normalisation stricte → rapport de couverture → snapshot certifié ;
- tests Node sans dépendance.

Le dataset utilisé par l'UI reste pour l'instant un **fixture de démonstration**. En revanche, la V0.2 contient désormais le pipeline complet de synchronisation et de normalisation Dofusdude. Seuls les items dont le slot, les effets passifs et les conditions sont compris entrent dans le snapshot certifié.

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

# lorsque la machine a accès au réseau
npm run sync:normalize
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
- `js/dofusdude-normalizer.js` — mapping strict effets/conditions/slots Dofusdude.
- `scripts/sync-dofusdude.mjs` — récupération des snapshots bruts hors navigateur.
- `scripts/normalize-dofusdude.mjs` — snapshot compact certifié + rapport de couverture.
- `SOURCE_DATA.md` — provenance et stratégie de validation des données.

## Principe de fiabilité

Le solveur ne doit jamais deviner silencieusement un effet Dofus. Tout effet importé doit être soit :

1. normalisé vers une statistique connue ;
2. explicitement classé comme effet temporel/conditionnel pris en charge ;
3. déclaré `unmapped` et donc exclu des recherches certifiées.

Le futur snapshot complet sera accompagné d'un rapport de couverture.
