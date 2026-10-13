export const INSTALLATION_TRANSITION_KEY = "open-triage.installation-transition.v1";
export const INSTALLATION_GENERATION_KEY = "open-triage.installation-generation.v1";

/** Capture before personal authentication; a response from an old context is unusable. */
export function authenticationInstallationGeneration(): string | null {
 if(typeof window === "undefined") return null;
 if(window.localStorage.getItem(INSTALLATION_TRANSITION_KEY)) throw new Error("Installation reassignment requires a fresh clinician login");
 return window.localStorage.getItem(INSTALLATION_GENERATION_KEY);
}
export function assertAuthenticationInstallationGeneration(expected: string | null): void {
 if(authenticationInstallationGeneration() !== expected) throw new Error("Installation changed; sign in again with personal credentials");
}
