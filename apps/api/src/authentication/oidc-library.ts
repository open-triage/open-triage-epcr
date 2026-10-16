import type { ServerMetadata } from "openid-client";

/** Async ESM loading preserves the protocol library's Node20+ baseline without
 * relying on CommonJS require(esm). The API's host framework has its own floor. */
export async function oidcConfiguration(metadata: ServerMetadata, clientId: string, clientSecret: string) {
  const { Configuration, ClientSecretPost } = await import("openid-client");
  return new Configuration(metadata,clientId,{},ClientSecretPost(clientSecret));
}
