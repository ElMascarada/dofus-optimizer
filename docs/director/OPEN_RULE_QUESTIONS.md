# Dofus Optimizer — Open Director Rule Questions

Purpose: unresolved game-rule questions that future agents must not guess. Answers confirmed by the Director are promoted into `DOFUS_GAME_TRUTH.md`.

Last update: 2026-08-30.

---

## Priority A — directly changes T1/T2 damage truth

### Mate Prysmaradite family

The Director confirmed for the described Mate variant:
- base `+1 PA / -1 PM`;
- T1 temporary `+2 PA`;
- temporary PA can exceed the static 12 PA cap.

Still needed before encoding the whole family:
- exact names/tiers of the variants providing temporary `+3 PA` and `+4 PA`;
- exact PM penalties of each variant;
- exact T2/later-turn semantics and duration for each variant.

---

## Priority A — Iop spell mechanic details

The mechanic family is confirmed; exact values/thresholds should come from reliable spell descriptions/data or Director clarification.

### Concentration

Still needed:
- exact extra-damage-vs-summon line semantics;
- whether the normal Poutch receives only the ordinary line.

### Fureur

Confirmed:
- one cast increases the damage of the following cast;
- increased damage is not applied to the same cast that creates the charge;
- regular repeated use is desirable to keep accessing the increased cast.

Still needed:
- exact buff duration / expiry;
- whether only one charge/tier exists or multiple tiers can accumulate;
- exact reset/refresh behavior if a turn is skipped.

### Colère de Iop

Still needed:
- exact delayed-charge timing from cast to charged cast;
- whether the charged state has a validity window;
- reset/recast/consumption semantics.

### Tempête de Puissance

Still needed:
- exact number of casts required;
- exact same-target requirement;
- exact target-change condition;
- resulting damage tier(s);
- reset semantics.

### Tumulte

Still needed:
- exact entity-count scaling;
- what counts as an entity;
- maximum/cap if any;
- canonical Poutch assumption to use for entity count.

### Pugilat

Still needed:
- exact per-cast scaling;
- whether scaling applies immediately or to following casts;
- maximum/cap;
- per-turn vs persistent reset semantics.

### Accumulation

Core sequencing is now confirmed and documented:
- `3 PA`, self-cast, `0` damage setup;
- following use has increased damage;
- lasts `2 turns`;
- usable T1 to prepare T2;
- charge is not consumed.

Still useful if needed for exact implementation:
- exact numerical increased damage line/tier should come from current spell data/description.

### Zénith

Real MP-to-damage curve remains open, but current product assumption intentionally uses maximum damage.

---

## Priority A — Cra spell mechanic details

### Jugement

Real condition/MP curve remains open, but current product assumption intentionally uses maximum damage.

### Punitive / Expiation

Still needed:
- exact delayed charging timing;
- reset/recast/consumption semantics.

### Sentinelle

Still needed:
- exact damage bonus;
- duration;
- removal/refresh semantics.

---

## Priority A — Huppermage

- Drain / Runification: exact element-state selection and setup requirements.
- Earth+Fire combination: exact `+15% damage taken` duration, stacking/reset and target specificity.
- caster Power gained from elemental combinations: exact values/durations/stack rules.
- Torrent Arcanique: exact tier mechanic and thresholds.

---

## Priority A — Enutrof

- exact proc setup spell(s);
- proc-triggering spells;
- proc amount;
- duration;
- whether proc is consumed or repeatable;
- reset semantics.

---

## Priority A — other tiered/charged spells

### Glas

- exact build-up resource;
- thresholds;
- reset/consumption.

### Rekop

- exact build-up resource;
- thresholds;
- reset/consumption.

---

## Priority B — persistent buff/state semantics

Need exact values/durations for examples already confirmed as stateful rather than one-cast modifiers:

- Zobal masks: exact bonuses by mask, mutual exclusivity, transition/removal timing.
- Sacrier Berserk/passive: exact damage scaling/state inputs and interaction with unrelated "being hit" conditions where relevant.
- Pandawa Brassage: exact damage bonus/duration/state requirements.
- Cra Sentinelle: exact values/duration.

---

## Priority B — set/data interpretation

### Harpinoplie

Resolved at rule level:
- large three-piece bonus is a real intentional exception;
- set bonuses differ by set;
- do not force generic `3 pieces = +1 PA` normalization.

Only reopen this if current source data/version specifically contradicts the repo values.

---

## Rule for agents

If one of these questions is required to make a product decision:

1. do not guess;
2. inspect authoritative data/description if available;
3. if still ambiguous, ask the Director;
4. record the answer in `DOFUS_GAME_TRUTH.md` before building a Search/combat assumption on top of it.
