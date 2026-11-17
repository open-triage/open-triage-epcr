import { fileURLToPath } from "node:url";

// Exercise the HTTP server, including its MIME configuration, rather than only
// the exported files. These are the public resources Android needs at startup.
export async function verifyWebShell(origin) {
  const root = new URL("/", origin);
  const response = await fetch(root, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("text/html")) throw new Error("Application shell unavailable");
  const html = await response.text();
  const assets = new Set(["/sw.js", "/manifest.webmanifest", ...[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1])]);
  for (const asset of assets) {
    const url = new URL(asset, root);
    if (url.origin !== root.origin) continue;
    const expected = url.pathname.endsWith(".webmanifest") ? ["application/manifest+json", "application/json"]
      : url.pathname.endsWith(".js") ? ["application/javascript", "text/javascript"]
      : url.pathname.endsWith(".css") ? ["text/css"] : null;
    if (!expected) continue;
    const resource = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    const type = resource.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (!resource.ok || !expected.includes(type)) throw new Error(`Invalid public UI resource ${url.pathname}: HTTP ${resource.status}, ${type}`);
    if (url.pathname.endsWith(".webmanifest")) await resource.json();
    else await resource.arrayBuffer();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await verifyWebShell(process.argv[2] ?? "http://127.0.0.1:3110");
  console.log("PASS public UI shell, service worker, manifest and linked asset types");
}
