# Dofus Optimizer V2 — Recette de clôture

Date : 2026-08-27  
Scope : **Tranche 7 — Polish / recette V2**  
Base de travail : `main@74f9b7a4f36342799d3697aa1410f06474ce514f`

## 1. But de cette recette

Cette recette valide le produit V2 comme un parcours complet, pas seulement comme une collection de modules :

`Atelier → stuff → analyse → Optimiseur → recherche → résultat → Atelier`

Elle ne redéfinit aucun moteur métier. Les résultats, contraintes, dégâts, Search Memory, Lock/Reject et objectifs temporels restent validés par les tests canoniques existants.

## 2. Couverture automatisée

### Recette UI de clôture

`npm run recipe:v2`

Vérifie notamment :

- seuls les entrypoints V2 sont chargés par le shell final ;
- le thème final contient bien noir `#000000`, gris `#CCCFCA`, rouge `#DC2636` ;
- états `loading`, `empty`, `error` explicites ;
- focus clavier et responsive présents ;
- navigation Atelier ↔ Optimiseur conservée ;
- Find Better / Open Workshop restent raccordés ;
- le service worker ne précharge plus les anciens entrypoints UI ;
- `appVersion` reste stable afin de ne pas invalider les fingerprints métier/Search Memory pour un simple polish UI.

### Recette navigateur réelle

`npm run recipe:browser`

Le script démarre l’application sur un serveur HTTP local et pilote Chrome headless via CDP, sans dépendance npm supplémentaire. Il valide :

1. cold start de l’application ;
2. chargement réel des catalogues équipements + sorts ;
3. Atelier visible et progression initiale `0 / 16` ;
4. ouverture d’un slot au clavier avec `Enter` ;
5. sélection d’un vrai item et progression `1 / 16` ;
6. passage à l’Optimiseur ;
7. sélection d’une vraie classe ;
8. lancement d’une recherche réelle ;
9. obtention d’au moins un résultat ouvrable ;
10. ouverture du résultat dans l’Atelier ;
11. vérification du retour Atelier avec un stuff complet `16 / 16`.

Ce smoke est exécuté par la CI standard V2.

## 3. Couverture fonctionnelle historique réutilisée

La recette finale s’appuie aussi sur `npm test`, qui couvre entre autres :

- `tests/workshop.test.mjs` — modèle Atelier, slots, évaluation ;
- `tests/workshop-persistence-search.test.mjs` — sauvegarde, restauration et recherche intelligente ;
- `tests/optimizer-v2-ui.test.mjs` — contrat du flux Optimiseur V2 ;
- `tests/search-memory.test.mjs` — cache exact, requêtes proches et seeds ;
- `tests/lock-reject-find-better.test.mjs` — Lock, Reject, Trouver mieux et round-trip Atelier/Optimiseur ;
- `tests/temporal-objectives-v2.test.mjs` — T1/T2/T3, cumul, moyenne, pire tour et Constant ;
- `tests/complete-build-evaluator-legality.test.mjs` — légalité finale ;
- `tests/v2-regression-baseline.test.mjs` — baseline V2 de non-régression ;
- `tests/performance-reuse.test.mjs` — invariants de la Tranche 6.

## 4. Checklist visuelle desktop

Cible de lecture : viewport large autour de 1440 px.

- [x] Atelier et Optimiseur partagent la même palette néo-rétro.
- [x] Fond principal noir, surfaces gris très sombre, accent rouge réservé aux actions/états importants.
- [x] Pas de surcharge cyberpunk, glow ou gradients décoratifs agressifs.
- [x] Onglets Atelier / Optimiseur immédiatement lisibles.
- [x] Hiérarchie claire : produit → section → action → diagnostic.
- [x] Optimiseur : contrôles séparés en 4 étapes lisibles.
- [x] Résultats Optimiseur : score, tours, stats, équipement et CTA Atelier distincts.
- [x] Atelier : progression `x / 16` visible.
- [x] Lock / Reject / Retirer explicites en français.
- [x] États vides donnent une action ou une explication utile.

## 5. Checklist mobile / clavier

