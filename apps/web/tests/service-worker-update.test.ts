import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deployed clients immediately adopt a newly published application shell", async () => {
  const worker = await readFile(new URL("../service-worker/service-worker.ts", import.meta.url), "utf8");
  const registration = await readFile(new URL("../components/service-worker-registration.tsx", import.meta.url), "utf8");
  const generator = await readFile(new URL("../scripts/build-service-worker.ts", import.meta.url), "utf8");

  assert.match(worker, /self\.skipWaiting\(\)/);
  assert.match(worker, /open-triage-shell-v5-\$\{__OPEN_TRIAGE_BUILD_SHA__\}/);
  assert.match(generator, /OPEN_TRIAGE_BUILD_SHA/);
  assert.match(generator, /define: \{ __OPEN_TRIAGE_BUILD_SHA__: JSON\.stringify\(buildSha\) \}/);
  assert.match(registration, /updateViaCache: "none"/);
  assert.match(registration, /controllerchange/);
  assert.match(registration, /window\.location\.reload\(\)/);
});

test("offline shell precaches linked language bundles from the installed page", async () => {
  const worker = await readFile(new URL("../service-worker/service-worker.ts", import.meta.url), "utf8");
  const dictionary = await readFile(new URL("../app/localization.ts", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../app/message-dictionaries.generated.ts", import.meta.url), "utf8");
  assert.match(dictionary, /import \{ MESSAGE_DICTIONARIES \} from "\.\/message-dictionaries\.generated"/);
  assert.match(manifest, /from "\.\.\/messages\/en\.json"/);
  assert.match(manifest, /from "\.\.\/messages\/sv\.json"/);
  assert.match(worker, /const linkedAssets = \[\.\.\.html\.matchAll/);
  assert.match(worker, /cache\.addAll\(\[\.\.\.new Set\(\[\.\.\.appShell\.slice\(1\), \.\.\.linkedAssets\]\)\]\)/);
});

test("static responses remain cacheable when the browser consumes them before cache opening completes", async () => {
  const { build } = await import("esbuild");
  const { runInNewContext } = await import("node:vm");
  const compiled = await build({entryPoints:[new URL("../service-worker/service-worker.ts",import.meta.url).pathname],bundle:true,write:false,format:"iife",define:{__OPEN_TRIAGE_BUILD_SHA__:JSON.stringify("delayed-cache")}});
  for (const path of ["/", "/_next/static/app.js"]) {
    let fetchHandler!: (event: unknown) => void, deliver!: Promise<Response>;
    let openCache!: (cache: {put: (request: unknown, response: Response) => Promise<void>}) => void;
    const opened = new Promise(resolve => { openCache = resolve; }), pending: Promise<unknown>[] = [];
    let cached = "";
    const network = new Response("public shell or asset",{status:200});
    runInNewContext(compiled.outputFiles[0]!.text,{
      URL, self:{registration:{scope:"https://fixture.test/"},location:{origin:"https://fixture.test"},addEventListener(type:string,handler:typeof fetchHandler){if(type==="fetch")fetchHandler=handler;}},
      caches:{open:()=>opened},fetch:async()=>network,
    });
    fetchHandler({request:{method:"GET",url:"https://fixture.test"+path,destination:path==="/"?"document":"script",mode:path==="/"?"navigate":"same-origin"},respondWith(response:Promise<Response>){deliver=response;},waitUntil(task:Promise<unknown>){pending.push(task);}});
    assert.equal(await (await deliver).text(),"public shell or asset");
    assert.equal(network.bodyUsed,true,"Reproduce browser consumption before CacheStorage is ready");
    openCache({put:async(_request,response)=>{cached=await response.text();}});
    await Promise.all(pending);
    assert.equal(cached,"public shell or asset");
  }
});
