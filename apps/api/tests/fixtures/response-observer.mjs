/** Correlate an actual completed JSON response with the action's persisted scope.
 * A cancelled previous request is not a failed current assertion, and a malformed
 * current response must never be hidden by waiting for a later successful retry. */
export async function observeJsonResponse(page, { label, matchesRequest, action, scope, verify, timeout = 30_000 }) {
  if (![matchesRequest, action, scope, verify].every(value => typeof value === 'function')) throw new Error('Response observation requires explicit request, action, scope and assertion boundaries');
  const requests = new WeakMap(), navigations = new WeakMap(), controller = new AbortController();
  const diagnostics = { requests: 0, beforePhase: 0, otherScope: 0, cancelled: 0, navigated: 0, completed: 0 };
  let settled = false, resolveScope, resolveResult, rejectResult, queue = Promise.resolve();
  const scopeReady = new Promise(resolve => { resolveScope = resolve; });
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const error = reason => new Error(`${label}: ${reason}; observation=${JSON.stringify(diagnostics)}`);
  const finish = (failure, value) => {
    if (settled) return;
    settled = true;
    if (failure) rejectResult(failure); else resolveResult(value);
  };
  const navigation = frame => navigations.set(frame, (navigations.get(frame) ?? 0) + 1);
  const request = value => {
    if (!matchesRequest(value)) return;
    let frame;
    try { frame = value.frame(); } catch { /* Service-worker requests have no frame. */ }
    requests.set(value, { frame, generation: frame ? navigations.get(frame) ?? 0 : null });
    diagnostics.requests++;
  };
  const processResponse = async response => {
    if (settled) return;
    const value = response.request();
    if (!matchesRequest(value)) return;
    const observed = requests.get(value);
    if (!observed) { diagnostics.beforePhase++; return; }
    const select = await scopeReady;
    if (settled) return;
    if (!select(value)) { diagnostics.otherScope++; return; }
    const staleFrame = () => observed.frame && (observed.frame.isDetached() || (navigations.get(observed.frame) ?? 0) !== observed.generation);
    if (staleFrame()) { diagnostics.navigated++; return; }
    let finished;
    try { finished = await response.finished(); }
    catch {
      if (value.failure()) { diagnostics.cancelled++; return; }
      if (staleFrame()) { diagnostics.navigated++; return; }
      throw error('current response completion failed');
    }
    if (settled) return;
    if (finished instanceof Error || value.failure()) { diagnostics.cancelled++; return; }
    if (staleFrame()) { diagnostics.navigated++; return; }
    // Validate completed bodies in order. An unfinished/cancelled stream must
    // not block a later real result; a completed malformed body must still fail.
    queue = queue.then(async () => {
      if (settled) return;
      try {
        if (response.status() !== 200) throw error(`current response returned HTTP ${response.status()}`);
        let body;
        try { body = await response.json(); }
        catch {
          if (value.failure()) { diagnostics.cancelled++; return; }
          if (staleFrame()) { diagnostics.navigated++; return; }
          throw error('current response body is unavailable or malformed JSON');
        }
        if (settled) return;
        verify(body, response);
        diagnostics.completed++;
        finish(null, { body, diagnostics });
      } catch (failure) { finish(failure); }
    });
    await queue;
  };
  const response = value => { void processResponse(value).catch(failure => finish(failure)); };
  const closed = () => finish(error('page closed before a current response completed'));
  page.on('framenavigated', navigation);page.on('request', request);page.on('response', response);page.on('close', closed);
  const timer = setTimeout(() => finish(error('timed out waiting for a completed current JSON response')), timeout);
  void (async () => { await action(); const select = await scope(controller.signal); if (typeof select !== 'function') throw error('scope did not select a request'); resolveScope(select); })()
    .catch(failure => { resolveScope(() => false); finish(failure); });
  try { return await result; }
  finally {
    clearTimeout(timer);controller.abort();resolveScope(() => false);
    page.off('framenavigated', navigation);page.off('request', request);page.off('response', response);page.off('close', closed);
  }
}
