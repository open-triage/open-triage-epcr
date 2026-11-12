/** Test-only observation of the real Capacitor nativePromise dispatch; never retain request options. */
export function observeNativePdfCalls(capacitor) {
  const original = capacitor.nativePromise;
  const observation = { total: 0, closes: 0, calls: [], restore: () => { if (capacitor.nativePromise === wrapped) capacitor.nativePromise = original; } };
  const safeCode = value => typeof value === 'string' && (/^pdf\.[a-z.-]{1,64}$/.test(value)
    || ['CONNECTION_FAILED','TLS_FAILED','MANAGED_BLOCKED','MANAGED_CONFLICT','SERVER_INCOMPATIBLE','UNIMPLEMENTED'].includes(value)) ? value : 'other';
  function wrapped(...args) {
    if (args[0] === 'OpenTriageConnection' && args[1] === 'closePdf') observation.closes++;
    if (args[0] !== 'OpenTriageConnection' || args[1] !== 'openPdf') return original.apply(this, args);
    observation.total++;
    const call = observation.calls.length < 8 ? { settled: false } : null;
    if (call) observation.calls.push(call);
    const rejected = error => { if (call) { call.settled = true; call.errorCode = safeCode(error?.code); } };
    try {
      const pending = original.apply(this, args);
      pending.then(value => {
        if (call) { call.settled = true; call.opened = value?.opened === true; call.status = Number.isInteger(value?.status) ? value.status : null; call.code = safeCode(value?.code); }
        return value;
      }, rejected);
      return pending;
    } catch (error) { rejected(error); throw error; }
  }
  capacitor.nativePromise = wrapped;
  return observation;
}
