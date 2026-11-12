// Synthetic launcher only: bounded, report-scoped one-shot failure and receipts.
export function pdfDownloadFixture() {
  const reports = new Map();
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  return (request, response, next) => {
    const url = new URL(request.url, 'https://synthetic.invalid');
    if (url.pathname === '/api/__android-pdf-download-fail' && ['POST','GET'].includes(request.method)) {
      const id = url.searchParams.get('reportId');
      if (!uuid.test(id ?? '') || url.searchParams.size !== 1) return response.status(400).json({ error: 'invalid fixture report' });
      if (request.method === 'POST') {
        if (!reports.has(id) && reports.size >= 4) return response.status(503).json({ armed: false });
        reports.set(id, { armed: true, requests: 0, failures: 0, statuses: [] });
      }
      const state = reports.get(id);
      return state ? response.json({ ...state, statuses: [...state.statuses] }) : response.status(404).json({ armed: false });
    }
    const match = /^\/api\/review\/reports\/([a-f0-9-]{36})\/snapshots\/[a-f0-9-]{36}\/pdf$/.exec(url.pathname);
    const state = request.method === 'GET' && match ? reports.get(match[1]) : null;
    if (!state) return next();
    state.requests++;
    response.once('finish', () => { if (state.statuses.length < 8) state.statuses.push(response.statusCode); });
    if (state.armed) {
      state.armed = false; state.failures++;
      return response.status(503).set('Cache-Control', 'no-store').json({ code: 'fixture.download-unavailable' });
    }
    return next();
  };
}
