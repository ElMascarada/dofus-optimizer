# Dofus Optimizer V2 — Performance finale

Ce document enregistre la passe **Tranche 6 — Performance finale** et ses mesures reproductibles.

## Base

Base stricte avant optimisation :

`main@58918c98276004edf7fc7d0e570f34fbd8431603`

Aucun budget de recherche, beam, pool, profil ou contrainte n'a été réduit pour obtenir les gains ci-dessous.

## Méthode

Les mesures comparent le même workflow GitHub Actions sur le même runner class (`ubuntu-latest`, Node 22), avec deux exécutions indépendantes sur chaque tree :

- baseline `main@58918c98276004edf7fc7d0e570f34fbd8431603` : Optimizer CI #532, attempts 1 et 2 ;
- tree optimisé : `c63abf8cddf1cb73d4d2a32357afb83ee262b438`, Optimizer CI #535, attempts 1 et 2.

Le HEAD de code retenu après l'expérience finale est tree-identique à `c63abf8…` pour les fichiers concernés.

Les pourcentages ci-dessous utilisent la moyenne des deux mesures de chaque côté. Les temps absolus restent sensibles au bruit CI ; les fingerprints et diagnostics structurels servent de garde qualité.

## Gains mesurés

### Combat

| Cas | Baseline moyen | Optimisé moyen | Écart | Fingerprint |
| --- | ---: | ---: | ---: | --- |
| Mono-tour | 0,685 ms | 0,616 ms | **-10,1 %** | `400` inchangé |
| T1–T3 | 8,486 ms | 5,997 ms | **-29,3 %** | `960` inchangé |

Le benchmark `manual-stop-finalization` reste du même ordre de grandeur (sous la milliseconde) et conserve exactement le fingerprint `1:true`. Aucun gain n'est revendiqué sur ce micro-cas : le point important est l'absence de régression fonctionnelle de la finalisation après stop.

### Candidate Search

| Scénario | Baseline moyen | Optimisé moyen | Écart |
| --- | ---: | ---: | ---: |
| mono-element | 587,551 ms | 534,289 ms | **-9,1 %** |
| crit | 582,762 ms | 494,645 ms | **-15,1 %** |
| t1 | 552,655 ms | 497,490 ms | **-10,0 %** |
| initiative-5000 | 305,728 ms | 280,136 ms | **-8,4 %** |
| high-vitality | 185,870 ms | 171,622 ms | **-7,7 %** |
| multi | 311,113 ms | 293,620 ms | **-5,6 %** |
| resistance | 259,714 ms | 251,705 ms | **-3,1 %** |
| t1-t3 | 212,823 ms | 207,413 ms | **-2,5 %** |

Pour chaque scénario, les deux paires de runs conservent exactement les mêmes :

- `bestScore` ;
- `expandedStates` ;
- `evaluatedBuilds` ;
- `validBuilds` ;
- `architectureVariants` ;
- `bestOrigin`.

Le gain vient donc d'un calcul moins redondant, pas d'une réduction de l'espace de recherche.

## Changements retenus

### Search : enveloppes sûres réutilisées

`optimizer/candidate-search.js` réutilise désormais, par identité de contexte :

- les bornes maximales des groupes restants pour les contraintes ;
- les caps positifs de bonus de panoplies ;
- les caps offensifs des groupes restants ;
- le nombre de slots forgeables utilisé par l'upper bound.

Les caches sont des `WeakMap` indexés par les objets de contexte de la recherche courante. Ils n'introduisent ni persistence ni résultat obsolète entre requêtes.

`branchFeasibility()` accepte également une enveloppe pré-calculée et des stats courantes lorsqu'un appelant les possède déjà. Les tests vérifient qu'un calcul frais et un calcul réutilisé produisent exactement la même décision et la même borne.

### Combat : ranking calculé une fois

`js/turn-optimizer.js` conserve la même déduplication par `stateKey`, les mêmes beams et les mêmes formules, mais :

- calcule `damage + supportPotential` une seule fois par état unique avant tri ;
- calcule le `finalScore` une seule fois par finaliste avant classement final.

Auparavant, ces valeurs étaient recalculées à chaque comparaison du `sort`, donc plusieurs fois par état.

## Ce qui n'a pas été modifié

- `optimizer/search-profiles.js` : aucun beam/pool/budget changé ;
- `CandidatePolicy` / `CandidatePrefilter` ;
- `SetCoreCatalog` ;
- `CompleteBuildEvaluator` ;
- fingerprints de requête / Search Memory ;
- formules de dégâts ou objectifs temporels ;
- pipeline multi-tour cheap/coarse/precise déjà présent dans `combat-turn-refiner.js` ;
- parallélisation des finalistes : non ajoutée, faute de mesure démontrant qu'elle serait préférable au pipeline actuel ;
- GPU/WASM : non ajoutés.

## Expérience rejetée

Une mise en cache supplémentaire des descripteurs d'effets de sorts a été testée après le checkpoint performant. Elle n'a pas apporté de gain reproductible au-delà du ranking déjà optimisé. Elle a donc été retirée avant le HEAD final afin de ne pas conserver de complexité sans bénéfice mesuré.

## Validation qualité

La Tranche 6 doit rester valide uniquement si :

1. `npm run check` passe ;
2. `npm test` passe ;
3. `benchmark:v2`, `benchmark:search` et `benchmark:workshop` restent verts ;
4. les fingerprints V2 restent identiques ;
5. les diagnostics structurels Candidate Search restent identiques sur le fixture benchmark ;
6. les tests d'équivalence des enveloppes réutilisées passent ;
7. le comportement de stop/finalisation reste couvert par le fingerprint `1:true`.
