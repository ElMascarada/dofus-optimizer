import { createCombatMechanicRegistry } from './registry.js';
import { craMechanics } from './cra.js';
import { iopMechanics } from './iop.js';
import { huppermageMechanics } from './huppermage.js';

export const defaultCombatMechanicsRegistry = createCombatMechanicRegistry([
  ...craMechanics,
  ...iopMechanics,
  ...huppermageMechanics
]);
