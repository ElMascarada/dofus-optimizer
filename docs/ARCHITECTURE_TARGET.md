# Dofus Optimizer V2 — Architecture cible

## Principes non négociables

1. Une seule entrée UI canonique.
2. Une seule source de version applicative.
3. Aucun patch global de `window.Worker`.
4. Aucun `MutationObserver` utilisé pour corriger l'UI principale après rendu.
5. Le moteur de combat générique ne connaît aucun nom de classe ou de sort.
6. Les mécaniques Iop, Huppermage et futures classes passent par un registre déclaratif.
7. Le préfiltrage équipement est une frontière unique et centralisée.
8. Les contraintes influencent la conservation des candidats avant le solveur.
9. Les constantes beam/search sont centralisées et versionnées comme politique de recherche.
10. Les résultats finaux passent par une seule évaluation de vérité.

## Couches cibles

```text
UI canonique
  -> Application / use-cases
    -> OptimizerClient
      -> SearchRepository (IndexedDB)
      -> Optimizer Worker
        -> CandidatePrefilter
        -> HybridSearch
          -> SeedSearch
          -> SetCoreSearch
          -> FreeSearch
        -> CompleteBuildEvaluator
        -> CombatEngine
          -> CombatMechanicRegistry
        -> ResultDiversifier
```

L'UI ne doit connaître ni les beams, ni les structures internes des pools, ni les règles spécifiques d'une classe.

## 1. UI canonique

La V2 doit avoir un seul bootstrap d'application. Il initialise :

- navigation Atelier / Optimiseur ;
- état local de l'application ;
- accès aux données ;
- `OptimizerClient` ;
- persistence ;
- rendu.

Les composants ajoutent leurs contrôles au moment du rendu. Aucun script externe ne doit observer le DOM afin d'ajouter ensuite une fonction manquante.

## 2. Métadonnées runtime

`js/runtime-meta.js` est la source runtime canonique introduite par la PR de fondation.

Elle porte les identifiants qui doivent invalider ou distinguer un résultat persistant :

- version applicative ;
- identité du cache service worker ;
- epoch du moteur/cache de recherche.

À terme, l'epoch de calcul peut devenir un hash/version structuré des politiques de recherche et du modèle combat, mais il ne doit jamais être éparpillé dans l'UI.

## 3. OptimizerClient

Interface cible entre l'application et le Worker :

```js
optimizerClient.search(request, { onProgress, signal })
optimizerClient.stop()
optimizerClient.finalizePartial()
```

Responsabilités :

- création et ownership du Worker ;
- protocole de messages ;
- annulation/arrêt ;
- finalisation partielle ;
- interrogation du cache exact ;
- écriture des résultats persistants.

Le Worker natif reste encapsulé dans cette couche. `window.Worker` n'est jamais remplacé.

## 4. Contrat de requête

Une requête d'optimisation devient un objet normalisé et sérialisable :

```text
OptimizerRequest
- classId
- element
- constraints
- temporalObjective
- fmPolicy
- scenario
- lockedItemIds
- rejectedItemIds
- diversity
- topN
- dataVersion
- engineEpoch
```

Les choix d'UI sont convertis une seule fois vers ce contrat. Le moteur ne lit jamais directement le DOM.

## 5. SearchRepository

Persistence V2 : IndexedDB.

Interface cible :

```js
repository.getExact(requestKey)
repository.putResult(requestKey, request, result)
repository.findNearby(request)
repository.saveBuild(build)
repository.listBuilds()
```

Le repository masque IndexedDB au reste du code. Une migration de stockage ne doit pas modifier le solveur.

## 6. CandidatePrefilter

Le préfiltrage devient l'unique endroit autorisé à transformer le catalogue complet en pools de candidats initiaux.

Entrées :

- catalogue ;
- élément ;
- contraintes ;
- locks/rejects ;
- politique de recherche ;
- éventuels seeds/cores.

Sorties :

- pools par slot ;
- réserves contraintes ;
- diagnostics expliquant les conservations/élagages.

Une contrainte positive doit réserver une voie de candidats capable de la satisfaire. La valeur offensive seule ne peut pas éliminer toutes les pièces nécessaires à une grosse Vitalité, Initiative, PO ou résistance.

## 7. HybridSearch

La recherche V2 combine :

- **SeedSearch** : voisins de résultats connus ;
- **SetCoreSearch** : cores de panoplies prometteurs ;
- **FreeSearch** : exploration indépendante.

Ces voies produisent toutes le même type `BuildCandidate`. Leur fusion ne contourne jamais `CompleteBuildEvaluator`.

## 8. SearchPolicy

Toutes les constantes de recherche sont regroupées dans une politique immutable :

```text
SearchPolicy
- slotPoolLimits
- groupChoiceLimits
- architectureBeamWidths
- constraintReserveWidths
- feedbackCandidateLimits
- combatBeamWidths
- interTurnWidths
- finalRefineLimits
```

La politique est injectée ou importée depuis une seule source. Les modules ne définissent plus leurs propres nombres magiques de beam/capacité.

Changer une politique doit :

- être visible dans la review ;
- invalider le cache concerné ;
- déclencher les benchmarks ;
- être distingué d'un changement de règles métier.

## 9. CompleteBuildEvaluator

`CompleteBuildEvaluator` reste la vérité finale pour :

- structure de slots ;
- conditions ;
- bonus de panoplie ;
- caractéristiques ;
- FM ;
- contraintes ;
- statistiques finales et temporelles.

Le préfiltrage peut être optimiste, mais aucun autre module ne peut déclarer un build valide à sa place.

## 10. CombatEngine

Le moteur générique manipule uniquement des concepts abstraits :

- action/sort ;
- coût de ressource ;
- dégâts ;
- modificateurs ;
- états ;
- durée ;
- cooldown ;
- charge ;
- événements de combat.

Interdit dans le moteur générique :

- `breedName === 'Huppermage'` ;
- `spell.name === ...` ;
- IDs de classe utilisés pour déclencher directement une mécanique ;
- branches spécifiques Iop/Huppermage/etc.

## 11. CombatMechanicRegistry

Les particularités sont déclarées dans un registre :

```text
CombatMechanicDefinition
- id
- matcher déclaratif
- state schema / initial state
- hooks déclaratifs
- modifiers / transitions
```

Le registre est construit par les données normalisées et les règles curatées. Le moteur appelle des hooks génériques sans savoir quelle classe les fournit.

La migration doit d'abord reproduire exactement les comportements existants avant toute extension.

## 12. Résultats et seeds

Un résultat persistant contient au minimum :

- requête normalisée ;
- build ;
- score ;
- plan combat ;
- diagnostics utiles ;
- versions de données/moteur ;
- date de calcul.

Un seed est un build connu réutilisé comme point de départ, jamais comme résultat automatiquement valide. Il repasse toujours les règles courantes.

## 13. Arrêt de recherche

L'arrêt est une capacité du client de recherche, pas un patch UI :

1. l'application demande l'arrêt ;
2. le client cesse l'exploration lourde ;
3. il conserve le dernier snapshot de candidats ;
4. il finalise les rotations nécessaires ;
5. il rend des résultats complets ou un état d'arrêt explicite.

## 14. Garde-fous de migration

Chaque migration doit conserver :

- fingerprints de résultats sur fixtures stables ;
- tests de contraintes ;
- tests de mécanique combat ;
- sortie d'arrêt manuel ;
- benchmark avant/après.

Une PR d'architecture ne mélange pas extraction structurelle et changement d'heuristique. Si un résultat d'optimisation change, le changement est traité comme une PR produit/solveur séparée.
