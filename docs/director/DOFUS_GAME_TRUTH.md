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

The default offensive benchmark is a stationary Poutch-style target:
- one target;
- immobile;
- always considered accessible/attackable;
- `0%` resistance in all four elements;
- does not attack the player;
- therefore enemy-originated damage is absent unless a scenario explicitly introduces it;
- self-generated states, HP costs and other self-effects still matter whenever the corresponding mechanic cares about them.

The optimizer is maximizing theoretical damage into this target, not solving movement/placement gameplay.

---

## 2. Dofus / Prysmaradite / passive resource rules

### Dofus Ocre

Status: `CONFIRMED_BY_DIRECTOR`

- Ocre gives `+1 PA` unconditionally as its base effect.
- Starting from T2, it can provide one additional PA when the character has not been hit.
- For the optimizer's default T2 benchmark, the "not hit" condition is considered satisfied because the Poutch does not attack during T1.
- Losing HP due to Sacrier's own passive does **not** count as being hit for this condition.
- The additional conditional PA is not constrained by the normal 12 PA equipment cap.

Director example:
- a build at 11 PA before Ocre becomes 12 PA from Ocre's base PA;
- Ocre's conditional bonus can then make the executable turn reach 13 PA.

### Dofus Vulbis

Status: `CONFIRMED_BY_DIRECTOR`

- T1: no conditional final-damage bonus.
- Starting from T2, if the character has not been hit, Vulbis grants `+10% final damage`.
- For the canonical Poutch T2 benchmark, this condition is considered satisfied because no enemy hits the player during T1.
- Sacrier self-HP loss/passive does **not** invalidate this condition.

### Ganymède

Status: `CONFIRMED_BY_DIRECTOR`

- Ganymède gives `+1 PA` as its base equipment/resource contribution and can therefore help reach 12 PA statically.
- On T1 its combat effect is `-1 PA`.
- On T2 its combat effect is `+2 PA`.
- These temporary combat modifications can move effective turn PA beyond the normal static/equipment cap.

Director example:
- a static 12 PA setup with Ganymède executes T1 at 11 PA;
- the corresponding T2 can execute at 14 PA.

### Mate Prysmaradite

Status: `CONFIRMED_BY_DIRECTOR` for the described variant; exact naming/timing of the larger variants remains open.

For the Mate variant described by the Director:
- base/static effect includes `+1 PA` and `-1 PM`;
- on T1 it provides an additional `+2 PA` combat effect;
- like Ocre/Ganymède temporary PA, this can push effective PA above the normal 12 PA equipment cap.

Director noted a broader family following the same principle, with stronger variants capable of temporary `+3 PA` / `+4 PA` effects while removing PM. Exact variant names, PM penalties and turn semantics must be confirmed separately before encoding them.

### Temporary PA above 12

Status: `CONFIRMED_BY_DIRECTOR`

The normal 12 PA limit must not clamp temporary combat PA granted by conditional/passive effects.

Known examples from Director discussion:
- Ocre conditional PA can reach 13 effective PA;
- Ganymède can reach 14 effective PA in the described T2 setup;
- Mate Prysmaradite can reach 14 effective PA in the described T1 setup.

Static/equipment PA and temporary in-combat PA must therefore be represented separately.

### Dofus Nébuleux

Status: `CONFIRMED_BY_DIRECTOR`

- odd turns: `+20% final damage`;
- even turns: `-10% final damage`.

Therefore:
- T1 = `+20% final damage`;
- T2 = `-10% final damage`.

This applies to damage dealt generally for the current optimizer contract.

---

## 3. Set-bonus rules

### No universal three-piece bonus

Status: `CONFIRMED_BY_DIRECTOR`

Set bonuses must be read from the actual set data. There is no universal rule saying every three-piece set grants exactly the same resource bonus.

Typical high-level pattern observed by the Director:
- many three-item sets grant around `+1 PA`;
- some grant `+1 PM` instead;
- individual sets can deliberately deviate substantially.

Do **not** normalize all three-piece sets to a generic PA/PM template.

### Harpinoplie

Status: `CONFIRMED_BY_DIRECTOR`

Harpinoplie is deliberately exceptional. Its unusually large three-piece resource/stat bonus is a real specificity of the set, resulting from a later buff to the set, not evidence of corrupt normalization merely because it exceeds the common pattern.

Therefore its actual set-bonus data must be evaluated as-is unless a source/version mismatch is independently proven.

---

## 4. Multiple damage lines and conditional spell damage

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
- **Accumulation**: uses a self-cast setup/buff before its damaging state.
- **Fureur**: one cast increases the damage of the following cast.
- **Colère de Iop**: charged/delayed damage three turns after its cast.
- **Zénith**: damage depends on remaining MP.
- **Tempête de Puissance**: two casts build states on one target; a later cast on another target can consume those states for improved damage on the first target.
- **Tumulte**: damage increases with the number of enemy entities in the area.
- **Pugilat**: damage scales through casts within the turn and resets each turn.

### Accumulation — Iop

Status: `CONFIRMED_BY_DIRECTOR`

- Setup is a self-cast boost.
- Setup costs `3 PA`.
- The setup cast deals `0` damage.
- From the following relevant cast/use onward, Accumulation's damage is increased.
- The setup/buff lasts `2 turns`.
- It can therefore be cast on T1 specifically to prepare increased T2 damage.
- The charge/buff is **not consumed** by the damaging use.

This is a canonical example of why T2 must be able to spend T1 PA on zero-damage preparation.

### Fureur — Iop

Status: `CONFIRMED_BY_DIRECTOR` for sequencing; exact expiry/reset details remain open.

