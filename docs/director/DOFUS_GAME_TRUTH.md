# Dofus Optimizer — Director Game Truth

Status: living Director-owned contract.

Purpose: record game rules and explicit product assumptions confirmed by the project Director. These notes are authoritative for future audits/agent missions unless superseded by a later Director confirmation. They do not automatically imply that runtime/Search already models the rule correctly.

Source convention:
- `CONFIRMED_BY_DIRECTOR`: directly confirmed by the project Director.
- `PRODUCT_ASSUMPTION`: deliberate optimizer simplification/baseline chosen by the Director.
- `OPEN`: exact values/timing still need clarification; do not guess.

Last Director interview update: 2026-08-30.

---

## 1. Canonical combat baseline

### Stationary Poutch target

Status: `PRODUCT_ASSUMPTION`

The default offensive benchmark is a stationary Poutch-style target. The optimizer is trying to maximize damage on that fixed target rather than solve movement/placement gameplay.

Current intended baseline from Director discussion:
- single stationary target;
- target considered available/attackable;
- no enemy attack is assumed during the preparation sequence unless a scenario explicitly says otherwise;
- self-generated state changes and self-costs still matter when the corresponding game mechanic considers them relevant.

Exact target resistance baseline is still to be written explicitly if needed.

---

## 2. Dofus / companion / passive resource rules

### Dofus Ocre

Status: `CONFIRMED_BY_DIRECTOR`

- Ocre gives `+1 PA` unconditionally as its base effect.
- Starting from T2, it can provide one additional PA when the character has not been hit.
- For the optimizer's default T2 benchmark, the "not hit" condition is considered satisfied because no enemy attack is assumed during T1.
- Losing HP due to Sacrier's own passive does **not** count as being hit for this condition.
- The additional conditional PA is not constrained by the normal 12 PA equipment cap.

Director example:
- a build at 11 PA before Ocre becomes 12 PA from Ocre's base PA;
- Ocre's conditional bonus can then make the turn reach 13 PA.

Important distinction:
- equipment/static-resource cap and temporary in-combat PA are not the same thing;
- temporary/passive PA can push the executable turn above 12 PA.

### Ganymède

Status: `CONFIRMED_BY_DIRECTOR`

- Ganymède gives `+1 PA` as its base equipment/resource contribution and can therefore help reach 12 PA statically.
- On T1 its combat effect is `-1 PA`.
- On T2 its combat effect is `+2 PA`.
- These temporary combat modifications can move effective turn PA beyond the normal static/equipment cap.

Director example:
- a static 12 PA setup with Ganymède executes T1 at 11 PA;
- the corresponding T2 can execute at 14 PA.

### Temporary PA above 12

Status: `CONFIRMED_BY_DIRECTOR`

The normal 12 PA limit must not clamp temporary combat PA granted by conditional/passive effects.

Known examples from Director discussion:
- Ocre conditional PA can reach 13 effective PA;
- Ganymède can reach 14 effective PA in the described T2 setup;
- Mate Prysmaradite can also produce effective PA above the static cap in applicable conditions.

Exact Mate Prysmaradite rule remains to be documented separately.

### Dofus Vulbis

Status: `OPEN`

Director confirmed that its relevant trigger behavior is analogous to Ocre with respect to "not being hit" and the default T2 assumption, but the exact bonus value/timing still needs to be written explicitly before this file treats it as fully specified.

Do not invent missing details.

### Dofus Nébuleux

Status: `CONFIRMED_BY_DIRECTOR`

- odd turns: `+20% final damage`;
- even turns: `-10% final damage`.

Therefore:
- T1 = `+20% final damage`;
- T2 = `-10% final damage`.

This applies to the damage dealt generally; no additional restriction was identified by the Director for the current optimizer contract.

---

## 3. Multiple damage lines and conditional spell damage

### General rule

Status: `CONFIRMED_BY_DIRECTOR`

Multiple damage lines in spell data cannot be blindly summed or classified without understanding the spell description/mechanic.

