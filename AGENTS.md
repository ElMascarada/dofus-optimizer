# Dofus Optimizer — Agent Guide

Ce fichier est le point d'entrée canonique pour tout nouvel agent ou toute nouvelle fenêtre ChatGPT qui reprend le dépôt.

## 1. Reprise obligatoire

Toujours partir du `main` mergé et vert.

```bash
git checkout main
git pull
git rev-parse HEAD
```

Ne pars jamais d'une ancienne branche d'agent sauf instruction explicite.

Lis ensuite, dans cet ordre :

1. `PROJECT_STATE.md`
2. `docs/V2_COMPLETION_PLAN.md`
3. `docs/OPTIMIZER_V2_SPEC.md` uniquement si la cible produit est nécessaire
4. `docs/ARCHITECTURE_TARGET.md` uniquement si la tranche touche l'architecture
5. `docs/MIGRATION_PLAN.md` pour l'historique et les dépendances

Ne relis pas tout le dépôt sans raison. Ouvre ensuite uniquement les modules concernés par la tranche.

## 2. Discipline de travail

- Une branche = une responsabilité claire.
- Une PR = un scope limité et testable.
- Pas de refactor opportuniste hors scope.
- Fais des checkpoints fréquents et garde `PROJECT_STATE.md` à jour en fin de tranche.
- Ne contourne jamais un test par suppression ou relâchement arbitraire d'un invariant.
- N'augmente pas simplement les beams/pools pour masquer un défaut de recherche.
- Par défaut, ne merge pas ta propre PR : passe-la READY et rapporte le HEAD final. Merge uniquement sur instruction explicite de l'utilisateur/lead.

## 3. Sources de vérité à préserver

### Build / stats / légalité

`CompleteBuildEvaluator` reste la vérité finale pour :

- structure des slots ;
- conditions d'items ;
- bonus de panoplie ;
- caractéristiques ;
- FM ;
- contraintes finales.

L'UI ne doit pas dupliquer ces calculs.

### Sorts / combat

Le moteur de combat générique et `evaluateSpell` restent la vérité pour les dégâts et effets supportés.

Le moteur générique ne doit pas connaître directement un nom de classe, un nom de sort ou un ID spécial. Les exceptions passent par le registre/mécaniques déclaratives existants.

### Recherche d'équipements

- `CandidatePolicy` = pertinence, Pareto, spécialistes, contraintes et profils de recherche.
- `CandidatePrefilter` = frontière catalogue → pools de candidats.
- `SetCoreCatalog` = métadonnées et noyaux de panoplies.
- `CompleteBuildEvaluator` = validation finale de toute solution.

Un score offensif peut ordonner, jamais éliminer seul un candidat utile.

### Atelier

`WorkshopBuild` → `WorkshopController` → `WorkshopEvaluator` est la frontière applicative Atelier.

Un simple changement d'item ne doit jamais lancer Candidate Search, Architecture Search ou l'Optimizer Worker.

### Persistence

La cible V2 est IndexedDB pour les builds, recherches et résultats persistants. `localStorage` reste réservé aux petits flags/préférences triviales.

## 4. Invariants produit non négociables

1. Un résultat affiché respecte toutes les contraintes demandées.
2. Une contrainte active influence la conservation des candidats en amont.
3. Un item spécialiste ne disparaît pas uniquement parce qu'il est moins offensif seul.
4. La voie standalone reste disponible même lorsque des Set Cores existent.
5. Un seed ou un résultat en cache repasse les règles de compatibilité/version avant réutilisation.
6. Les dégâts affichés proviennent du moteur canonique.
7. Lock/Reject doivent être des données de requête, jamais des hacks DOM/Worker.
8. La mémoire locale ne doit jamais servir un résultat incompatible avec les versions de données/règles courantes.

## 5. Validation minimale avant READY

Toujours exécuter :

```bash
npm run check
npm test
```

Puis les benchmarks concernés :

```bash
npm run benchmark:v2
npm run benchmark:search
npm run benchmark:workshop
```

N'exécute que les benchmarks pertinents pendant les checkpoints, mais la CI finale doit rester verte.

Quand une tranche touche les sorts, utilise aussi :

```bash
npm run report:spell-support
```

## 6. Définition de READY

Une PR peut passer READY uniquement si :

- le scope annoncé est terminé ;
- les tests ciblés sont présents ;
- les tests historiques passent ;
- les benchmarks concernés ne montrent pas de régression inexpliquée ;
- la CI GitHub est verte ;
- `PROJECT_STATE.md` et les docs de migration sont à jour si nécessaire ;
- aucune dette hors scope n'a été introduite pour aller plus vite.

## 7. Reprise ultra-courte

Si tu dois reprendre sans contexte de conversation :

> Lis `AGENTS.md`, puis `PROJECT_STATE.md`, puis `docs/V2_COMPLETION_PLAN.md`. Prends uniquement la prochaine tranche indiquée, depuis le `main` mergé et vert.
