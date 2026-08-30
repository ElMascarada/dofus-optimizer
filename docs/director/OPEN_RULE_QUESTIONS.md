# Dofus Optimizer — Open Director Rule Questions

Purpose: unresolved game-rule questions that future agents must not guess. Answers confirmed by the Director are promoted into `DOFUS_GAME_TRUTH.md`.

Last update: 2026-08-30.

---

## Priority A — directly changes T1/T2 damage truth

### Vulbis

Director confirmed trigger behavior analogous to Ocre with respect to being hit / default T2 no-enemy-hit assumption.

Still needed:
- exact damage bonus value;
- exact first turn where it can activate;
- whether it is active on T1;
- whether self-damage / Sacrier HP loss affects its trigger;
- exact duration / reevaluation timing.

### Mate Prysmaradite

Known only from Director example that it can push effective PA above the static 12 PA cap.

Still needed:
- base/static stats;
- trigger;
- PA amount;
- first active turn;
- whether condition is considered acquired in canonical T1/T2 baseline.

### Poutch resistance baseline

Canonical target is a stationary Poutch-style target.

Still needed only if not already implicit in combat scenario:
- explicit target resistance value(s), expected to define the baseline damage contract.

---

## Priority A — spell mechanic details

The mechanic family is confirmed; exact values/thresholds should come from reliable spell descriptions/data or Director clarification.

### Iop

- Concentration: exact summon-only extra line semantics and whether normal target receives only base line.
- Accumulation: exact charging threshold, duration, consumption/reset behavior.
- Fureur: exact stack gain per cast, maximum, duration/reset.
- Colère de Iop: exact delayed charge timing and reset/recast semantics.
- Zénith: real MP-to-damage curve (product assumption currently uses max damage).
- Tempête de Puissance: exact number of casts / same-target / target-change condition and resulting damage tier.
- Tumulte: exact entity-count scaling/cap.
- Pugilat: exact per-cast scaling/cap.

### Cra

- Jugement: real MP/condition curve (product assumption currently uses max damage).
- Punitive / Expiation: exact delayed charging timing and reset semantics.
- Sentinelle: exact damage bonus, duration and removal semantics.

### Huppermage

- Drain / Runification: exact element-state selection and setup requirements.
- Earth+Fire combination: confirm exact `+15% damage taken` value, duration, stacking/reset and whether it is target-specific.
- caster Power gained from elemental combinations: exact values/durations/stack rules.
- Torrent Arcanique: exact tier mechanic and thresholds.

### Enutrof

- exact proc setup spell(s), proc-consuming/triggering spells, proc amount, duration and reset semantics.

### Other tiered/charged spells

- Glas: exact build-up resource, thresholds, reset/consumption.
- Rekop: exact build-up resource, thresholds, reset/consumption.

---

## Priority B — persistent buff/state semantics

Need exact values/durations for examples already confirmed as stateful rather than one-cast modifiers:

- Zobal masks: exact bonuses by mask, mutual exclusivity, transition/removal timing.
- Sacrier Berserk/passive: exact damage scaling/state inputs and whether HP loss counts as being 'hit' for each unrelated passive condition.
- Pandawa Brassage: exact damage bonus/duration/state requirements.
- Cra Sentinelle: exact values/duration.

---

## Rule for agents

If one of these questions is required to make a product decision:

1. do not guess;
2. inspect authoritative data/description if available;
3. if still ambiguous, ask the Director;
4. record the answer in `DOFUS_GAME_TRUTH.md` before building a Search/combat assumption on top of it.