A second or additional damage line can represent very different mechanics, including:
- extra damage against summons;
- a charged/recast version;
- damage after a number of casts;
- damage depending on remaining MP;
- damage depending on entities in an area;
- damage unlocked after a turn delay;
- damage depending on erosion;
- proc-based additional damage;
- element/state dependent damage;
- tiered damage built through class-specific mechanics.

Therefore:

> Spell description/mechanic semantics are required to interpret ambiguous multi-line damage data.

Unknown lines must not simply be assumed to apply simultaneously.

### Important Iop examples

Status: `CONFIRMED_BY_DIRECTOR` for mechanic family; exact numeric thresholds remain data-specific unless separately confirmed.

- **Concentration**: has additional damage relevant against summons.
- **Accumulation**: charges on self once, then has increased damage.
- **Fureur**: charges with each cast.
- **Colère de Iop**: charged/delayed damage three turns after its cast.
- **Zénith**: damage depends on remaining MP.
- **Tempête de Puissance**: damage charging depends on repeated casts on a target and then a target change mechanic.
- **Tumulte**: damage increases with entities in the area.
- **Pugilat**: damage increases with casts.

### Zénith and Cra Jugement baseline

Status: `PRODUCT_ASSUMPTION`

For the current optimizer benchmark, Zénith is treated at maximum damage all the time.

The same optimistic/max-damage treatment is used for Cra's Jugement in the analogous remaining-MP style case mentioned by the Director.

This is an explicit product assumption, not a generic rule that all unknown conditions are true.

---

## 4. Common conditional-damage mechanic families

Status: `CONFIRMED_BY_DIRECTOR`

The optimizer must be prepared to represent at least these recurring mechanic families:

1. damage increased after `X` casts;
2. damage increased by the number of entities in an area;
3. additional/increased damage from remaining MP;
4. delayed/charged damage after `X` turns — examples include Punitive, Expiation, Colère;
5. additional damage related to erosion — examples include Destin / Punition;
6. proc-driven damage where a setup spell enables later spell procs — notably Enutrof patterns where setup and proc spells belong to the same elemental route;
7. Huppermage element/state dependent damage — e.g. Drain / Runification using the relevant opponent elemental state, requiring an elemental setup first;
8. Huppermage elemental combinations that grant caster power and/or target vulnerability — e.g. Earth+Fire combination making the target take `+15%` damage according to the Director;
9. tiered spell damage requiring class-specific setup — examples: Glas, Rekop, Torrent Arcanique, with progression driven by Telefrag/cards/elemental-combination style mechanics.

Do not collapse all of these into one boolean `condition=true` mechanism.

---

## 5. Buff semantics

### General damage buffs

Status: `CONFIRMED_BY_DIRECTOR`

When a spell/state says that the character gains a general damage bonus such as `+20% damage`, this should be modeled as a persistent combat state/buff for its real duration/state, not as a one-cast-only modifier on the spell that created it.

The current game does not use a generic pattern of "general +damage applies only to the next single cast" for the examples under discussion.

Examples mentioned by the Director:
- Cra Sentinelle;
- Zobal masks — only one mask can be active at a time, and changing mask removes/replaces the previous mask's bonuses;
- Sacrier Berserk/passive;
- Pandawa Brassage;
- Huppermage Earth+Fire combination vulnerability.

Each mechanic still needs its own duration/state/removal semantics; "persistent" does not mean permanent forever.

---

## 6. Director rule for uncertainty

Status: `CONFIRMED_BY_DIRECTOR`

There is **not** one universal fallback for every conditional damage line.

The correct behavior depends on the mechanic:
- model preparation/state when the condition is mechanically achievable and relevant;
- model delayed charges across turns when required;
- model counters/stacks/procs when required;
- use an explicit product assumption only where the Director has chosen one (for example max Zénith/Jugement baseline);
- do not blindly enable an unknown condition merely because it gives more damage.

Every unresolved condition should remain visible in `OPEN_RULE_QUESTIONS.md` until its semantics are confirmed.
