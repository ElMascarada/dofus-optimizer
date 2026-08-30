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

Confirmed:
- T1 cast deals base damage;
- charged high-damage state is available on T4.

Still needed only for exact implementation:
- charged-state validity window;
- reset/recast/consumption semantics;
- exact numerical lines from current spell data.

### Tempête de Puissance

Core sequence is resolved:
- casts 1 and 2 on target A build states 1 then 2;
- cast 3 on target B applies state 1 to B and consumes A's states for improved damage on A;
- strict one-target Poutch cannot execute the target-switch proc.

Still useful only if exact implementation needs it:
- exact improved damage values;
- exact reset/expiry duration of stored target states.

### Tumulte

Resolved at rule level:
- counts enemy entities in the area;
- canonical Poutch = one enemy tier;
- allies/player do not count.

Still needed only for exact implementation:
- numerical tier table;
- maximum/cap, if not explicit in current spell data.

### Pugilat

Resolved at rule level:
- repeated-cast progression is per turn;
- progression resets each turn;
- base limit = 4 casts/turn.

Still needed only for exact implementation:
- numerical damage progression for casts 1–4.

### Accumulation

Core sequencing is confirmed and documented:
- `3 PA`, self-cast, `0` damage setup;
- following use has increased damage;
- lasts `2 turns`;
- usable T1 to prepare T2;
- charge is not consumed.

Still useful if needed for exact implementation:
- exact numerical increased damage line/tier should come from current spell data/description.

### Zénith

Real MP-to-damage curve remains open, but current product assumption intentionally uses maximum damage.

### Massacre

Confirmed core rule:
- affected enemy takes `+15% damage`.

Still needed:
- exact PA cost / application method if not obvious in data;
- exact duration;
- whether the +15% applies immediately to the cast that establishes the state or only afterward;
- refresh/stack/removal semantics.

### Conquête

Confirmed core rule:
- Conquête must be placed on the same damage turn where its reflection is exploited;
- perfect-turn benchmark may position it next to the Poutch;
- an AoE may damage both Conquête and Poutch;
- direct Poutch damage counts normally;
- Conquête echoes `50%` of the damage it received around itself;
- that echo can hit and damage the nearby Poutch.

Still needed before exact canonical implementation:
- recursion/exclusion behavior (Conquête echo triggering itself/another Conquête or not);
- exact PA/cooldown/summon-lifetime constraints if not obvious in spell data;
- whether every area weapon qualifies under the same rule;
- any source-type exclusions.

### Erosion-dependent damage

Resolved as a product assumption for the current canonical optimizer:
- ignore erosion-dependent bonus damage.

Do not spend planner effort on erosion setup unless this contract is later changed.

---

## Priority A — Sacrier combat details

### Souffrance

Confirmed:
- Souffrance progresses by HP-loss thresholds/paliers;
- it updates in real time;
- self-inflicted HP loss can cross a threshold;
- later spells in the same turn use the updated Souffrance;
- perfect-turn planner may intentionally lose HP to increase later damage.

Still needed:
- exact number of Souffrance levels/paliers;
- exact HP thresholds;
- exact damage bonus per level or total maximum;
- exact damage-reduction values.

Director memory suggests values around `+10% damage` and around `20% damage reduction`, but these values are **not certified** and must not be encoded from memory.

### Berserk

Confirmed:
- usable T1;
- sets Sacrier to `30%` HP;
- grants `+10% spell damage`;
- can immediately change Souffrance for following actions.

Still needed if not already explicit in current spell data:
- PA cost;
- exact duration of the `+10% spell damage` buff;
- refresh/removal/cooldown semantics.

### Mutilation

Confirmed mechanic family:
- grants Power;
- removes HP each turn;
- HP loss can feed Souffrance progression.

Still needed:
- exact Power value;
- exact HP-loss amount/percentage;
- first tick timing;
- duration;
- stacking/refresh behavior.

### Punition

Core rule resolved:
- base damage always applies;
- extra damage can depend on erosion suffered by Sacrier;
- current canonical benchmark ignores the erosion-dependent extra damage.

Exact base/erosion lines should come from spell data rather than Director memory.

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
