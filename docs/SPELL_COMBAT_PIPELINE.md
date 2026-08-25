# Optimizer V2 — Pipeline sorts/combat et registre de mécaniques

## Objet

Cette migration rend le runtime de combat générique sans modifier l'UI, la recherche d'équipements, le stockage local, les règles de stuff, les beams ni l'équilibrage.

Le comportement de référence reste celui capturé avant migration par `tests/v2-regression-baseline.test.mjs` et `scripts/benchmark-v2-baseline.mjs`.

## Chemin complet d'un sort

```text
Données Ankama / DofusDude
  -> js/dofus-spell-normalizer.js
     - sélection du niveau 200
     - lignes de dégâts fixes
     - critiques
     - portée / coût PA / limites / cooldown
     - modificateurs déterministes
  -> js/spell-combat-effects.js
     - lecture des définitions d'effets Ankama
     - extraction des buffs/debuffs déterministes
  -> js/curated-runtime-rules.js
     - délégation des exceptions sort au CombatMechanicRegistry
  -> js/combat/mechanics/*
     - modules spécifiques déclarés hors moteur générique
  -> js/combat/effects.js
     - projection vers les effets runtime génériques
  -> js/turn-optimizer.js
     - exploration de rotation générique
  -> js/spells.js
     - calcul élémentaire / critique / multiplicateurs génériques
  -> js/spell-evaluator.js
     - évaluation immédiate d'un sort hors recherche d'équipement
```

## Audit avant migration

### `js/turn-optimizer.js`

Le moteur connaissait directement Huppermage :

- reconnaissance par `breedId` / `breedName` ;
- état `hupperTarget` ;
- détection de la paire Terre + Feu ;
- application directe de +15 % de dommages subis ;
- prise en compte spécifique de cet état dans la signature de recherche et le potentiel de support.

### `js/spells.js`

Le calcul de dégâts contenait une liste d'IDs de sorts Huppermage afin de savoir que quatre lignes élémentaires signifient « choisir une ligne » et non quatre impacts simultanés.

### `js/curated-runtime-rules.js`

Le point d'entrée générique des règles curatées contenait directement les IDs et la logique de :

- Concentration ;
- Précipitation ;
- Accumulation.

Ces règles utilisaient déjà des structures génériques utiles (`combatModifiers`, `delayedCombatModifiers`, `selfCharge`) ; elles ont donc été déplacées, pas réinventées.

### `js/combat-state.js`

La structure des modificateurs temporisés était générique. Seul un commentaire citait une mécanique Iop ; aucune logique de classe n'y était nécessaire.

## Architecture après migration

```text
js/
├── turn-optimizer.js                 # moteur de rotation générique
├── combat-state.js                   # modificateurs temporisés génériques
├── spells.js                         # dégâts génériques
├── spell-evaluator.js                # evaluateSpell(...)
├── spell-support.js                  # FULL/PARTIAL/CURATED/UNSUPPORTED
└── combat/
    ├── effects.js                    # modèle + interpréteur d'effets
    └── mechanics/
        ├── registry.js               # registry générique
        ├── default-registry.js       # composition des modules
        ├── iop.js                    # règles spécifiques Iop
        └── huppermage.js             # règles spécifiques Huppermage
```

`js/combat-mechanics-registry.js` reste uniquement un point de compatibilité qui réexporte le registry canonique ; il n'introduit pas un second système.

Le moteur générique ne contient plus de branche sur un nom de classe, un nom de sort ou un ID de sort curaté. Un test de frontière l'interdit explicitement.

## Effets génériques disponibles

`js/combat/effects.js` expose les familles suivantes :

- `Damage`
- `StatModifier`
- `TargetModifier`
- `DelayedEffect`
- `SpellCharge`
- `State`
- `ConsumeState`
- `Cooldown`
- `CastLimit`
- `Conditional`

Les champs runtime historiques sont projetés vers ce modèle au moment de l'exécution. Cette projection permet de migrer sans dupliquer l'état ni modifier le snapshot de données pour cette PR.

## Registry de mécaniques

Une définition peut déclarer :

