# AGENTS.md

## Rôle

Ce dépôt est un optimiseur de stuff Dofus piloté par un plan de combat. Avant toute modification, lire :

1. `README.md`
2. `PROJECT_STATE.md`
3. `docs/PRODUCT_CONTRACT.md`
4. `docs/ARCHITECTURE_CURRENT.md`
5. `SOURCE_DATA.md`
6. `docs/SPELL_KNOWLEDGE.md` si le travail touche aux sorts/combat.

GitHub et le code exécutable priment sur toute ancienne note ou hypothèse.

## Invariants produit

- **Combat plan first** : déterminer le meilleur tour réellement jouable, puis optimiser le stuff autour de ce tour.
- **Contraintes dures** : si un ensemble légal satisfaisant les minima existe, la recherche doit retourner un résultat satisfaisant tous les minima avant d'optimiser le score combat.
- **Pas d'invention de vérité Dofus** : une donnée inconnue ou une mécanique non certifiée doit rester explicitement non résolue.
- **Pas de réduction silencieuse** : un sort dont la sémantique riche n'est pas comprise ne doit pas être assimilé à ses seuls dégâts.
- Les règles d'équipement, FM, panoplies, PA/PM, sorts et combat sont du comportement produit : ne pas les modifier dans une tâche de maintenance sans autorisation explicite.

## Runtime actuel

Optimiseur :

`index.html` → `js/optimizer-v2-app.js` → `js/optimizer-worker.js` → `js/architecture-search-v2.js` → `optimizer/candidate-search.js`.

Atelier : `js/workshop/`.

Search Memory : `js/search-memory/`.

Ne pas conclure qu'un fichier est legacy à cause de son nom (`v2`, `experimental`, date, etc.). Prouver son absence du runtime, des tests, des scripts, des workflows et du service worker avant suppression.

## Données

- `data/normalized/dofus-data.json` : équipement normalisé/certifié.
- `data/normalized/spell-data.json` : catalogue combat runtime.
- `data/normalized/spell-source-truth.json` : vérité source riche, documentaire lorsqu'elle n'est pas certifiée par le runtime.
- Les données brutes sont temporaires au pipeline de synchronisation et ne sont pas une API runtime.

Le principe est : **IMPORTER != ACTIVER**.

## Tests avant merge

Pour une modification de code/maintenance générale :

```bash
npm run check
npm test
npm run recipe:browser
npm run smoke:product
```

Les benchmarks du workflow CI servent à détecter les régressions de coût sur les chemins principaux.

Toute modification de normalisation doit aussi exécuter la synchronisation/normalisation concernée et vérifier les rapports de couverture générés.

## Git / PR

- Une PR = une tranche cohérente.
- Ne jamais cacher un échec par suppression de test ou assouplissement arbitraire du contrat.
- Ne pas garder de branche de certification ou de diagnostic comme documentation permanente : intégrer la preuve utile au test/code courant, puis supprimer la branche quand sa valeur unique a disparu.
- L'historique Git archive les anciennes directions ; l'arbre courant ne doit contenir qu'une documentation valable maintenant.
