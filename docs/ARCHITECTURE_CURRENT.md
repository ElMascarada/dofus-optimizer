# Dofus Optimizer — Architecture actuelle

## Baseline auditée

Baseline de cette migration : `main` au commit `46720d09ae04a4e7ddff6339a4fa39baaacfcbb8`.

Cette architecture est décrite telle qu'elle est réellement exécutée par le navigateur, pas telle qu'elle était décrite dans l'ancien README.

## Point d'entrée UI

`index.html` est le shell HTML unique chargé en production.

Le module UI réellement exécuté et retenu comme entrée canonique pour la migration est :

- `js/app-experimental.js` — orchestration UI actuelle, chargement des données, collecte des paramètres, lancement du Worker et rendu des résultats.

L'ancienne UI `js/app.js` n'était chargée ni par `index.html` ni par le service worker et dépendait encore d'anciens contrôles. Cette duplication clairement morte est supprimée dans la PR de fondation.

Deux scripts classiques s'insèrent actuellement avant l'application :

- `js/optimizer-session-bridge.js` ;
- `js/optimizer-stop-bridge.js`.

Ils font partie du comportement de production actuel, même si leur architecture est transitoire.

## Flux d'optimisation réellement exécuté

```text
index.html
  -> app-experimental.js
    -> optimizer-worker.js
      -> architecture-search-v2.js
        -> candidate-prefilter.js
        -> set-synergy-index.js
        -> complete-build-evaluator.js
      -> offensive-slot-refiner.js
      -> combat-turn-refiner.js
        -> turn-optimizer.js
      -> combat-feedback.js
      -> result-diversity.js
    -> rendu UI / modal build
```

`optimizer-worker.js` est le point d'orchestration de la recherche hors thread UI. Il ne constitue pas le solveur à lui seul : il chaîne plusieurs étapes de génération, raffinement, calcul de rotation et diversification.

## Recherche équipement

### Préfiltrage

`candidate-prefilter.js` possède déjà un préfiltrage conscient :

- de l'élément ;
- des contraintes ;
- de spécialistes de contraintes ;
- des panoplies pertinentes ;
- des statistiques offensives.

Cependant `architecture-search-v2.js` reconstruit ensuite des pools par slot et ses propres réserves. Le préfiltrage n'est donc pas encore une frontière unique de l'architecture.

### Recherche d'architectures

`architecture-search-v2.js` est la voie utilisée par le Worker actuel. Il combine :

- pools de slots ;
- réserves PA/PM et contraintes défensives ;
- architectures de panoplies ;
- mutations ;
- contraintes d'items imposés ;
- évaluation finale via `evaluateCompleteBuild`.

Les constantes de largeur/capacité de recherche sont encore dispersées dans plusieurs modules.

### Évaluation finale

`complete-build-evaluator.js` est la barrière de vérité d'un build complet :

- légalité des slots ;
- bonus de panoplies ;
- caractéristiques ;
- conditions d'items ;
- FM ;
- contraintes permanentes ;
- contraintes temporelles ;
- statistiques par tour ;
- dégâts par sort.

Les contraintes utilisateur y sont actuellement des règles dures : un build invalide n'est pas remonté comme simple avertissement.

## Combat

### Calcul générique

`turn-optimizer.js` explore les séquences de sorts avec :

- PA disponibles ;
- limites de lancer ;
- cooldowns ;
- buffs/debuffs temporaires ;
- modificateurs retardés ;
- états de charge déclaratifs ;
- dégâts mono-cible/zone ;
- T1/T2/T3 et agrégats multi-tours.

### Dette de spécialisation

Le moteur contient encore une mécanique Huppermage codée en dur (`breedId`, nom de classe, combinaison élémentaire Terre/Feu et vulnérabilité). Cela viole la cible V2.

Les mécaniques Iop récemment ajoutées passent déjà davantage par les données normalisées (`selfCharge`, modificateurs retardés), ce qui constitue la direction à généraliser.

La fondation ajoute `combat-mechanics-registry.js` comme interface déclarative générique, mais ne migre aucune mécanique existante afin de ne pas changer les rotations.

## Arrêt manuel

Le bouton d'optimisation sert aussi à arrêter une recherche en cours.

`optimizer-stop-bridge.js` intercepte actuellement le Worker et le clic d'arrêt afin de :

