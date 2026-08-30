# Dofus Optimizer — Director Truth: Cra / Ecaflip Spell Semantics

Status: living Director-owned addendum.

Purpose: capture current spell-sheet facts supplied directly by the Director (including screenshots) and separate them from unresolved semantic questions. These notes are authoritative for future audits/agent missions unless superseded later. They do not imply runtime support.

---

## Cra — spell-sheet facts from Director screenshots

### Tir Perçant

Source: `DIRECTOR_SCREENSHOT_2026-08-30`

Visible sheet:
- cost: `1 PA`;
- range: `1–6`, modifiable;
- per-target cast limit: `1`;
- max effect stacks: `1`;
- uses per turn: `2`;
- `25% Érosion` for `2 turns`;
- target state: `Dommages subis x115%`;
- spell also removes the effects of Tir Perçant;
- description says it erodes the target and increases damage it suffers until the next attack.

Director/runtime implication to preserve:
- this is a target-side damage-taken amplification mechanic, not caster Power/final damage;
- exact consumption ordering around "until the next attack" must be modeled from the spell semantics and must not be approximated as a permanent +15% vulnerability.

### Tirs Puissants

Source: `DIRECTOR_SCREENSHOT_2026-08-30`

Visible sheet:
- cost: `1 PA`;
- range: self (`0`);
- spell critical chance: `5%`;
- cooldown: `2` turns.

Normal effects for `1 turn`:
- `-3 Portée`;
- `+250 Puissance`;
- `+150 Dommages Poussée`;
- `+15% Critique`.

Critical effects for `1 turn`:
- `-3 Portée`;
- `+300 Puissance`;
- `+170 Dommages Poussée`;
- `+17% Critique`.

Perfect-turn implication:
- this is a zero/direct-damage offensive preparation action whose Power and Crit can materially change optimal equipment and subsequent spell expected damage;
- because the buff spell itself can crit, its normal/critical buff branches must be represented in expected/planned combat rather than replacing the spell with one static average statline without regard to later action ordering.

### Représailles

Source: `DIRECTOR_SCREENSHOT_2026-08-30`

Visible sheet:
- cost: `3 PA`;
- range: `3–6`, modifiable;
- spell critical chance: `25%`;
- max effect stacks: `1`;
- global cast limit: `1`;
- cooldown: `3` turns.

Normal effects:
- Neutral damage equal to `20%` of target eroded HP;
- `Pesanteur` for `1 turn`;
- target `Dommages subis x110%`.

Critical effects:
- Neutral damage equal to `25%` of target eroded HP;
- `Pesanteur` for `1 turn`;
- target `Dommages subis x110%`.

Product interaction:
- current canonical benchmark deliberately ignores erosion-dependent bonus damage unless this assumption is changed;
- the `x110%` target damage-taken amplification is nevertheless a separate offensive state and must not be discarded merely because the erosion-based direct damage is ignored.

Exact application timing (whether the cast's own erosion-based damage benefits from the newly-applied x110% state or the state begins afterward) remains to be certified before implementation.

### Sentinelle

Source: `DIRECTOR_SCREENSHOT_2026-08-30`

Visible sheet:
- cost: `2 PA`;
- range: self (`0`);
- global cast limit: `1`;
- cooldown: `5` turns;
- initial cooldown: `1` turn.

Visible effects include:
- `+20% Dommages distance` for `2 turns`;
- `+10 Portée` for `2 turns`;
- Sentinelle state / reveal effects;
- `-2% Dommages distance` for `2 turns`;
- `-1 Portée` for `2 turns`;
- effects removed after the stated duration.

Description says Sentinelle increases distance damage and Range and that the effects are reduced for each MP used.

Semantic rule to model:
- this is a stateful offensive buff whose current value changes with MP usage;
- do not treat `+20% distance damage` as a fixed two-turn bonus independent of movement;
- exact decrement timing (`-2% distance damage` and `-1 range` per MP used) and minimum/cap behavior should be certified from current spell semantics before implementation.

---

## Cra — known offensive preparation spells

The Director explicitly identified the following as relevant to perfect-turn planning:
- `Tirs Puissants`;
- `Tir Perçant`;
- `Sentinelle`;
- `Représailles` was additionally supplied as an offensive target-amplification example.

Other Cra buffs/conditions may exist; do not infer this list is exhaustive.

---

## Ecaflip — card-state critical scaling

Status: `CONFIRMED_BY_DIRECTOR` for mechanic family; exact arithmetic remains open.

- Ecaflip offensive effects depend on a card/hand state;
- spell casting builds cards and the build-up depends on spell AP cost, with `2 / 3 / 4 / 5 PA` costs explicitly cited;
- relevant Crit gain can range from roughly `+3%` with an empty/initial hand to `+18%` at maximum cards;
- therefore Crit is temporal and rotation-dependent rather than a static equipment-only property.

Before implementation, certify from current spell descriptions/data:
- exact cards gained per AP-cost tier;
- maximum hand size;
- exact Crit tier table;
- when the hand/bonuses update relative to the triggering cast;
- reset/consumption/turn persistence rules.

---

## Director source rule

Screenshots of current in-game/reference spell sheets are acceptable Director evidence for semantic clarification. Whenever the project data pipeline can recover the same fields automatically, prefer a reproducible versioned import while retaining this Director document as the semantic contract.
