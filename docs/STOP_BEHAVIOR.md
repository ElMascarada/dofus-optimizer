# Optimizer stop behavior

In automatic combat mode, the main search and the real turn-rotation solver are separate phases.

When the user stops a long search after at least one valid provisional build exists:

1. the expensive search worker is terminated immediately;
2. up to 20 of the best provisional builds already discovered are retained;
3. a lightweight finalizer worker computes their real spell rotations;
4. the app displays the best finalized Top 10 as an explicitly provisional stopped-search result.

If the search had already entered combat-turn refinement, the already-finalized partial rotations are displayed directly without recomputation.

Stopping before any valid provisional build exists keeps the previous behavior: there is nothing meaningful to finalize.
