# Dofus spell normalization coverage

- Generated: 2026-08-06T14:44:19.969310786+02:00
- Game version: 3.6.10.10 (main)
- Classes: 19
- Class spell references: 836
- SpellVariantData source records: 431
- Variant spell references added: 418
- Certified variants: 239
- Offensive candidates detected: 490
- Certified combat spells: 488
- Spells with deterministic buff/debuff: 78
- Support-only spells: 46
- Model: direct-damage-and-deterministic-combat-effects

## Coverage by class

- Iop: 29/44
- Crâ: 33/44
- Sacrieur: 26/44
- Eniripsa: 32/44
- Ouginak: 26/44
- Féca: 25/44
- Enutrof: 28/44
- Sram: 21/44
- Forgelance: 30/44
- Zobal: 28/44
- Pandawa: 25/44
- Sadida: 19/44
- Osamodas: 21/44
- Steamer: 20/44
- Huppermage: 31/44
- Ecaflip: 28/44
- Roublard: 16/44
- Eliotrope: 27/44
- Xélor: 23/44

## Deterministic combat modifier samples

- Iop · Épée Divine: [{"scope":"self","stats":{"damage":30},"durationTurns":4,"description":"#1{{~1~2 à }}#2 Dommage{{~ps}}{{~zs}}"}]
- Iop · Puissance: [{"scope":"self","stats":{"power":300},"durationTurns":3,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Iop · Précipitation: [{"scope":"self","stats":{"ap":5},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PA"}]
- Iop · Agitation [variant]: [{"scope":"self","stats":{"mp":3},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PM"}]
- Crâ · Tirs Puissants: [{"scope":"self","stats":{"power":250},"durationTurns":1,"description":"#1{{~1~2 à }}#2 Puissance"},{"scope":"self","stats":{"crit":15},"durationTurns":1,"description":"#1{{~1~2 à }}#2% Critique"}]
- Crâ · Acuité Absolue: [{"scope":"self","stats":{"crit":15},"durationTurns":1,"description":"#1{{~1~2 à }}#2% Critique"}]
- Crâ · Flèche Assaillante [variant]: [{"scope":"self","stats":{"power":150},"durationTurns":1,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Crâ · Balise Tactique [variant]: [{"scope":"self","stats":{"power":40},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Crâ · Flèches Amoureuses [variant]: [{"scope":"self","stats":{"power":100},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Crâ · Sentinelle [variant]: [{"scope":"self","stats":{"rangedDamagePct":20},"durationTurns":2,"description":"#1{{~1~2 à }}#2% Dommages distance"}]
- Sacrieur · Pacte de Sang [variant]: [{"scope":"self","stats":{"power":100},"durationTurns":3,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Sacrieur · Fluctuation [variant]: [{"scope":"self","stats":{"mp":2},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PM"}]
- Sacrieur · Furie [variant]: [{"scope":"self","stats":{"finalDamagePct":3},"durationTurns":3,"description":"#1% Dommages finaux"}]
- Sacrieur · Nervosité [variant]: [{"scope":"self","stats":{"crit":7},"durationTurns":3,"description":"#1{{~1~2 à }}#2% Critique"}]
- Sacrieur · Douleur Cuisante [variant]: [{"scope":"self","stats":{"power":60},"durationTurns":3,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Eniripsa · Mot Stimulant: [{"scope":"self","stats":{"ap":2},"durationTurns":2,"description":"#1{{~1~2 à }}#2 PA"}]
- Eniripsa · Mot Vivifiant: [{"scope":"self","stats":{"mp":2},"durationTurns":2,"description":"#1{{~1~2 à }}#2 PM"}]
- Eniripsa · Vacarme [variant]: [{"scope":"self","stats":{"finalDamagePct":25},"durationTurns":1,"description":"#1% Dommages finaux"}]
- Eniripsa · Mot Galvanisant [variant]: [{"scope":"self","stats":{"power":150},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Eniripsa · Murmure [variant]: [{"scope":"self","stats":{"mp":1},"durationTurns":1,"description":"Vole #1{{~1~2 à }}#2 PM"},{"scope":"self","stats":{"mp":1},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PM"}]
- Ouginak · Cubitus: [{"scope":"self","stats":{"mp":1},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PM"}]
- Ouginak · Arcanin: [{"scope":"self","stats":{"power":100},"durationTurns":3,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Ouginak · Aboiement: [{"scope":"self","stats":{"mp":2},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PM"}]
- Ouginak · Battue [variant]: [{"scope":"self","stats":{"power":150},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Ouginak · Rogne [variant]: [{"scope":"self","stats":{"power":80},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Féca · Mise en Garde [variant]: [{"scope":"self","stats":{"earth":200},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Force"},{"scope":"self","stats":{"fire":200},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Intelligence"},{"scope":"self","stats":{"water":200},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Chance"},{"scope":"self","stats":{"air":200},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Agilité"}]
- Enutrof · Force de l'Âge: [{"scope":"self","stats":{"mp":1},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PM"}]
- Enutrof · Opportunité: [{"scope":"self","stats":{"power":80},"durationTurns":2,"description":"#1{{~1~2 à }}#2 Puissance"}]
- Enutrof · Ruée vers l'Or: [{"scope":"self","stats":{"mp":4},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PM"}]
- Enutrof · Boîte de Pandore: [{"scope":"self","stats":{"mp":1},"durationTurns":1,"description":"#1{{~1~2 à }}#2 PM"}]

## Skipped reasons

- no-fixed-direct-damage-or-supported-buff: 300
- conditional-or-delayed-damage: 25
- best-element-damage: 23

## Certification scope

- Includes immediate fixed-element damage and life-steal hits at the highest spell level available to a level-200 character.
- Includes class spell variants exposed by the Dofus SpellVariants dataset; normalization fails if the source contains variant records but none can be mapped.
- Includes deterministic offensive self buffs and target damage-taken modifiers when their effect metadata is explicit.
- Critical hits must match the normal hit count and elements.
- Best-element, delayed, triggered or otherwise contextual damage is excluded rather than approximated.
- Unsupported contextual secondary effects are ignored rather than invented.
