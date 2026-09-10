export type BrowserRequestConfiguration = Readonly<{
  mode: "server" | "static";
  apiBaseUrl: string | null;
  basePath: string;
  routeStaticMutationsToApi: boolean;
}>;

function withoutTrailingSlash(value: string | undefined): string {
  return value?.replace(/\/$/, "") ?? "";
}

/** Resolves the browser's server-backed or intentional static-demo request mode. */
export function browserRequestConfiguration(
  environment: Record<string, string | undefined> = process.env,
): BrowserRequestConfiguration {
  const staticMode = environment.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION === "true";
  return {
    mode: staticMode ? "static" : "server",
    apiBaseUrl: staticMode
      ? null
      : withoutTrailingSlash(environment.NEXT_PUBLIC_API_URL) || "http://localhost:3001",
    basePath: withoutTrailingSlash(environment.NEXT_PUBLIC_BASE_PATH),
    routeStaticMutationsToApi: environment.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API === "true",
  };
}

export function apiRequestUrl(path: string, configuration = browserRequestConfiguration()): string | null {
  return configuration.apiBaseUrl ? `${configuration.apiBaseUrl}${path}` : null;
}

export function browserRouteUrl(path: string, configuration = browserRequestConfiguration()): string {
  return apiRequestUrl(path, configuration) ?? `${configuration.basePath}${path}`;
}

export function browserRequestInit(init: RequestInit = {}): RequestInit {
  return { cache: "no-store", credentials: "include", ...init };
}
