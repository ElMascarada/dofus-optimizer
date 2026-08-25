(() => {
  const NativeWorker = window.Worker;
  if (typeof NativeWorker !== 'function') return;

  const bridge = {
    active: null
  };

  function requestedTurns(payload = {}) {
    const mode = payload?.combatObjective?.turnMode || payload?.turnMode || 't1';
    if (mode === 't1') return [1];
    if (mode === 't2') return [2];
    if (mode === 't3') return [3];
    return [1, 2, 3];
  }

  function hasCompletePlan(build, payload = {}) {
    const plan = build?.combatPlan;
    if (!plan?.perTurn || !Array.isArray(plan?.objective?.activeTurns)) return false;
    const activeTurns = plan.objective.activeTurns.map(Number);
    return requestedTurns(payload).every((turn) =>
      activeTurns.includes(turn)
      && Object.prototype.hasOwnProperty.call(plan.perTurn, turn)
      && Number.isFinite(Number(plan.perTurn[turn]))
    );
  }

  function trackedWorker(...args) {
    const worker = new NativeWorker(...args);
    const nativePostMessage = worker.postMessage.bind(worker);
    const nativeTerminate = worker.terminate.bind(worker);
    const tracker = {
      worker,
      nativeTerminate,
      requestId: null,
      payload: null,
      latestProgress: null,
      latestPartialResults: [],
      maxNodes: 0
    };

    worker.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.type === 'progress') {
        tracker.latestProgress = message.progress || tracker.latestProgress;
        tracker.maxNodes = Math.max(tracker.maxNodes, Number(message.progress?.nodes || 0));
        const partial = message.progress?.partialResults;
        if (Array.isArray(partial) && partial.length) tracker.latestPartialResults = partial;
      } else if (message.type === 'result') {
        const finalResults = message.output?.results;
        if (Array.isArray(finalResults) && finalResults.length) tracker.latestPartialResults = finalResults;
      }
    });

    worker.postMessage = (...postArgs) => {
      const message = postArgs[0] || {};
      if (message.type === 'optimize') {
        tracker.requestId = message.requestId;
        tracker.payload = message.payload || {};
        tracker.latestProgress = null;
        tracker.latestPartialResults = [];
        tracker.maxNodes = 0;
        bridge.active = tracker;
      }
      return nativePostMessage(...postArgs);
    };

    worker.terminate = () => {
      if (bridge.active?.worker === worker) bridge.active = null;
      return nativeTerminate();
    };

    return worker;
  }

  trackedWorker.prototype = NativeWorker.prototype;
  Object.setPrototypeOf(trackedWorker, NativeWorker);
  window.Worker = trackedWorker;

  function diagnosticsFromTracker(tracker, extra = {}) {
    const progress = tracker.latestProgress || {};
    return {
      visited: Number(progress.visited || 0),
      nodes: Number(tracker.maxNodes || progress.nodes || 0),
      pruned: Number(progress.pruned || 0),
      fallbackUsed: false,
      stoppedEarly: true,
      ...extra
    };
  }

  function dispatchStoppedResult(tracker, output, suffix = '') {
    const diagnostics = document.getElementById('diagnostics');
    const nodeCount = Number(tracker.maxNodes || tracker.latestProgress?.nodes || 0).toLocaleString('fr-FR');
    const count = Array.isArray(output?.results) ? output.results.length : 0;

    tracker.worker.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'result',
        requestId: tracker.requestId,
        output
      }
    }));

    if (diagnostics) {
      diagnostics.textContent = `Recherche arrêtée · ${count} stuff${count > 1 ? 's' : ''} conservé${count > 1 ? 's' : ''} avec rotation${count > 1 ? 's' : ''} · ${nodeCount} nœuds parcourus${suffix}`;
    }
  }

  function completeReadyResults(tracker) {
    return tracker.latestPartialResults.filter((build) => hasCompletePlan(build, tracker.payload));
  }

  function finishAlreadyRefined(tracker) {
    const ready = completeReadyResults(tracker);
    if (!ready.length) return false;
    const topN = Math.max(1, Number(tracker.payload?.topN || 10));
    const results = ready.slice(0, topN);
    dispatchStoppedResult(tracker, {
      results,
      diagnostics: diagnosticsFromTracker(tracker, {
        combatRefine: {
          evaluated: results.length,
          spellPool: Number(tracker.payload?.classSpells?.length || 0),
          stoppedEarly: true
        },
        resultDiversity: {
          mode: tracker.payload?.diversityMode || 'gear',
          candidates: ready.length,
          returned: results.length
        }
      })
    }, ' · rotations déjà calculées');
    return true;
  }

  function dispatchNoUnsafeFallback(tracker, reason) {
    const ready = completeReadyResults(tracker);
    const topN = Math.max(1, Number(tracker.payload?.topN || 10));
    const results = ready.slice(0, topN);
    dispatchStoppedResult(tracker, {
      results,
      diagnostics: diagnosticsFromTracker(tracker, {
        combatRefine: {
          evaluated: results.length,
          spellPool: Number(tracker.payload?.classSpells?.length || 0),
          stoppedEarly: true,
          finalizationFailed: true
        },
        resultDiversity: {
          mode: tracker.payload?.diversityMode || 'gear',
          candidates: ready.length,
          returned: results.length
        }
      })
    }, results.length
      ? ` · ${reason} · seules les rotations complètes sont conservées`
      : ` · ${reason} · aucun stuff affiché sans tours complets`);
  }

  function finalizeCurrentCandidates(tracker) {
    const button = document.getElementById('optimize');
    const diagnostics = document.getElementById('diagnostics');
    const payload = tracker.payload || {};
    const topN = Math.max(1, Number(payload.topN || 10));
    const candidateLimit = Math.min(
      tracker.latestPartialResults.length,
      Math.max(topN, 20)
    );

    tracker.nativeTerminate();
    if (button) {
      button.disabled = true;
      button.textContent = 'Finalisation des tours…';
    }
    if (diagnostics) diagnostics.textContent = `Arrêt demandé · calcul des rotations des ${candidateLimit} meilleurs stuffs déjà trouvés…`;

    const finalizer = new NativeWorker(new URL('./js/partial-finalizer-worker.js', document.baseURI), { type: 'module' });
    finalizer.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.requestId !== tracker.requestId) return;

      if (message.type === 'progress') {
        if (diagnostics) {
          const done = Number(message.progress?.visited || message.progress?.nodes || 0);
          diagnostics.textContent = `Arrêt demandé · finalisation des rotations ${done}/${candidateLimit}…`;
        }
        return;
      }

      if (message.type === 'error') {
        finalizer.terminate();
        dispatchNoUnsafeFallback(tracker, `finalisation impossible : ${message.message || 'erreur inconnue'}`);
        return;
      }

      if (message.type !== 'result') return;
      finalizer.terminate();
      const completeResults = (message.output?.results || []).filter((build) => hasCompletePlan(build, payload));
      const output = {
        results: completeResults,
        diagnostics: diagnosticsFromTracker(tracker, {
          combatRefine: {
            ...(message.output?.diagnostics || {}),
            spellPool: Number(message.output?.diagnostics?.spellPool || 0),
            stoppedEarly: true
          },
          resultDiversity: {
            mode: payload.diversityMode || 'gear',
            candidates: Number(message.output?.diagnostics?.candidates || candidateLimit),
            returned: completeResults.length
          }
        })
      };
      dispatchStoppedResult(tracker, output, ' · résultat provisoire');
    });

    finalizer.addEventListener('error', (event) => {
      finalizer.terminate();
      dispatchNoUnsafeFallback(tracker, `erreur worker : ${event.message || 'erreur inconnue'}`);
    });

    finalizer.postMessage({
      type: 'finalize-partial',
      requestId: tracker.requestId,
      payload: {
        results: tracker.latestPartialResults,
        classSpells: payload.classSpells || [],
        combatObjective: payload.combatObjective || {},
        diversityMode: payload.diversityMode || 'gear',
        topN,
        candidateLimit
      }
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('#optimize');
    if (!button || !String(button.textContent || '').includes('Arrêter le calcul')) return;

    const tracker = bridge.active;
    if (!tracker || tracker.payload?.objectiveMode !== 'combat' || !tracker.latestPartialResults.length) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (finishAlreadyRefined(tracker)) return;
    finalizeCurrentCandidates(tracker);
  }, true);
})();
