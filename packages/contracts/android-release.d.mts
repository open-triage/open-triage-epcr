export interface AndroidReleaseDescriptor {
  schemaVersion: 1;
  applicationId: string;
  versionCode: number;
  versionName: string;
  certificateSha256: string;
  apkSha256: string;
  apkBytes: number;
  uiSha256: string;
  sourceCommit: string;
  compatibility: {
    pairingArtifact: number;
    protectedReportSchema: number;
    recoveryEnvelope: number;
    api: { minimum: number; maximum: number };
    requiredCapabilities?: readonly string[];
  };
  minAndroidApi: number;
  targetAndroidApi: number;
  artifact: string;
}

export type AndroidReleaseAvailability =
  | { status: "available"; tag: string; downloadUrl: string; descriptor: AndroidReleaseDescriptor }
  | { status: "unavailable"; reason: "not-selected" | "unverified" | "incompatible" | "unavailable" };

export declare function parseAndroidReleaseDescriptor(input: unknown): AndroidReleaseDescriptor;
export declare function isAndroidReleaseCompatible(descriptor: AndroidReleaseDescriptor, serverProtocol: number, serverCapabilities?: readonly string[]): boolean;
export declare function approvedAndroidReleaseUrl(tag: string, descriptor: AndroidReleaseDescriptor): string;
