# Dofus Optimizer — Director Truth: Item Passives, Sacrier & Combat Buffs

Status: living Director-owned addendum.

Purpose: capture game rules and explicit product assumptions confirmed during the Director interview on 2026-08-30. These rules are authoritative for future audits/agent missions unless superseded later. They do not imply that Search/combat currently models them correctly.

---

## Sacrier — Souffrance

Status: `CONFIRMED_BY_DIRECTOR`

- Souffrance changes by HP-loss thresholds/paliers and updates in real time.
- Self-inflicted HP loss can change Souffrance during the same turn; later casts use the new state.
- At `50% HP or below`, the offensive value confirmed by the Director is `+10% final damage`.
- Berserk sets Sacrier to `30% HP`, so it places Sacrier in this offensive Souffrance range immediately.
- The previously mentioned damage-reduction value around `20%` is not yet certified and remains open.
- Self-inflicted HP loss does not count as an enemy hit for Ocre/Vulbis conditions.

### Berserk

Status: `CONFIRMED_BY_DIRECTOR`

- usable T1;
- sets Sacrier to `30% HP`;
- grants `+10% spell damage`;
- can immediately activate the <=50% Souffrance offensive state for later casts in the same turn.

### Mutilation

Status: `CONFIRMED_BY_DIRECTOR` for mechanic family.

- grants Power;
- causes Sacrier to lose HP over time/each turn;
- that loss can alter Souffrance in real time.

Exact values/timing remain data-driven/open.

### Punition

Status: `CONFIRMED_BY_DIRECTOR` + `PRODUCT_ASSUMPTION`.

- normal/base damage applies;
- extra damage can depend on erosion suffered by Sacrier;
- canonical perfect-turn benchmark ignores the erosion-dependent extra damage.

---

## Dofus Pourpre

Status: `CONFIRMED_BY_DIRECTOR`

- offensive stacks come only from enemy attacks received;
- canonical stationary Poutch does not attack, therefore canonical T1/T2 uses `0` Pourpre passive stacks unless a scenario explicitly introduces enemy attacks;
- Sacrier self-damage/self-HP loss does not generate Pourpre stacks;
- current accepted model stacks up to `+10% final damage`.

---

## Dofus Turquoise

Status: `CONFIRMED_BY_DIRECTOR`

- each critical spell cast grants `+1% final damage` for subsequent actions;
- the spell that creates the stack does not benefit from its own new stack;
- non-damaging/boost spells count if they can critically succeed;
- Director example: a critical `Puissance` cast grants the stack;
- stacks accumulate during the same turn;
- stacks persist T1 -> T2;
- Director example: five critical spells on T1 means `+5% final damage` at the beginning of T2;
- critical casts on T2 continue to buff subsequent T2 casts;
- a 100% crit rotation therefore gains one deterministic stack per crit-capable spell cast;
- the current accepted cap is 10 stacks.

For non-100% crit builds, this mechanic is temporal/probabilistic and must not be replaced by a static approximation that ignores cast ordering.

---

## Dofus Abyssal

Real item behavior accepted by Director:
- adjacent enemy -> temporary PA branch;
- no adjacent enemy -> temporary PM branch.

### Canonical optimizer treatment

Status: `PRODUCT_ASSUMPTION_CONFIRMED_BY_DIRECTOR`

For a class/rotation considered melee, the optimizer may deliberately use the PA branch.

Director examples include Iop, Ouginak, Sacrier and Zobal when relevant attacks are cast at `4 cells or less`.

- this temporary PA can exceed the normal static/equipment 12 PA cap;
- do not force the PA branch for every class/rotation;
- this is an explicit perfect-turn positioning simplification.

---

## Trompe-la-Mort

Status: `CONFIRMED_BY_DIRECTOR`

- above `50% HP`: `+7% final damage`;
- at or below `50% HP`: `20% incoming-damage reduction` instead.

Sacrier consequence:
- Berserk at 30% HP disables the +7% offensive branch;
- it activates the defensive 20% branch;
- that defense can coexist with Sacrier's defensive passive, although defense is outside the current max-damage objective.

---

## Prynyang

Status: `CONFIRMED_BY_DIRECTOR`

- T1: `+10% final damage`, `-10%` elemental resistances;
- T2: `+3% final damage`, `+3%` elemental resistances;
- T3: `-10% final damage`, `+10%` elemental resistances.

Static item stats are applied separately.

---

## Prycipithon family

Status: `CONFIRMED_BY_DIRECTOR`

Temporal effects:
- Prycipithon Mate: T1 `+2 PA`;
- Prycipithon Brillante: T1 `+3 PA`, `-2 PM`;
- Prycipithon Iridescente: T1 `+4 PA`, `-4 PM`.

Temporary PA can exceed the static/equipment 12 PA cap.

The PM penalties are not automatically free: for melee classes/rotations, losing PM can matter to the ability to execute the intended melee turn.

---

## Offensive preparation spells are part of the perfect turn

Status: `CONFIRMED_BY_DIRECTOR`

The optimizer must treat offensive self-buffs/setup spells as real candidate actions even when they deal zero direct damage.

Examples include:
- Sacrier `Douleur Cuisante` and other self-buffs;
- Sacrier `Nervosité`, which can grant critical chance;
- Ecaflip spells that grant critical chance;
- a Cra spell that grants critical chance;
- other class buffs that grant Power, final/spell damage, critical chance or another offensive state.

Core product rule:

> A perfect-turn planner must compare spending AP on a buff versus spending those AP directly on damage, and keep the buff whenever the resulting full-turn damage is higher.

This applies both to:
- T1 buffs that improve later T1 actions;
- T1 preparation that improves T2 when T2 is the target objective.

### Critical-chance buffs can change the optimal equipment

Status: `CONFIRMED_BY_DIRECTOR`

Search must not evaluate equipment only from its **static pre-combat critical chance**.

A class can enter the damage sequence with additional critical chance granted by spells/states. Therefore a lower-static-crit equipment structure can become the best damage structure once the class's executable crit buffs are included.

Consequences:
- crit buffs must modify crit probability for subsequent eligible actions according to their real timing/duration;
- Do Crit, base crit chance, crit penalties and crit-buff spells must be evaluated together;
- Search heuristics must not require a build to look like a coherent `crit build` before canonical combat evaluates the class buffs;
- this can materially change the ranking of gear such as crit/non-crit items, Do Crit sources, and items with negative Crit but stronger Power/other stats.

Exact values, PA costs and durations of each class crit-buff spell remain data/description-specific and must be verified individually rather than guessed.
