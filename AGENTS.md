# AGENTS.md

## Rôle

Ce dépôt est un **optimiseur de plan de combat Dofus**. L'équipement est un moyen d'exécuter et de maximiser ce plan, pas l'objectif autonome du produit.

Avant toute modification, lire :

1. `README.md`
2. `PROJECT_STATE.md`
3. `docs/PRODUCT_CONTRACT.md`
4. `docs/ARCHITECTURE_CURRENT.md`
5. `SOURCE_DATA.md`
6. `docs/SPELL_KNOWLEDGE.md` si le travail touche aux sorts/combat.

GitHub et le code exécutable décrivent l'état réel du runtime. `docs/PRODUCT_CONTRACT.md` décrit la direction produit canonique. Lorsqu'un point du contrat n'est pas encore implémenté, il doit rester identifié comme un écart ; ne jamais réécrire la documentation pour faire croire qu'il fonctionne déjà.

## Invariants produit

- **Combat plan first** : déterminer le meilleur tour offensif `Tn` réellement jouable, puis optimiser les moyens de l'exécuter et de le maximiser.
- **Préparation Tn** : pour `T2`, T1 ne vaut que par son effet sur T2 ; pour `T3`, T1 et T2 ne valent que par leur effet sur T3. Les dégâts de préparation ne sont pas additionnés au score du tour cible.
- **Contraintes dures** : si un ensemble légal satisfaisant les minima existe, la recherche doit retourner un résultat satisfaisant tous les minima avant d'optimiser le score combat.
- **Pas d'invention de vérité Dofus** : une donnée inconnue ou une mécanique non certifiée doit rester explicitement non résolue.
- **Pas de réduction silencieuse** : un sort dont la sémantique riche n'est pas comprise ne doit pas être assimilé à ses seuls dégâts.
- **Équipement sans valeur intrinsèque** : PA, PM, stats, Dofus, trophées, compagnon, exos et FM n'ont de valeur que par leur effet sur le plan combat et par les contraintes utilisateur.
- Les règles d'équipement, FM, panoplies, PA/PM, sorts et combat sont du comportement produit : ne pas les modifier dans une tâche de maintenance sans autorisation explicite.

## Runtime actuel

Optimiseur :

`index.html` → `js/optimizer-v2-app.js` → `js/optimizer-worker.js` → `js/architecture-search-v2.js` → `optimizer/candidate-search.js`.

Atelier : `js/workshop/`.

Primitives Search Memory : `js/search-memory/`. Le repository instancié sans options par le produit est actuellement inerté ; ne pas présenter cette couche comme un cache persistant actif sans vérifier le code courant.

Ne pas conclure qu'un fichier est legacy à cause de son nom (`v2`, `legacy`, date, etc.). Prouver son rôle depuis le runtime, les tests, les scripts, les workflows et le service worker avant suppression. Inversement, un test dédié à une ancienne implémentation ne suffit pas à rendre cette implémentation produit active.

## Données

- `data/normalized/dofus-data.json` : équipement normalisé/certifié.
- `data/normalized/spell-data.json` : catalogue combat runtime.
- `data/normalized/spell-source-truth.json` : vérité source riche ; une sémantique peut y rester `source-unresolved` sans être activée dans le planner.
- Les données brutes sont temporaires au pipeline de synchronisation et ne sont pas une API runtime.

Principe : **IMPORTER != COMPRENDRE != ACTIVER**.

Pour les sorts complexes, le futur enrichissement IA est un travail offline de structuration/certification. Une sortie IA n'est jamais à elle seule une règle runtime : elle doit être traçable, structurée, testée et pouvoir conclure `MECHANIC_UNRESOLVED`.

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
