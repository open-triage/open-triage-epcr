import https from 'node:https';

/** No pooled sockets: synchronous adb instrumentation can outlive the API's keep-alive deadline. */
export function fixtureApi(fixture, ca, path, method = 'GET', body, headers = {}) {
  const encodedBody = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolveRequest, reject) => {
    const request = https.request({ hostname: '127.0.0.1', port: fixture.port, path: `/api/${path}`, method, ca, agent: false,
      headers: { Origin: fixture.origin, Host: new URL(fixture.origin).host, ...headers, ...(encodedBody === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(encodedBody) }) } }, response => {
      let encoded = ''; response.setEncoding('utf8'); response.on('data', chunk => { encoded += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        try { resolveRequest({ status: response.statusCode, headers: response.headers, body: encoded ? JSON.parse(encoded) : null }); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject); request.end(encodedBody);
  });
}
