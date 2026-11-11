import { Inject, Injectable, Optional } from "@nestjs/common";
import { approvedAndroidReleaseUrl, isAndroidReleaseCompatible, parseAndroidReleaseDescriptor, type AndroidReleaseAvailability } from "@open-triage/contracts";
import { ANDROID_API_PROTOCOL_VERSION, ANDROID_API_CAPABILITIES } from "@open-triage/contracts/android-client-protocol";
import { verifyAndroidArtifact } from "@open-triage/contracts/android-artifact";
import catalog from "@open-triage/contracts/config/android-releases.json";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

export const ANDROID_RELEASE_FETCH = "ANDROID_RELEASE_FETCH";
export const ANDROID_RELEASE_CATALOG = "ANDROID_RELEASE_CATALOG";
const unavailable = (reason: Extract<AndroidReleaseAvailability, { status: "unavailable" }>["reason"]): AndroidReleaseAvailability => ({ status: "unavailable", reason });


@Injectable()
export class AndroidReleaseService {
  private readonly verified = new Map<string, { expiresAt: number; value: AndroidReleaseAvailability }>();
  private readonly pending = new Map<string, Promise<AndroidReleaseAvailability>>();
  constructor(private readonly sessions: ClinicianSessionService,
    @Optional() @Inject(ANDROID_RELEASE_FETCH) private readonly fetcher: typeof fetch = fetch,
    @Optional() @Inject(ANDROID_RELEASE_CATALOG) private readonly approved: unknown = catalog) {}

  async read(token: string): Promise<AndroidReleaseAvailability> {
    await this.sessions.requireCapability(token, "settings:read");
    const selection = process.env.ANDROID_APPROVED_RELEASE;
    if (!selection) return unavailable("not-selected");
    const cached = this.verified.get(selection);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    let pending = this.pending.get(selection);
    if (!pending) {
      pending = this.load(selection).then(value => {
        this.verified.set(selection, { value, expiresAt: Date.now() + (value.status === "available" ? 60_000 : 5_000) }); return value;
      }).finally(() => this.pending.delete(selection));
      this.pending.set(selection, pending);
    }
    const value = await pending;
    return process.env.ANDROID_APPROVED_RELEASE === selection ? value : unavailable("not-selected");
  }

  private async load(selection: string): Promise<AndroidReleaseAvailability> {
    const value = this.approved as typeof catalog | null;
    if (value?.schemaVersion !== 1 || !Array.isArray(value.releases)) return unavailable("unverified");
    const entry = value.releases.find(release => release?.tag === selection);
    if (!entry) return unavailable("unverified");
    let descriptor;
    try {
      descriptor = parseAndroidReleaseDescriptor(entry.descriptor);
      if (descriptor.applicationId !== value.signingIdentity.applicationId || descriptor.certificateSha256 !== value.signingIdentity.certificateSha256 ||
        entry.downloadUrl !== approvedAndroidReleaseUrl(entry.tag, descriptor)) return unavailable("unverified");
    } catch { return unavailable("unverified"); }
    if (!isAndroidReleaseCompatible(descriptor, ANDROID_API_PROTOCOL_VERSION, ANDROID_API_CAPABILITIES)) return unavailable("incompatible");
    try { await verifyAndroidArtifact(entry.downloadUrl, descriptor.apkBytes, descriptor.apkSha256, this.fetcher); }
    catch { return unavailable("unavailable"); }
    return { status: "available", tag: entry.tag, downloadUrl: entry.downloadUrl, descriptor };
  }
}
