import { lookup } from "node:dns/promises";
import { request } from "node:https";
import ipaddr from "ipaddr.js";

export function providerUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search || value.length > 2048) throw new Error("Unsafe provider address");
  return url;
}
export function privateProviderOrigins(): Set<string> {
  const values: unknown = JSON.parse(process.env.OIDC_PRIVATE_ORIGINS_JSON || "[]");
  if (!Array.isArray(values) || values.some(value => typeof value !== "string" || providerUrl(value).origin !== value)) throw new Error("Invalid private provider origins");
  return new Set(values);
}
export function permittedAddress(address: string, privateOrigin = false): boolean {
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  const range = parsed.range();
  // Explicit installation consent only opens RFC1918/ULA, never loopback,
  // link-local metadata, multicast, reserved, transition or unspecified ranges.
  return range === "unicast" || (privateOrigin && ["private", "uniqueLocal"].includes(range));
}
export async function checkedAddress(url: URL, resolve = lookup) {
  const privateOrigin = privateProviderOrigins().has(url.origin);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await Promise.race([resolve(hostname, { all: true, verbatim: true }), new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error("DNS timeout")), 3000); timer.unref();
  })]);
  if (!addresses.length || addresses.some(value => !permittedAddress(value.address, privateOrigin))) throw new Error("Unsafe provider address");
  return addresses[0]!;
}
export async function providerJson(value: string, resolveAddress = lookup): Promise<Record<string, unknown>> {
  const response=await providerFetch(value,undefined,resolveAddress);
  try {
    const body:unknown=await response.json();
    if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();
    return body as Record<string,unknown>;
  }catch{throw new Error("Invalid provider JSON");}
}

/** The protocol library uses this for both token exchange and JWKS refresh. */
export async function providerFetch(input: string | URL, init?: { method?: string; headers?: HeadersInit; body?: unknown }, resolveAddress = lookup): Promise<Response> {
  const url=providerUrl(String(input)); const address=await checkedAddress(url,resolveAddress);
  const method=init?.method ?? "GET";
  if (!["GET","POST"].includes(method) || init?.body && typeof init.body!=="string" && !(init.body instanceof URLSearchParams)) throw new Error("Unsupported provider request");
  const body=init?.body ? String(init.body):undefined;
  if (body && Buffer.byteLength(body)>16384) throw new Error("Provider request too large");
  const headers=Object.fromEntries(new Headers(init?.headers).entries());
  return new Promise((resolve,reject)=>{
    const req=request(url,{method,agent:false,headers,family:address.family,lookup:(_host,_options,callback)=>callback(null,address.address,address.family)},response=>{
      if (response.statusCode!==200 || !/^application\/(?:json|jwk-set\+json)(?:;|$)/i.test(String(response.headers["content-type"]))) {response.resume();reject(new Error("Invalid discovery response"));return;}
      let size=0;const parts:Buffer[]=[];
      response.on("data",(part:Buffer)=>{size+=part.length;if(size>256*1024)req.destroy(new Error("Provider response too large"));else parts.push(part);});
      response.on("error",reject);response.on("end",()=>resolve(new Response(Buffer.concat(parts),{status:200,headers:{"content-type":String(response.headers["content-type"])}})));
    });
    const timer=setTimeout(()=>req.destroy(new Error("Provider timeout")),5000);
    req.on("close",()=>clearTimeout(timer));req.on("error",reject);req.end(body);
  });
}
