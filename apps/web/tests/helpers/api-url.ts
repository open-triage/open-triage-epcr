/** Independent expectation for the supported server-backed test configurations. */
export function expectedApiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  return !base || base === "same-origin" ? path : `${base.replace(/\/$/, "")}${path}`;
}
