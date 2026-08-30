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
- can immediately activate the <=50% Souffrance offensive state for later casts in the same turn;
- the offensive Berserk state persists without a fixed short duration while Sacrier remains at or below `50% HP`;
- if Sacrier heals back above `50% HP`, that Berserk offensive condition is lost.

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

### General Sacrier stacking timing

Status: `CONFIRMED_BY_DIRECTOR`

For the offensive stacking spells discussed below, the new stack/effect is applied **after** the cast that creates it.

Therefore:
- cast #1 uses the state that existed before cast #1, then grants stack #1;
- cast #2 benefits from stack #1, then grants stack #2;
- later casts benefit from both stacks when the effect is capped at two stacks.

The confirmed duration for Nervosité, Douleur Cuisante, Furie and Décimation is `2 turns`.

These two-turn stacks persist from T1 into T2 when created on T1, subject to their normal expiry timing.

### Nervosité

Status: `CONFIRMED_BY_DIRECTOR`.

- grants `+7% Crit` per stack;
- stacks up to `2` times;
- therefore can provide up to `+14% Crit` when fully stacked;
- duration: `2 turns`;
- the first cast does **not** benefit from the +7% it creates;
- the second Nervosité benefits from the first +7% stack, then creates the second stack;
- subsequent eligible casts benefit from the fully stacked value;
- T1 stacks can therefore prepare T2.

Exact PA cost should come from current spell data/description.

### Douleur Cuisante

Status: `CONFIRMED_BY_DIRECTOR`.

- grants `+60 Puissance` per stack;
- stacks up to `2` times;
- therefore can provide up to `+120 Puissance` when fully stacked;
- duration: `2 turns`;
- the first cast uses the pre-buff Power state, then grants +60 Power;
- the second cast benefits from the first +60 Power, then raises the state to +120 Power;
- subsequent eligible casts benefit from the fully stacked value;
- T1 stacks can therefore prepare T2.

Exact PA cost should come from current spell data/description.

### Furie

Status: `CONFIRMED_BY_DIRECTOR`.

- grants the caster `+3% final damage` per stack;
- stacks up to `2` times;
- therefore can provide up to `+6% final damage` to the caster;
- duration: `2 turns`;
- the newly-created stack applies **after** the damaging cast that created it;
- Furie #2 therefore benefits from the +3% created by Furie #1, then creates the second +3% stack;
- subsequent casts can benefit from the full +6% caster-side final-damage state;
- T1 stacks can therefore prepare T2.

Exact PA cost should come from current spell data/description.

### Décimation

Status: `CONFIRMED_BY_DIRECTOR`.

- makes the target take `+3% damage` per stack;
- stacks up to `2` times;
- therefore can make the affected target take up to `+6% damage` when fully stacked;
- duration: `2 turns`;
- the target-side amplification created by a cast applies **after** that cast;
- Décimation #2 therefore benefits from the target's +3% state created by Décimation #1, then raises the target state to +6%;
- later damaging actions can benefit from the full +6% target-side amplification;
- T1 stacks can therefore prepare T2 on the same target while they remain active.

This is target-side amplification and must remain distinct from caster final-damage bonuses such as Furie.

Exact PA cost should come from current spell data/description.

### Sacrier perfect-turn consequence

Status: `CONFIRMED_BY_DIRECTOR`

A canonical Sacrier damage turn may need to compare combinations of:
- Berserk / Souffrance;
- Crit gained from Nervosité;
- Power gained from Douleur Cuisante;
- caster final-damage stacking from Furie;
- target-side damage-taken stacking from Décimation;
- other direct-damage casts.

These effects must be applied in real cast order. Search must not rank gear only from pre-combat Crit/Power because the class can materially alter both during the executable rotation.

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
- Sacrier `Douleur Cuisante`, `Nervosité` and other self-buffs;
- Ecaflip card/state-driven critical chance buffs;
- Cra `Tirs Puissants`, `Tir Perçant`, `Sentinelle` as offensive-buff/setup spells whose current semantics are tracked separately in the Director class-spell truth;
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

### Ecaflip card-state critical scaling

Status: `CONFIRMED_BY_DIRECTOR` for the mechanic family; exact card arithmetic remains open.

- Ecaflip has offensive effects driven by a card/hand state;
- spell casts build cards, with the build-up related to spell PA costs (`2 / 3 / 4 / 5 PA` costs were explicitly cited by the Director);
- critical chance granted by the relevant state/effects ranges from about `+3% Crit` with no/very few cards to `+18% Crit` at maximum hand;
- therefore Ecaflip's effective Crit is stateful and can materially evolve through the rotation;
- Search must not use only static equipment Crit when evaluating Ecaflip structures.

Before exact implementation, the precise mapping `spell PA cost -> cards gained`, maximum hand size, exact crit tiers and reset/consumption rules must be read from current descriptions/data or confirmed separately.