- conserver les derniers candidats partiels ;
- arrêter la recherche lourde ;
- lancer `partial-finalizer-worker.js` ;
- finaliser les rotations des meilleurs candidats déjà trouvés ;
- renvoyer un résultat complet lorsque possible.

Cette fonction produit un comportement utile, mais son implémentation repose sur un patch global de `window.Worker` et une interception DOM. Elle doit être migrée vers un client Worker explicite dans une PR suivante.

## Session / cache

`optimizer-session-bridge.js` gère aujourd'hui :

- cache exact de recherches dans `localStorage` ;
- empreinte de requête ;
- liste d'items imposés ;
- injection des `requiredItemIds` dans les requêtes ;
- cache hit renvoyé comme faux message Worker ;
- UI d'équipement imposé ;
- ajout du bouton « Imposer » dans la modal résultat.

Dette majeure :

- remplacement global de `window.Worker` ;
- `MutationObserver` pour enrichir la modal après rendu ;
- second chargement autonome du catalogue d'items ;
- mélange persistence, transport Worker et UI dans un même fichier.

La PR de fondation centralise les identifiants/version/cache mais conserve ce bridge pour rester comportementalement neutre.

## Version et cache runtime

Avant cette PR, trois versions pouvaient diverger :

- `package.json` ;
- `config.js` ;
- `service-worker.js`.

La fondation introduit `js/runtime-meta.js` comme source runtime canonique pour :

- version applicative ;
- identité du cache service worker ;
- clé du cache de recherche ;
- clé des items imposés ;
- epoch de calcul ;
- nombre maximal d'entrées.

`package.json` n'expose plus de version applicative indépendante. Les suffixes `?v=YYYYMMDD-N` présents dans `index.html` restent pour cette PR un identifiant de révision d'assets, distinct de la version applicative.

## Interfaces préparatoires

La fondation ajoute sans les brancher sur le comportement courant :

- `optimizer-protocol.js` — forme stable des messages Worker ;
- `combat-mechanics-registry.js` — registre déclaratif générique destiné à recevoir les mécaniques de classes dans une PR dédiée.

Ces interfaces ne remplacent encore aucun composant de production.

## Données

La source publiée en navigateur est normalisée et certifiée :

- `data/normalized/dofus-data.json` — équipements et panoplies ;
- `data/normalized/spell-data.json` — classes et sorts de combat.

`data-loader.js` valide les schémas, exclut le contenu non certifié et applique les règles runtime curatées.

Le pipeline `scripts/` synchronise et normalise les données hors navigateur. Il ne fait pas partie du runtime de recherche.

## Tests

La suite Node couvre notamment :

- recherche V2 et PA/PM ;
- préfiltrage ;
- évaluation complète ;
- contraintes de survie ;
- panoplies ;
- sorts et passifs ;
- combat multi-tour ;
- Huppermage/Iop ;
- finalisation partielle ;
- cache/session UI ;
- garde-fous UI.

La PR ajoute une baseline transversale dédiée V2 et un benchmark reproductible afin de figer les comportements avant migration.

## Code historique / expérimental

### Supprimé comme duplication clairement morte

- `js/app.js` : ancienne UI, non chargée par le runtime actuel et absente de l'APP_SHELL du service worker.

### Historique mais encore conservé

- `js/architecture-search.js` ;
- `js/solver.js` ;
- certaines suites historiques associées.

Ils ne sont pas la voie appelée par `optimizer-worker.js`, mais restent référencés par la suite de tests et/ou l'APP_SHELL. Ils ne sont donc pas supprimés dans cette PR sans audit de parité dédié.

### Build/maintenance, pas runtime

- normaliseurs et synchroniseurs dans `scripts/` ;
- rapports de couverture ;
- snapshots sources/intermédiaires.

## Dettes prioritaires après la fondation

1. remplacer les patches globaux `window.Worker` par un `OptimizerClient` explicite ;
2. déplacer l'UI d'items imposés dans le rendu canonique ;
3. supprimer le `MutationObserver` de la modal principale ;
4. migrer Huppermage vers le registre déclaratif ;
5. rendre le préfiltrage équipement réellement unique ;
6. centraliser les constantes beam/search ;
7. remplacer le cache principal `localStorage` par un repository IndexedDB ;
8. convertir les résultats connus en seeds réutilisables.
