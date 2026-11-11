export declare function verifyAndroidArtifact(url: string, bytes: number, digest: string, fetcher?: typeof fetch, onBytes?: (value: Uint8Array) => void | Promise<void>): Promise<void>;
