/** A media response may name an API path, never another credential destination. */
export function approvedMediaApiPath(path: string, kind: "photo" | "audio"): string {
  let parsed: URL, decoded: string;
  try { parsed = new URL(path, "https://local.invalid"); decoded = decodeURIComponent(parsed.pathname); }
  catch { throw new Error(`Unapproved ${kind} location`); }
  if (!path.startsWith("/api/") || path.includes("\\") || parsed.origin !== "https://local.invalid" || parsed.hash ||
      parsed.pathname !== path.split("?")[0] || decoded.split("/").some(segment => segment === "." || segment === "..")) {
    throw new Error(`Unapproved ${kind} location`);
  }
  return path;
}
