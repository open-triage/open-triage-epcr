export const API_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  "X-Frame-Options": "DENY",
});

export function securityHeaders(
  _request: unknown,
  response: { setHeader(name: string, value: string): unknown },
  next: () => void,
): void {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) response.setHeader(name, value);
  next();
}
