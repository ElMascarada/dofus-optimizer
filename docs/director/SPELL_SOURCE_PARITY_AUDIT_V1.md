# Dofus Optimizer — Director Record: Spell Source Parity Audit V1

Status: `AUDIT_ACCEPTED_BY_DIRECTOR`

Audit base:
- repository base: `main@4f4a61475cedbe5a8d0c66b077dc0a010bb32fb6`
- Dofusdude version: `3.6.10.11`
- audit mode: read-only; no Search, smoke, CI, branch/PR/code changes by the audit agent.

## Director decision

Architecture selected: **Dofusdude + versioned semantic rules contract**.

Do not add a second primary data provider yet.

Reason:
- Dofusdude already exposes most of the static spell-sheet structure required by the product;
- the current optimizer normalizer deliberately discards or excludes a substantial amount of that raw information;
- advanced event semantics are only partially recoverable from the raw data and must not be guessed from labels/text alone;
- complex mechanics therefore require explicit, testable semantic rules when raw actions/triggers/scripts cannot be decoded deterministically.

## Additional Dofusdude assets found

The same `3.6.10.11` release contains additional spell-related assets not currently downloaded by the project pipeline:

- `spell_pairs.json`
- `spell_scripts.json`
- `spell_states.json`
- `spell_types.json`

No standalone `effect_instances.json` asset was identified; effect instances live in spell-level structures.

## Raw-data capability

Dofusdude can reconstruct, directly or by deterministic joins, a large part of the static spell sheet:

- spell identity/name/description linkage;
- AP cost;
- range min/max;
- crit rate;
- per-turn / per-target limits;
- cooldown and initial cooldown;
- zones;
- effect duration;
- normal vs critical effect lists;
- French effect labels;
- raw triggers;
- a substantial part of class-equipment spell modifications.

Text linkage is structurally:

`spells.json -> nameId/descriptionId -> fr.json.entries[...]`

and effect labels are structurally:

`spell_levels.json -> effectId -> effects.json -> descriptionId -> fr.json.entries[...]`

## Important current normalizer losses

The current normalizer keeps a deliberately narrow certified subset and therefore loses or excludes information that Dofusdude already contains.

Examples from the audit probes:

### Tirs Puissants

Raw data is rich enough to distinguish normal and critical branches and effect durations.

Current normalized representation keeps notably:
- `+250 Puissance`;
- `+15% Crit`;
- duration 1.

It currently loses/excludes, among other fields:
- `-3 PO`;
- push damage;
- critical branch `300 Puissance / 170 Dommages Poussée / 17% Crit`.

### Tir Perçant

Current catalog excludes it instead of approximating it.

Critical unresolved semantic rule:
- `x115% dommages subis` is consumed by the next attack;
- raw data inspected did not prove a generic machine-decodable `next attack consumes this effect` relation.

Treat as explicit semantic rule until decoded from versioned actions/scripts.

### Représailles

Raw structures can carry effects/durations/normal-vs-critical branches, but the formula based on eroded HP and exact state linkage were not proven fully machine-decodable in the audit.

The target-side `x110% dommages subis` is much closer to a generic reconstructible effect than the erosion formula.

### Sentinelle

Current normalized representation can expose the initial `+20% dommages distance` state, but the audit did not prove a generic machine relation for:

`each PM used -> -2% dommages distance and -1 PO`

Do not model Sentinelle as a static +20% damage buff for two turns.

## Class equipment

Dofusdude raw item effects can structurally refer to a spell via `spellId` and carry numeric effect data, duration and dispellability.

This is sufficient in principle to represent class-equipment modifications such as:
- `Tir Perçant: +1 lancer par cible`;
- `Représailles: -1 PA`.

However, the current product equipment scope excludes level-100 `Bottes Deuradi`, so this is also a current product-scope exclusion rather than a source-data limitation.

## Product interpretation

`dofusdudeCanReconstructFullSpellSheet=PARTIAL`

`dofusdudeCanDriveAdvancedCombatSemantics=PARTIAL`

The correct architectural separation is:

1. **Dofusdude = versioned factual game data**.
2. **Normalizer = lossless-enough structured import, with explicit coverage reports**.
3. **Semantic rules contract = versioned meaning for triggers/stateful mechanics that cannot be derived safely from raw structures**.
4. **Combat planner = applies those semantics in executable cast order**.
5. **Search = must not prune builds based on static assumptions that combat buffs/state can materially change**.

## Rules that still require explicit semantics unless future script decoding proves them generic

- consume an amplification on the next attack;
- decrement an effect per MP used;
- damage formulas based on eroded HP;
- versioned action/trigger/state/script decoding;
- some removal/dispell lifecycle behavior;
- class-specific state machines (cards, charges, telefrag/combinations, etc.).

## External providers

No second primary provider is justified by this audit.

DofusDB/DofusBook may remain parity/fallback references when manually verifying mechanics, but the product should not introduce them as required runtime/build dependencies unless a later audit proves Dofusdude structurally insufficient.

## Next architectural direction

Before further broad Search tuning, establish a versioned semantic layer that can consume enriched Dofusdude spell data while retaining Director-confirmed rules for mechanics that raw data cannot safely express.

Do not automatically enable every newly imported effect. Unknown semantics remain excluded/uncertain until explicitly supported.
