# Dofus spell normalization coverage

- Generated: 2026-08-06T14:44:19.969310786+02:00
- Game version: 3.6.10.10 (main)
- Classes: 19
- Class spell references: 836
- SpellVariantData source records: 431
- Variant spell references added: 418
- Certified variants: 242
- Offensive candidates detected: 490
- Certified combat spells: 506
- Spells with deterministic buff/debuff: 216
- Support-only spells: 64
- Model: direct-damage-and-deterministic-combat-effects

## Coverage by class

- Iop: 31/44
- Crâ: 32/44
- Sacrieur: 30/44
- Eniripsa: 32/44
- Ouginak: 27/44
- Féca: 25/44
- Enutrof: 29/44
- Sram: 20/44
- Forgelance: 30/44
- Zobal: 27/44
- Pandawa: 27/44
- Sadida: 20/44
- Osamodas: 21/44
- Steamer: 21/44
- Huppermage: 33/44
- Ecaflip: 31/44
- Roublard: 18/44
- Eliotrope: 28/44
- Xélor: 24/44

## Deterministic combat modifier samples

- Iop · Ferveur: [{"scope":"self","stats":{"damageWater":19},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Eau"}]
- Iop · Épée Divine: [{"scope":"self","stats":{"damageAir":28},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Air"}]
- Iop · Concentration: [{"scope":"self","stats":{"damageEarth":24},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Terre"}]
- Iop · Puissance: [{"scope":"self","stats":{"power":300},"durationTurns":3,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Iop · Tempête de Puissance: [{"scope":"self","stats":{"damageFire":30},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Feu"}]
- Iop · Endurance: [{"scope":"self","stats":{"damageWater":34},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Eau"}]
- Iop · Vertu: [{"scope":"self","stats":{"power":50},"durationTurns":2,"description":"-#1{{~1~2 à -}}#2 Puissance"}]
- Iop · Épée de Iop: [{"scope":"self","stats":{"damageEarth":41},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Terre"}]
- Iop · Épée Céleste: [{"scope":"self","stats":{"damageAir":40},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Air"}]
- Iop · Précipitation: [{"scope":"self","stats":{"ap":5},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PA"}]
- Iop · Accumulation [variant]: [{"scope":"self","stats":{"damageEarth":26},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Terre"}]
- Iop · Agitation [variant]: [{"scope":"self","stats":{"mp":3},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PM"}]
- Iop · Rassemblement [variant]: [{"scope":"self","stats":{"damageFire":25},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Feu"}]
- Iop · Duel [variant]: [{"scope":"self","stats":{"mp":100},"durationTurns":1,"description":"-#1{{~1~2 à -}}#2 PM"}]
- Iop · Fendoir [variant]: [{"scope":"self","stats":{"damageWater":53},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Eau"}]
- Iop · Tumulte [variant]: [{"scope":"self","stats":{"damageFire":21},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Feu"}]
- Iop · Anneau Destructeur [variant]: [{"scope":"self","stats":{"damageAir":28},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Air"}]
- Crâ · Tirs Puissants: [{"scope":"self","stats":{"power":250},"durationTurns":1,"description":"#1{{~1~2 à }}#2 Puissance"},{"scope":"self","stats":{"crit":15},"durationTurns":1,"description":"#1{{~1~2 à }}#2% Critique"}]
- Crâ · Acuité Absolue: [{"scope":"self","stats":{"crit":15},"durationTurns":1,"description":"#1{{~1~2 à }}#2% Critique"}]
- Crâ · Flèche Assaillante [variant]: [{"scope":"self","stats":{"power":150},"durationTurns":1,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Crâ · Balise Tactique [variant]: [{"scope":"self","stats":{"power":40},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Crâ · Flèches Amoureuses [variant]: [{"scope":"self","stats":{"power":100},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Crâ · Pluie de Flèches [variant]: [{"scope":"self","stats":{"mp":20},"durationTurns":1,"description":"-#1{{~1~2 à -}}#2 Esquive PM"},{"scope":"self","stats":{"damageAir":23},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Air"}]
- Crâ · Flèche Boomerang [variant]: [{"scope":"self","stats":{"mp":2},"durationTurns":1,"description":"-#1{{~1~2 à -}}#2 PM"},{"scope":"self","stats":{"damageAir":29},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Air"}]
- Sacrieur · Mutilation: [{"scope":"self","stats":{"power":150},"durationTurns":1,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Sacrieur · Condensation: [{"scope":"self","stats":{"damageWater":25},"durationTurns":1,"description":"#1{{~1~2 à }}#2 dommages Eau"}]
- Sacrieur · Transfusion: [{"scope":"self","stats":{"damageNeutral":10},"durationTurns":1,"description":"Dommages Neutre : #1{{~1~2 à }}#2% <sprite name=\"PV\"> PV du lanceur"}]
- Sacrieur · Berserk: [{"scope":"self","stats":{"spellDamagePct":10},"durationTurns":1,"description":"#1{{~1~2 à }}#2% Dommages aux sorts"}]
- Sacrieur · Pacte de Sang [variant]: [{"scope":"self","stats":{"power":100},"durationTurns":3,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Sacrieur · Fluctuation [variant]: [{"scope":"self","stats":{"mp":2},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PM"}]

## Skipped reasons

- no-fixed-direct-damage-or-supported-buff: 282
- conditional-or-delayed-damage: 25
- best-element-damage: 23

## Certification scope

- Includes immediate fixed-element damage and life-steal hits at the highest spell level available to a level-200 character.
- Includes class spell variants exposed by the Dofus SpellVariants dataset; normalization fails if the source contains variant records but none can be mapped.
- Includes deterministic offensive self buffs and target damage-taken modifiers when their effect metadata is explicit.
- Critical hits must match the normal hit count and elements.
- Best-element, delayed, triggered or otherwise contextual damage is excluded rather than approximated.
- Unsupported contextual secondary effects are ignored rather than invented.
