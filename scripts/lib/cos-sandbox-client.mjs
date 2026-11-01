// Deliberately restricted to Cambio's sandbox. Never use this harness for real patients.
export const COS_SANDBOX_BASE = 'https://api.openservices.cambio.se/api/open/';

export function sandboxUrl(path) {
  const url = new URL(path, COS_SANDBOX_BASE);
  if (url.origin !== new URL(COS_SANDBOX_BASE).origin || !url.pathname.startsWith('/api/open/') || url.username || url.password) {
    throw new Error('Refusing credentials outside the COS sandbox API');
  }
  return url;
}

export function clinicalHeaders(token, subscriptionKey) {
  return {
    Authorization: `Bearer ${token}`,
    'Ocp-Apim-Subscription-Key': subscriptionKey,
    Accept: 'application/fhir+json, application/json',
    'Content-Type': 'application/fhir+json',
    // Verified by a controlled read: absent => HTTP 500, sv-SE => HTTP 200.
    // Required for both structured clinical writes and nonempty observation reads.
    'Accept-Language': 'sv-SE',
    Prefer: 'return=OperationOutcome',
  };
}

export async function sandboxClient(env = process.env, { write = false } = {}) {
  for (const key of ['COS_CLIENT_ID', 'COS_CLIENT_SECRET', 'COS_API_SUBSCRIPTION_KEY']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  const auth = await fetch('https://api.openservices.cambio.se/auth/realms/COS/protocol/openid-connect/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.COS_CLIENT_ID}:${env.COS_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: write ? 'user/*.read user/*.write' : 'user/*.read' }),
  });
  const token = await auth.json();
  if (!auth.ok || !token.access_token) throw new Error(`OAuth failed (${auth.status}); token response withheld`);
  const headers = clinicalHeaders(token.access_token, env.COS_API_SUBSCRIPTION_KEY);
  return async function request(path, { method = 'GET', body, extraHeaders = {} } = {}) {
    if (method !== 'GET' && !write) throw new Error('This client is read-only');
    const url = sandboxUrl(path);
    const response = await fetch(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(25000),
      headers: { ...extraHeaders, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let data; try { data = JSON.parse(raw); } catch { data = raw; }
    // Never retain request headers, bearer tokens or token responses.
    return { url: String(url), status: response.status, location: response.headers.get('location'),
      contentLocation: response.headers.get('content-location'), body: data };
  };
}

export function assertSuccessful(receipt) {
  const issues = receipt.body?.resourceType === 'OperationOutcome' ? receipt.body.issue ?? [] : [];
  if (receipt.status < 200 || receipt.status >= 300 || issues.some(i => ['error', 'fatal'].includes(i.severity))) {
    throw new Error(`COS HTTP ${receipt.status}: ${issues.map(i => i.diagnostics ?? i.code).join('; ')}`);
  }
}

export async function searchAll(request, path) {
  const resources = [], receipts = [], seen = new Set();
  for (let next = path; next;) {
    const url = String(sandboxUrl(next));
    if (seen.has(url) || seen.size >= 100) throw new Error('Incomplete search: pagination cycle or limit');
    seen.add(url);
    const receipt = await request(url); receipts.push(receipt); assertSuccessful(receipt);
    if (receipt.body?.resourceType !== 'Bundle' || receipt.body.type !== 'searchset') throw new Error('Expected a searchset Bundle');
    resources.push(...(receipt.body.entry ?? []).map(e => e.resource).filter(Boolean));
    next = receipt.body.link?.find(l => l.relation === 'next')?.url;
  }
  return { resources, receipts };
}
