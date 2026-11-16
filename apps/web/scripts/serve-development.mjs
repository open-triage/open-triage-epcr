import next from "next";
import { parseArgs } from "node:util";
import { localRouting } from "./lib/local-routing.mjs";
import { developmentServer } from "./lib/development-tls.mjs";

process.env.NODE_ENV ??= "development";

const { values } = parseArgs({ options: {
  port: { type: "string", short: "p" }, hostname: { type: "string", short: "H" },
} });
const port = Number(values.port || process.env.PORT || 3000);
const hostname = values.hostname || "0.0.0.0";
const route = localRouting();
// Released native clients require the stable asset names emitted by Webpack.
// Turbopack development chunks can contain encoded package scopes such as @swc.
const app = next({ dev: true, webpack: true, port, hostname });
await app.prepare();
const handle = app.getRequestHandler();
const server = developmentServer((request, response) => {
  if (!route(request, response)) void handle(request, response);
});
server.on("upgrade", app.getUpgradeHandler());
server.listen(port, hostname, () => console.log(`OpenTriage web available at ${process.env.DEV_TLS_CERT_FILE ? 'https' : 'http'}://localhost:${port}`));
