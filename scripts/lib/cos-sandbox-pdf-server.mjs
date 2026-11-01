import { createServer } from 'node:http';

/** Single immutable synthetic artifact. No filesystem routes, directory serving,
 * application proxying or request headers are exposed. Caller controls shutdown. */
export function createSyntheticPdfServer({ bytes, path, expiresAt, onRequest = () => {}, now = Date.now }) {
  if (!Buffer.isBuffer(bytes) || bytes.subarray(0, 5).toString() !== '%PDF-' ||
      !/^\/pdf\/[a-f0-9]{64}\/report\.pdf$/.test(path) || !Number.isFinite(expiresAt)) {
    throw new Error('Invalid synthetic PDF capability');
  }
  const artifact = Buffer.from(bytes);
  return createServer((req, res) => {
    const matched = req.url === path;
    const status = now() >= expiresAt ? 410 : !matched ? 404 : !['GET', 'HEAD'].includes(req.method) ? 405 : 200;
    onRequest({ at: new Date(now()).toISOString(), method: req.method, matched, status,
      userAgent: req.headers['user-agent']?.slice(0, 256), hasAuthorization: !!req.headers.authorization });
    res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      ...(status === 200 ? { 'Content-Type': 'application/pdf', 'Content-Length': artifact.length,
        'Content-Disposition': 'inline; filename="opentriage-synthetic-report.pdf"' } : {}) });
    res.end(status === 200 && req.method === 'GET' ? artifact : undefined);
  });
}