- un `id` ;
- un `matcher` générique (`breedIds`, `breedAnkamaIds`, `spellIds`, `spellAnkamaIds`, `tags`) ;
- un `prepareSpell` pour enrichir une définition runtime ;
- des hooks génériques, actuellement `afterDamage`, qui retournent exclusivement des effets génériques.

Le moteur appelle `prepareSpell` et `hookEffects` sans connaître le module ayant fourni la règle.

### Iop

Le module Iop porte :

- Concentration : exclusion de la ligne réservée aux invocations sur la cible normale ;
- Précipitation : dette de -5 PA au tour suivant ;
- Accumulation : charge du sort lors d'un lancer sur soi.

### Huppermage

Le module Huppermage porte :

- la sélection d'une seule branche pour les sorts à quatre lignes conditionnelles ;
- l'état élémentaire de cible ;
- la combinaison Terre/Feu ;
- le +15 % de dommages subis appliqué aux lancers suivants.

L'état élémentaire est désormais un `State` générique et la vulnérabilité un `TargetModifier` générique.

## Rapport de support des sorts

`js/spell-support.js` expose :

```js
classifySpellSupport(spell)
buildSpellSupportReport({ spells, breeds })
```

Statuts :

- `FULL` : toutes les mécaniques runtime connues du sort sont représentées par le modèle générique ;
- `PARTIAL` : le sort est exécutable mais la normalisation signale des effets contextuels ignorés ;
- `CURATED` : au moins une règle mécanique manuelle/curatée complète la donnée normalisée ;
- `UNSUPPORTED` : aucun comportement exécutable fiable n'est disponible, ou le sort n'entre pas dans le catalogue runtime certifié.

Le rapport par classe utilise `sourceSpellCount` pour compter explicitement les sorts absents du runtime comme `UNSUPPORTED`. Ils ne sont donc jamais présentés comme silencieusement supportés.

`validateSpellSnapshot()` attache le statut à chaque sort runtime et expose `supportReport` sur le catalogue chargé.

## API préparatoire Atelier

`js/spell-evaluator.js` expose :

```js
evaluateSpell(spell, characterStats, combatState)
```

La réponse contient notamment :

- `supportStatus` / `supportReason` ;
- `normalDamage` ;
- `criticalDamage` ;
- `expectedDamage` ;
- `effectsApplied` ;
- `nextCombatState`.

Cette API utilise le même calcul de dégâts, les mêmes modificateurs et le même registry que le solveur de rotation. Elle ne lance aucune recherche d'équipement.

Un sort `UNSUPPORTED` renvoie des dégâts à `null` et un statut explicite au lieu d'être évalué comme s'il était compris.

## Baseline fonctionnelle avant migration

Capture GitHub Actions de la PR de benchmark pré-refactor : **201/201 tests verts**.

Fingerprints de `npm run benchmark:v2` :

| Scénario | Fingerprint avant |
|---|---:|
| mono-turn | `400` |
| T1-T3 | `960` |
| constraints-ap-mp | `ok:12/6` |
| constraint-initiative | `true` |
| constraint-vitality | `true` |
| constraint-resistance | `true` |
| set-bonus | `2:80` |
| buff-state | `buff:320` |
| manual-stop-finalization | `1:true` |

Les temps de la capture sont indicatifs uniquement : mono-turn 0,325 ms médiane et T1-T3 4,012 ms médiane sur le runner de référence. Les fingerprints, eux, doivent rester identiques.

## Garde-fous de cette migration

- tests unitaires des dix familles d'effets ;
- tests unitaires du registry et des modules Iop/Huppermage ;
- tests des scénarios Iop multi-tour existants ;
- fingerprint Huppermage Terre/Feu conservé à 135 ;
- test statique interdisant les identités Iop/Huppermage et IDs curatés dans le moteur générique ;
- tests de `evaluateSpell` ;
- tests du rapport de support ;
- baseline V2 et benchmark exécutés par la CI existante.

## Hors scope conservé

Cette PR ne touche pas :

- l'UI ;
- le préfiltrage d'items ;
- la recherche d'équipements ;
- les beams ;
- les règles de stuff ;
- IndexedDB / stockage local ;
- les Set Cores ;
- l'équilibrage.
