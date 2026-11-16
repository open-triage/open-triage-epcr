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
  assert.match(worker, /usableShellResponse\(url, response\)/);
  assert.match(worker, /cache\.put\(url, response\)/);
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
    const network = new Response("public shell or asset",{status:200,headers:{"content-type":path.endsWith(".js")?"text/javascript":"text/html"}});
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


test("a successful HTML fallback cannot replace or bypass a cached JavaScript asset", async () => {
  const { build } = await import("esbuild");
  const { runInNewContext } = await import("node:vm");
  const compiled = await build({entryPoints:[new URL("../service-worker/service-worker.ts",import.meta.url).pathname],bundle:true,write:false,format:"iife",define:{__OPEN_TRIAGE_BUILD_SHA__:JSON.stringify("wrong-asset-type")}});
  for (const [path, destination, contentType] of [["/_next/static/app.js", "script", "text/javascript"], ["/_next/static/app.css", "style", "text/css"]] as const) {
    let handler!: (event: unknown) => void, delivered!: Promise<Response>, writes = 0;
    const tasks: Promise<unknown>[] = [];
    runInNewContext(compiled.outputFiles[0]!.text, {
      URL, self:{registration:{scope:"https://fixture.test/"},location:{origin:"https://fixture.test"},addEventListener(type:string,value:typeof handler){if(type==="fetch")handler=value;}},
      caches:{open:async()=>({put:async()=>{writes++;},match:async()=>new Response("verified asset",{headers:{"content-type":contentType}})})},
      fetch:async()=>new Response("<html>Bundled loading screen</html>",{status:200,headers:{"content-type":"text/html"}}),
    });
    handler({request:{method:"GET",url:"https://fixture.test"+path,destination,mode:"no-cors"},respondWith(value:Promise<Response>){delivered=value;},waitUntil(value:Promise<unknown>){tasks.push(value);}});
    assert.equal(await (await delivered).text(),"verified asset", path);
    await Promise.all(tasks); assert.equal(writes,0,"Do not poison the verified asset cache");
  }
});


test("installation rejects HTML script/style fallbacks and removes the incomplete shell", async () => {
  const { build } = await import("esbuild");
  const { runInNewContext } = await import("node:vm");
  const compiled = await build({entryPoints:[new URL("../service-worker/service-worker.ts",import.meta.url).pathname],bundle:true,write:false,format:"iife",define:{__OPEN_TRIAGE_BUILD_SHA__:JSON.stringify("invalid-install")}});
  for (const asset of ["app.js", "app.css"]) {
    let install!: (event: unknown) => void, installed!: Promise<void>, activated = false;
    const removed: string[] = [];
    runInNewContext(compiled.outputFiles[0]!.text, {
      URL, self:{registration:{scope:"https://fixture.test/"},location:{origin:"https://fixture.test"},skipWaiting(){activated=true;},addEventListener(type:string,handler:typeof install){if(type==="install")install=handler;}},
      caches:{open:async()=>({put:async()=>{}}),delete:async(name:string)=>{removed.push(name);}},
      fetch:async(url:string)=>new Response(url==="https://fixture.test/"?`<script src="/_next/static/${asset}"></script>`:"<html>Fallback</html>",{headers:{"content-type":"text/html"}}),
    });
    install({waitUntil(task:Promise<void>){installed=task;}});
    await assert.rejects(installed,/shell asset unavailable/);
    assert.equal(activated,false);assert.deepEqual(removed,["open-triage-shell-v5-invalid-install"]);
  }
});
