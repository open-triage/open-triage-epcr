let scope: string | undefined;
let legacyScope: string | undefined;
/** Opaque SHA-256 server-origin identity supplied by the native vault before UI mount. */
export function setNativeStorageScope(value: string, legacyProof?: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("Invalid native storage context");
  if (legacyProof !== undefined) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(legacyProof) || legacyScope !== undefined && legacyScope !== legacyProof) throw new Error("Invalid legacy storage proof");
    legacyScope = legacyProof;
  }
  scope = value;
}
export function nativeStorageScope(): string | undefined { return scope; }

export function nativeLegacyStorageScope(): string | undefined { return legacyScope; }
