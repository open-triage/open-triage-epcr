export declare const ANDROID_API_PROTOCOL_VERSION: 1;
export declare const ANDROID_CLIENT_API_PROTOCOL_RANGE: Readonly<{ minimum: 1; maximum: 1 }>;
export declare const ANDROID_API_CAPABILITIES: readonly string[];
export declare const ANDROID_CLIENT_REQUIRED_CAPABILITIES: readonly string[];
export declare function isAndroidApiProtocolCompatible(range: { minimum: number; maximum: number } | null | undefined, serverProtocol: unknown): boolean;
