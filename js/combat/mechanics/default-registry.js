import { createCombatMechanicRegistry } from './registry.js';
import { iopMechanics } from './iop.js';
import { huppermageMechanics } from './huppermage.js';

export const defaultCombatMechanicsRegistry = createCombatMechanicRegistry([
  ...iopMechanics,
  ...huppermageMechanics
]);
