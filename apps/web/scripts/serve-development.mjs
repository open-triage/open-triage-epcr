import { createServer } from "node:http";
import next from "next";
import { parseArgs } from "node:util";
import { localRouting } from "./lib/local-routing.mjs";

process.env.NODE_ENV ??= "development";

const { values } = parseArgs({ options: {
  port: { type: "string", short: "p" }, hostname: { type: "string", short: "H" },
} });
const port = Number(values.port || process.env.PORT || 3000);
const hostname = values.hostname || "0.0.0.0";
const route = localRouting();
const app = next({ dev: true, port, hostname });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((request, response) => {
  if (!route(request, response)) void handle(request, response);
});
server.on("upgrade", app.getUpgradeHandler());
server.listen(port, hostname, () => console.log(`OpenTriage web available at http://localhost:${port}`));
