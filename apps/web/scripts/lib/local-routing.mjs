import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/** Shared development/static-server edge; preserve Host for agency selection. */
export function localRouting(environment = process.env) {
  const upstream = new URL(environment.OPEN_TRIAGE_API_UPSTREAM || "http://127.0.0.1:3001");
  if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password ||
      upstream.pathname !== "/" || upstream.search || upstream.hash) throw new Error("OPEN_TRIAGE_API_UPSTREAM must be an HTTP(S) origin");
  const publicHost = environment.OPEN_TRIAGE_PUBLIC_SITE_HOST ?? "localhost";
  return (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      // Use a fixed upstream, never a browser-provided host or forwarded header.
      const headers = { ...request.headers };
      for (const key of Object.keys(headers)) if (key.startsWith("x-forwarded-") || key === "forwarded") delete headers[key];
      const proxy = (upstream.protocol === "https:" ? httpsRequest : httpRequest)({
        protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port,
        method: request.method, path: request.url, headers,
      }, (result) => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      });
      proxy.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end("API unavailable"); });
      request.on("aborted", () => proxy.destroy());
      response.on("close", () => proxy.destroy());
      request.pipe(proxy);
      return true;
    }
    if (publicHost && request.headers.host?.split(":")[0] === publicHost) {
      // Keep the landing origin separate from the app and its service worker.
      if (pathname !== "/" && pathname !== "/site.css") {
        response.writeHead(404).end("Not found");
        return true;
      }
      request.url = pathname === "/" ? "/landing/index.html" : "/landing/site.css";
    }
    return false;
  };
}
