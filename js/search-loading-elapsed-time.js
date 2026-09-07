const DEFAULT_TICK_MS = 100;

function safeMilliseconds(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function formatSearchDuration(milliseconds = 0) {
  const elapsed = safeMilliseconds(milliseconds);
  if (elapsed < 60_000) return `${(elapsed / 1000).toFixed(1)} s`;
  const totalSeconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} min ${seconds} s`;
}

export class SearchElapsedTimer {
  constructor({
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    setIntervalFn = globalThis.setInterval?.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
    tickMs = DEFAULT_TICK_MS,
    onChange = () => {}
  } = {}) {
    this.now = now;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.tickMs = tickMs;
    this.onChange = onChange;
    this.startedAt = null;
    this.intervalId = null;
    this.state = {
      loading: false,
      elapsedMs: 0,
      finalDurationMs: null
    };
  }

  snapshot() {
    return { ...this.state };
  }

  emit() {
    this.onChange(this.snapshot());
  }

  clearTicker() {
    if (this.intervalId !== null && typeof this.clearIntervalFn === 'function') {
      this.clearIntervalFn(this.intervalId);
    }
    this.intervalId = null;
  }

  start() {
    this.clearTicker();
    this.startedAt = this.now();
    this.state = {
      ...this.state,
      loading: true,
      elapsedMs: 0
    };
    if (typeof this.setIntervalFn === 'function') {
      this.intervalId = this.setIntervalFn(() => this.refresh(), this.tickMs);
    }
    this.emit();
    return this.snapshot();
  }

  refresh() {
    if (!this.state.loading || this.startedAt === null) return this.snapshot();
    this.state = {
      ...this.state,
      elapsedMs: safeMilliseconds(this.now() - this.startedAt)
    };
    this.emit();
    return this.snapshot();
  }

  finish() {
    if (!this.state.loading || this.startedAt === null) return this.snapshot();
    const duration = safeMilliseconds(this.now() - this.startedAt);
    this.clearTicker();
    this.startedAt = null;
    this.state = {
      loading: false,
      elapsedMs: duration,
      finalDurationMs: duration
    };
    this.emit();
    return this.snapshot();
  }
}

export function mountSearchElapsedTimeUx({
  optimizeButton = document.querySelector('#optimizer-run'),
  resultsRoot = document.querySelector('#optimizer-results'),
  timingRoot = document.querySelector('#optimizer-search-timing'),
  spinner = document.querySelector('#optimizer-search-spinner'),
  liveRoot = document.querySelector('#optimizer-search-live'),
  elapsedRoot = document.querySelector('#optimizer-search-elapsed'),
  finalRoot = document.querySelector('#optimizer-search-final')
} = {}) {
  if (!optimizeButton || !resultsRoot || !timingRoot || !spinner || !liveRoot || !elapsedRoot || !finalRoot) {
    return null;
  }

  const timer = new SearchElapsedTimer({
    onChange(state) {
      const hasFinal = state.finalDurationMs !== null;
      timingRoot.hidden = !(state.loading || hasFinal);
      spinner.hidden = !state.loading;
      liveRoot.hidden = !state.loading;
      finalRoot.hidden = state.loading || !hasFinal;
      elapsedRoot.textContent = formatSearchDuration(state.elapsedMs);
      if (hasFinal) finalRoot.textContent = `Dernière optimisation : ${formatSearchDuration(state.finalDurationMs)}`;
    }
  });

  optimizeButton.addEventListener('click', () => {
    const stoppingCurrentSearch = optimizeButton.classList.contains('is-searching');
    if (!stoppingCurrentSearch && !timer.snapshot().loading) timer.start();
  }, { capture: true });

  const buttonObserver = new MutationObserver(() => {
    if (optimizeButton.classList.contains('is-searching') && !timer.snapshot().loading) timer.start();
  });
  buttonObserver.observe(optimizeButton, { attributes: true, attributeFilter: ['class'] });

  const resultsObserver = new MutationObserver(() => {
    if (timer.snapshot().loading && resultsRoot.getAttribute('aria-busy') === 'false') timer.finish();
  });
  resultsObserver.observe(resultsRoot, { attributes: true, attributeFilter: ['aria-busy'] });

  return { timer, buttonObserver, resultsObserver };
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  mountSearchElapsedTimeUx();
}