- [x] Layout responsive sous 680 px.
- [x] Tabs restent accessibles et visibles.
- [x] Focus visible sur boutons, tabs et contrôles.
- [x] Navigation des tabs par flèches gauche/droite, Home et End.
- [x] Slot Atelier activable avec `Enter` ou espace.
- [x] Actions équipement ne dépendent pas uniquement d’une icône ambiguë.
- [x] `prefers-reduced-motion` réduit les animations.

## 6. États produit

### Chargement

Atelier et Optimiseur affichent un état explicite pendant le chargement des données. L’Optimiseur distingue aussi la préparation mémoire de la recherche lourde.

### Vide

Les principaux vides sont différenciés :

- Optimiseur prêt mais non lancé ;
- aucune solution sous contraintes ;
- aucune correspondance dans la recherche d’items ;
- aucune panoplie active ;
- classe non choisie pour l’analyse combat.

### Erreur

Les erreurs de données, d’évaluation et de Worker ont un état visuel dédié et une phrase de reprise. Une erreur de Search Memory reste non bloquante par contrat.

## 7. Parcours Atelier → Optimiseur → Atelier

### Atelier

1. Choisir une classe.
2. Ouvrir un slot et rechercher un item.
3. Compléter progressivement les 16 slots.
4. Vérifier stats et dégâts live.
5. Sur un build complet, vérifier T1/T2/T3 et Constant.
6. Sauvegarder, charger, renommer, dupliquer et supprimer un stuff.
7. Verrouiller un item ou en rejeter un.

### Trouver mieux

1. Le bouton reste désactivé tant que classe + 16 slots ne sont pas présents.
2. Sur build complet, cliquer `Trouver mieux`.
3. L’Optimiseur affiche explicitement qu’il vient de l’Atelier.
4. Seuls les items verrouillés sont contraints ; les autres slots restent libres.
5. Les rejets restent exclus de la requête.

### Optimiseur

1. Choisir classe, élément, contraintes et objectif.
2. Pendant la recherche, les contrôles de requête sont gelés visuellement.
3. Le bouton devient `Arrêter la recherche`.
4. Un arrêt conserve les résultats déjà validés.
5. Un résultat peut être rouvert dans l’Atelier.
6. Le stuff retourné comporte 16 slots et conserve les métadonnées Lock/Reject applicables.

## 8. Search Memory

À valider par tests et comportement :

- même requête compatible → cache exact ;
- requête voisine → seeds réévalués avec les moteurs courants ;
- seed jamais considéré comme preuve suffisante sans réévaluation ;
- changement de règles/données invalide la compatibilité ;
- le simple polish UI de cette tranche ne change pas `appVersion` ni les fingerprints métier.

## 9. Performance / non-régression

Avant passage READY, exécuter :

```bash
npm run check
npm test
npm run recipe:v2
npm run recipe:browser
npm run benchmark:v2
npm run benchmark:search
npm run benchmark:workshop
```

La Tranche 7 ne cherche pas un nouveau gain performance. Les benchmarks servent de garde-fou afin que le polish n’introduise aucune régression fonctionnelle ou runtime évidente.

## 10. Nettoyage final du runtime

Le shell de production final charge :

- `styles.css` comme base ;
- `styles-workshop.css` ;
- `styles-optimizer-v2.css` ;
- `styles-v2-polish.css` comme couche de finition ;
- `js/workshop/workshop-app.js` ;
- `js/optimizer-v2-app.js`.

Les anciennes couches `styles-experimental.css`, `styles-session.css`, `app-experimental.js` et bridges associés peuvent rester dans l’historique du dépôt tant qu’elles ne sont plus des entrypoints de production. Leur suppression physique n’est pas nécessaire pour clôturer V2 et évite un nettoyage risqué hors scope.

## 11. Critère de clôture

La V2 est considérée clôturée lorsque :

- cette recette statique est verte ;
- le smoke navigateur E2E est vert ;
- la suite de tests historique est verte ;
- les trois benchmarks historiques sont verts ;
- la CI finale du HEAD exact de la PR est verte ;
- le diff de la Tranche 7 ne contient aucun moteur métier ;
- `PROJECT_STATE.md` et `README.md` reflètent le runtime V2 réellement exécuté.

Après merge, il n’existe plus de « tranche V2 suivante ». Toute nouvelle évolution doit repartir du nouveau `main` comme un nouveau scope produit ou de maintenance.
