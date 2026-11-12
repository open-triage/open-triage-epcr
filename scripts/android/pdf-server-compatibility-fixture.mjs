// Synthetic launcher control only; never installed in the production API.
export function pdfServerCompatibilityFixture() {
  let withdrawn = false;
  return (request, response, next) => {
    const url = new URL(request.url, 'https://synthetic.invalid');
    if (request.method === 'POST' && url.pathname === '/api/__android-pdf-server-capability') {
      const compatible = url.searchParams.get('compatible');
      if (url.searchParams.size !== 1 || !['0', '1'].includes(compatible)) return response.status(400).json({ error: 'invalid fixture control' });
      withdrawn = compatible === '0';
      return response.json({ compatible: !withdrawn });
    }
    if (withdrawn && request.method === 'GET' && url.pathname === '/api/health') {
      const json = response.json;
      response.json = function (body) {
        return json.call(this, { ...body, androidApiCapabilities: Array.isArray(body.androidApiCapabilities)
          ? body.androidApiCapabilities.filter(value => value !== 'personal-session-continuation-v1') : body.androidApiCapabilities });
      };
    }
    return next();
  };
}