- Casting Fureur once increases the damage of the following Fureur cast.
- The intended rotation therefore wants to use Fureur every turn when possible in order to maintain/access its increased next-cast damage.

Do not apply the increased damage to the same cast that creates the charge.

### Colère de Iop

Status: `CONFIRMED_BY_DIRECTOR` for the core timing.

- A T1 cast deals the normal/base damage.
- The charged high-damage version becomes available on T4, three turns after the initial cast.

The exact charged values and reset/recast window should come from current spell data/description rather than being guessed.

### Tempête de Puissance — Iop

Status: `CONFIRMED_BY_DIRECTOR`

Sequence confirmed by the Director:
1. cast 1 on target A: base damage and applies state 1 to A;
2. cast 2 on target A: base damage and advances A to state 2;
3. cast 3 on a **different target B**: base damage on B, applies state 1 to B, and consumes the two states on A to deal the improved damage associated with the mechanic to A.

Consequence for the strict canonical single-Poutch benchmark: the target-switch proc cannot be produced if there is literally no second enemy target available.

### Pugilat — Iop

Status: `CONFIRMED_BY_DIRECTOR` for reset/cast-cap semantics.

- The damage mechanic scales through repeated casts during the current turn.
- The progression resets each turn.
- Base cast limit is `4 casts per turn`.

Exact damage increment/tier values should be read from the current spell description/data.

### Tumulte — Iop

Status: `CONFIRMED_BY_DIRECTOR`

- Damage scaling counts **enemy entities** in the area.
- The canonical single-Poutch benchmark therefore uses the `1 enemy` damage tier.
- The optimizer may represent the spell as an explicit tier table (`1 enemy = ...`, `2 enemies = ...`, etc.) using current spell data for the numerical values.

Do not count the player or allied entities as enemy-entity scaling for Tumulte.

### Concentration — Iop

Status: `CONFIRMED_BY_DIRECTOR`

- The additional summon-specific damage line applies against summons.
- The canonical Poutch is not a summon target for this purpose.
- Therefore the summon-specific line is ignored for the canonical Poutch benchmark; only the ordinary applicable damage is counted.

### Erosion-dependent extra damage

Status: `PRODUCT_ASSUMPTION`

For the current canonical optimizer benchmark, erosion-dependent bonus damage is ignored rather than requiring the planner to build an erosion setup sequence.

Examples mentioned earlier include Destin / Punition style erosion-related extra damage. This is a deliberate optimizer simplification and must not be generalized into a claim about the real game's mechanics.

### Zénith and Cra Jugement baseline

Status: `PRODUCT_ASSUMPTION`

For the current optimizer benchmark, Zénith is treated at maximum damage all the time.

The same optimistic/max-damage treatment is used for Cra's Jugement in the analogous remaining-MP style case mentioned by the Director.

This is an explicit product assumption, not a generic rule that all unknown conditions are true.

---

## 5. Iop damage-amplification / entity mechanics

### Massacre

Status: `CONFIRMED_BY_DIRECTOR` for the core effect; exact duration/application timing remains open.

Massacre makes the affected enemy take `+15% damage`.

This is a target-side damage amplification and must be considered by a perfect-turn planner when the state can be applied in the modeled sequence.

### Conquête

Status: `CONFIRMED_BY_DIRECTOR` for the core effect; exact placement/trigger semantics remain open.

Conquête interacts with area damage:
- when an area-damage spell or qualifying area-damage weapon hits Conquête,
- Conquête sends back/deals an area effect around itself equal to `50%` of the damage it received.

Examples of source attacks mentioned by the Director include Tumulte, Zénith and some weapons.

This interaction is relevant to "perfect turn" damage and must not be omitted merely because Conquête itself is not a normal direct-damage spell. Exact positioning, target eligibility, recursion/exclusion and cast/timing details remain to be confirmed before implementation.

---

## 6. Common conditional-damage mechanic families

Status: `CONFIRMED_BY_DIRECTOR`

The optimizer must be prepared to represent at least these recurring mechanic families:

1. damage increased after `X` casts;
2. damage increased by the number of entities in an area;
3. additional/increased damage from remaining MP;
4. delayed/charged damage after `X` turns — examples include Punitive, Expiation, Colère;
5. additional damage related to erosion — although the current canonical benchmark deliberately ignores erosion-dependent bonus damage;
6. proc-driven damage where a setup spell enables later spell procs — notably Enutrof patterns where setup and proc spells belong to the same elemental route;
7. Huppermage element/state dependent damage — e.g. Drain / Runification using the relevant opponent elemental state, requiring an elemental setup first;
8. Huppermage elemental combinations that grant caster power and/or target vulnerability — e.g. Earth+Fire combination making the target take `+15%` damage according to the Director;
9. tiered spell damage requiring class-specific setup — examples: Glas, Rekop, Torrent Arcanique, with progression driven by Telefrag/cards/elemental-combination style mechanics.

Do not collapse all of these into one boolean `condition=true` mechanism.

---

## 7. Buff semantics

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

## 8. Director rule for uncertainty

Status: `CONFIRMED_BY_DIRECTOR`

There is **not** one universal fallback for every conditional damage line.

The correct behavior depends on the mechanic:
- model preparation/state when the condition is mechanically achievable and relevant;
- model delayed charges across turns when required;
- model counters/stacks/procs when required;
- use an explicit product assumption only where the Director has chosen one (for example max Zénith/Jugement baseline or ignoring erosion-dependent bonus damage);
- do not blindly enable an unknown condition merely because it gives more damage.

Every unresolved condition should remain visible in `OPEN_RULE_QUESTIONS.md` until its semantics are confirmed.
