# Dofus Optimizer — Agent Guide

Ce fichier est le point d'entrée canonique pour tout nouvel agent ou toute nouvelle fenêtre ChatGPT qui reprend le dépôt.

## 1. Reprise obligatoire

Toujours partir du `main` mergé et vert, sauf si le Directeur impose explicitement une branche et un HEAD précis.

Avec un checkout local disponible :

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

## 2. Environnement agent et relais local utilisateur

Un agent ChatGPT peut disposer de GitHub sans disposer d'un checkout local utilisable, ou disposer de Git/Node/npm dans son shell mais sans accès réseau vers `github.com`.

**Cette situation n'est pas, à elle seule, un `ENVIRONMENT_BLOCKED`.**

Le projet distingue deux chemins complémentaires :

### A. GitHub = lecture / écriture / vérité distante

Si les outils GitHub disponibles permettent de :

- lire les fichiers ;
- inspecter branches, HEAD, PR, diff et CI ;
- créer ou modifier les fichiers de la branche ;
- créer des commits / pousser via les opérations GitHub disponibles ;

alors l'agent doit continuer la mission par ce chemin lorsqu'un shell local n'est pas nécessaire.

Ne demande pas Codespaces, Codex, ChatGPT Work ou une autre infrastructure simplement parce que le shell de l'agent ne peut pas cloner GitHub.

### B. Clone relais utilisateur = exécution locale ponctuelle

Lorsque la mission nécessite réellement Node/npm/Git local, génération de fichiers, tests ou smoke hors CI, le Directeur peut utiliser le clone relais local de l'utilisateur.

Chemin conventionnel actuel :

```text
~/dofus-agent
```

Préparation utilisateur, une seule fois :

```bash
git clone https://github.com/ElMascarada/dofus-optimizer.git ~/dofus-agent
cd ~/dofus-agent
npm install
```

Le relais n'est **pas** un shell distant donné à l'agent. Il fonctionne ainsi :

1. l'agent travaille normalement via GitHub ;
2. le Directeur fournit une commande locale exacte et courte ;
3. l'utilisateur exécute cette commande sur sa machine ;
4. l'utilisateur renvoie la sortie ;
5. l'agent utilise cette sortie comme preuve de validation pour le HEAD exact concerné.

Exemple de remise à zéro sûre d'une branche :

```bash
cd ~/dofus-agent \
&& git fetch origin \
&& git checkout -B <branche> origin/<branche> \
&& git reset --hard origin/<branche> \
&& git clean -fd \
&& echo "HEAD=$(git rev-parse HEAD)" \
&& git status --short
```

Exemple de validation :

```bash
cd ~/dofus-agent \
&& git fetch origin \
&& git reset --hard origin/<branche> \
&& npm run check \
&& npm test
```

### Règles de sécurité du relais

- Pas de daemon ni de boucle qui exécute automatiquement des fichiers récupérés depuis GitHub.
- Pas de SSH entrant ni de port à ouvrir pour un agent.
- Pas de `sudo`.
- Le clone relais reste dédié au dépôt Dofus Optimizer.
- Une commande locale doit être explicite, courte et liée à une branche / un HEAD précis.
- Par défaut, le relais valide seulement : il ne commit ni ne push automatiquement.
- Si une génération locale doit produire puis pousser des fichiers, cela doit être explicitement autorisé par le Directeur et visible dans la commande fournie à l'utilisateur.
- Une sortie locale ne certifie que le HEAD effectivement affiché par cette exécution.

### Quand utiliser `ENVIRONMENT_BLOCKED`

Utilise `ENVIRONMENT_BLOCKED` uniquement lorsqu'une étape indispensable ne peut être réalisée ni :

- avec les outils GitHub disponibles ;
- avec la CI GitHub ;
- ni avec une validation ponctuelle via le relais local utilisateur.

Ne stoppe donc pas une mission uniquement avec :

```text
aucun checkout local réel disponible dans l'environnement ChatGPT
```

si GitHub reste accessible et que le reste peut être déporté vers la CI ou le relais local.

## 3. Discipline de travail

- Une branche = une responsabilité claire.
- Une PR = un scope limité et testable.
- Pas de refactor opportuniste hors scope.
- Fais des checkpoints fréquents et garde `PROJECT_STATE.md` à jour en fin de tranche.
- Ne contourne jamais un test par suppression ou relâchement arbitraire d'un invariant.
- N'augmente pas simplement les beams/pools pour masquer un défaut de recherche.
- Par défaut, ne merge pas ta propre PR : passe-la READY et rapporte le HEAD final. Merge uniquement sur instruction explicite de l'utilisateur/lead.

## 4. Sources de vérité à préserver

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

## 5. Invariants produit non négociables

1. Un résultat affiché respecte toutes les contraintes demandées.
2. Une contrainte active influence la conservation des candidats en amont.
3. Un item spécialiste ne disparaît pas uniquement parce qu'il est moins offensif seul.
4. La voie standalone reste disponible même lorsque des Set Cores existent.
5. Un seed ou un résultat en cache repasse les règles de compatibilité/version avant réutilisation.
6. Les dégâts affichés proviennent du moteur canonique.
7. Lock/Reject doivent être des données de requête, jamais des hacks DOM/Worker.
8. La mémoire locale ne doit jamais servir un résultat incompatible avec les versions de données/règles courantes.

## 6. Validation minimale avant READY

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

Si l'agent ne possède pas de checkout local exploitable, ces validations peuvent être obtenues par la CI ou par le relais local utilisateur défini en section 2. L'agent doit toujours rapporter clairement la source de la validation et le HEAD exact.

## 7. Définition de READY

Une PR peut passer READY uniquement si :

- le scope annoncé est terminé ;
- les tests ciblés sont présents ;
- les tests historiques passent ;
- les benchmarks concernés ne montrent pas de régression inexpliquée ;
- la CI GitHub est verte ;
- `PROJECT_STATE.md` et les docs de migration sont à jour si nécessaire ;
- aucune dette hors scope n'a été introduite pour aller plus vite.

## 8. Reprise ultra-courte

Si tu dois reprendre sans contexte de conversation :

> Lis `AGENTS.md`, puis `PROJECT_STATE.md`, puis `docs/V2_COMPLETION_PLAN.md`. Prends uniquement la prochaine tranche indiquée, depuis le `main` mergé et vert ou depuis la branche/HEAD exact explicitement imposé par le Directeur. L'absence de checkout local ChatGPT n'est pas bloquante tant que GitHub, la CI ou le relais local utilisateur permettent d'exécuter la mission.
