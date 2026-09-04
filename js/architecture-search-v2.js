import { searchArchitecturesV2 as searchArchitecturesV2Core } from './architecture-search-v2-core.js';
import {
  filterOptimizerEligibleItems,
  optimizerTrophyEligibilityCounts
} from '../optimizer/item-eligibility.js';

export function searchArchitecturesV2(options = {}) {
  const inputItems = Array.isArray(options.items) ? options.items : [];
  const eligibility = optimizerTrophyEligibilityCounts(inputItems);
  const output = searchArchitecturesV2Core({
    ...options,
    items: filterOptimizerEligibleItems(inputItems)
  });

  return {
    ...output,
    diagnostics: {
      ...(output?.diagnostics || {}),
      trophyEligibility: eligibility
    }
  };
}
