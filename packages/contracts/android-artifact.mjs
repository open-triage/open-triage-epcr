import { createHash } from "node:crypto";

/** Verify fixed public GitHub assets only; no request can supply a destination. */
export async function verifyAndroidArtifact(url, bytes, digest, fetcher = fetch, onBytes) {
  if (typeof url !== "string" || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 128 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid approved Android artifact");
  let target = new URL(url);
  const signal = AbortSignal.timeout(20_000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (target.protocol !== "https:" || target.username || target.password || target.port || target.hash ||
      (redirects === 0 ? target.origin !== "https://github.com" || target.search : target.hostname !== "release-assets.githubusercontent.com")) {
      throw new Error("Unapproved Android artifact destination");
    }
    const response = await fetcher(target.href, { redirect: "manual", signal, headers: { "accept-encoding": "identity" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Android artifact redirect is unavailable");
      target = new URL(location, target); continue;
    }
    if (response.status !== 200 || !response.body ||
      (response.headers.has("content-length") && Number(response.headers.get("content-length")) !== bytes)) {
      await response.body?.cancel(); throw new Error("Android artifact is unavailable");
    }
    const hash = createHash("sha256"), reader = response.body.getReader();
    let received = 0;
    try {
      while (true) {
        const result = await reader.read(); if (result.done) break;
        received += result.value.byteLength;
        if (received > bytes) throw new Error("Android artifact size changed");
        hash.update(result.value);
        await onBytes?.(result.value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    if (received !== bytes || hash.digest("hex") !== digest) throw new Error("Android artifact digest changed");
    return;
  }
  throw new Error("Android artifact has too many redirects");
}

