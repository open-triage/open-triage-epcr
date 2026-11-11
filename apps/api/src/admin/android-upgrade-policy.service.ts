import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { DataSource, type EntityManager } from "typeorm";
import { evaluateAndroidUpgrade, parseAndroidReleaseLifecycle, parseAndroidUpgradeGraceDays,
  type AndroidUpgradePolicy, type AndroidUpgradePolicyView, type AndroidUpgradePolicyPreview, type AndroidReleaseRecord } from "@open-triage/contracts/android-upgrade-policy";
import { parseAndroidReleaseDescriptor, approvedAndroidReleaseUrl } from "@open-triage/contracts/android-release";
import { ANDROID_API_PROTOCOL_VERSION, ANDROID_API_CAPABILITIES } from "@open-triage/contracts/android-client-protocol";
import catalog from "@open-triage/contracts/config/android-releases.json";
import lifecycle from "@open-triage/contracts/config/android-release-lifecycle.json";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { AndroidReleaseService, ANDROID_RELEASE_CATALOG } from "./android-release.service.js";
import { InstallationEnrollmentService } from "./installation-enrollment.service.js";
export const ANDROID_RELEASE_LIFECYCLE = "ANDROID_RELEASE_LIFECYCLE";
type PolicyRow = { grace_days: number; revision: number; updated_at: Date | string };
function command(input: unknown, saving: boolean) {
  const value = input as Record<string, unknown> | null;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["graceDays", "expectedRevision", ...(saving ? ["previewToken"] : [])].includes(key)) ||
      !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1 ||
      saving && (typeof value.previewToken !== "string" || !/^[a-f0-9]{64}$/.test(value.previewToken))) throw new BadRequestException({ code: "android.policyInvalid" });
  try { return { graceDays: parseAndroidUpgradeGraceDays(value.graceDays), expectedRevision: Number(value.expectedRevision), previewToken: value.previewToken }; }
  catch { throw new BadRequestException({ code: "android.policyInvalid" }); }
}
@Injectable()
export class AndroidUpgradePolicyService {
  constructor(@InjectDataSource() private readonly database: DataSource,
    private readonly sessions: ClinicianSessionService, private readonly releases: AndroidReleaseService,
    private readonly enrollment: InstallationEnrollmentService,
    @Optional() @Inject(ANDROID_RELEASE_CATALOG) private readonly approved: unknown = catalog,
    @Optional() @Inject(ANDROID_RELEASE_LIFECYCLE) private readonly lifecycle: unknown = lifecycle) {}

  private async administrator(token: string, manager = this.database.manager) {
    const session = await this.sessions.getAuthenticated(token, new Date(), false, manager);
    if (!session.installationOwner && !session.installationSuperadmin) throw new ForbiddenException({ code: "android.policyForbidden" });
    return session;
  }
  private async policy(manager: Pick<EntityManager, "query"> = this.database.manager, lock = false): Promise<AndroidUpgradePolicy> {
    const [row] = await manager.query<PolicyRow[]>(`select grace_days, revision, updated_at from app_identity.android_upgrade_policy where singleton${lock ? " for update" : ""}`);
    if (!row) throw new Error("Android installation policy missing");
    return { graceDays: row.grace_days, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString() };
  }
  private async inputs() {
    const value = this.approved as typeof catalog;
    if (value?.schemaVersion !== 1 || !Array.isArray(value.releases)) throw new Error("Invalid approved Android releases");
    const seen = new Set<number>();
    const records: AndroidReleaseRecord[] = value.releases.map(entry => {
      const descriptor = parseAndroidReleaseDescriptor(entry.descriptor);
      if (seen.has(descriptor.versionCode) || descriptor.applicationId !== value.signingIdentity.applicationId || descriptor.certificateSha256 !== value.signingIdentity.certificateSha256 || entry.downloadUrl !== approvedAndroidReleaseUrl(entry.tag, descriptor)) throw new Error("Invalid approved Android release identity");
      seen.add(descriptor.versionCode); return { tag: entry.tag, descriptor, downloadUrl: entry.downloadUrl };
    });
    const retirements = parseAndroidReleaseLifecycle(this.lifecycle, records);
    const selection = process.env.ANDROID_APPROVED_RELEASE ?? "";
    const replacement = await this.releases.verifiedSelection();
    if (selection !== (process.env.ANDROID_APPROVED_RELEASE ?? "")) throw new ConflictException({ code: "android.policyChanged" });
    // A verified network result alone is insufficient: bind it to this exact approved catalog.
    if (replacement.status === "available" && !records.some(entry => entry.tag === replacement.tag && JSON.stringify(entry.descriptor) === JSON.stringify(replacement.descriptor) && entry.downloadUrl === replacement.downloadUrl)) throw new Error("Android release inputs changed");
    return { records, retirements, replacement, selection };
  }
  private evaluate(inputs: Awaited<ReturnType<AndroidUpgradePolicyService["inputs"]>>, days: number, serverTime: string, versionCode: number) {
    return evaluateAndroidUpgrade({ versionCode, releases: inputs.records, retirements: inputs.retirements, graceDays: days, serverTime,
      serverProtocol: ANDROID_API_PROTOCOL_VERSION, serverCapabilities: ANDROID_API_CAPABILITIES, replacement: inputs.replacement });
  }
  private previewProof(policy: AndroidUpgradePolicy, days: number, inputs: Awaited<ReturnType<AndroidUpgradePolicyService["inputs"]>>) {
    return createHash("sha256").update(JSON.stringify({ revision: policy.revision, days, records: inputs.records, retirements: inputs.retirements,
      replacement: inputs.replacement, protocol: ANDROID_API_PROTOCOL_VERSION, capabilities: ANDROID_API_CAPABILITIES })).digest("hex");
  }
  private view(policy: AndroidUpgradePolicy, inputs: Awaited<ReturnType<AndroidUpgradePolicyService["inputs"]>>, serverTime: string): AndroidUpgradePolicyView {
    return { policy, serverTime, clients: inputs.records.map(entry => this.evaluate(inputs, policy.graceDays, serverTime, entry.descriptor.versionCode)) };
  }
  async read(token: string): Promise<AndroidUpgradePolicyView> {
    await this.administrator(token);
    const [policy, inputs] = await Promise.all([this.policy(), this.inputs()]);
    return this.view(policy, inputs, new Date().toISOString());
  }
  async preview(token: string, input: unknown): Promise<AndroidUpgradePolicyPreview> {
    await this.administrator(token);
    const requested = command(input, false), [policy, inputs] = await Promise.all([this.policy(), this.inputs()]);
    if (policy.revision !== requested.expectedRevision) throw new ConflictException({ code: "android.policyChanged" });
    const serverTime = new Date().toISOString();
    return { ...this.view(policy, inputs, serverTime), proposedGraceDays: requested.graceDays,
      previewToken: this.previewProof(policy, requested.graceDays, inputs),
      proposedClients: inputs.records.map(entry => this.evaluate(inputs, requested.graceDays, serverTime, entry.descriptor.versionCode)) };
  }
  async update(token: string, input: unknown): Promise<AndroidUpgradePolicyView> {
    const requested = command(input, true);
    await this.administrator(token);
    const inputs = await this.inputs(); // Verify bounded APK bytes before taking the policy write lock.
    return this.database.transaction(async manager => {
      const policy = await this.policy(manager, true);
      // Sample the exact live session again after row-lock waits/downloads. No fresh proof is requested.
      const actor = await this.administrator(token, manager);
      const currentReplacement = this.releases.currentVerifiedSelection();
      if (inputs.selection !== (process.env.ANDROID_APPROVED_RELEASE ?? "") || !currentReplacement || JSON.stringify(currentReplacement) !== JSON.stringify(inputs.replacement)) throw new ConflictException({ code: "android.policyChanged" });
      if (policy.revision !== requested.expectedRevision || requested.previewToken !== this.previewProof(policy, requested.graceDays, inputs)) throw new ConflictException({ code: "android.policyChanged" });
      if (requested.graceDays === policy.graceDays) return this.view(policy, inputs, new Date().toISOString());
      const [updated] = mutationRows<PolicyRow>(await manager.query(`update app_identity.android_upgrade_policy set grace_days=$1, revision=revision+1, updated_at=clock_timestamp(), updated_by=$2
        where singleton returning grace_days,revision,updated_at`, [requested.graceDays, actor.user.id]));
      const saved = { graceDays: updated!.grace_days, revision: updated!.revision, updatedAt: new Date(updated!.updated_at).toISOString() };
      await manager.query(`insert into app_identity.android_upgrade_policy_event(actor_id,action,before_policy,after_policy,release_inputs_sha256)
        values ($1,'android.upgrade-policy.update',$2,$3,$4)`, [actor.user.id, JSON.stringify(policy), JSON.stringify(saved), requested.previewToken]);
      return this.view(saved, inputs, new Date().toISOString());
    });
  }
  async client(token: string, credential: string | undefined, versionCode: number) {
    if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 21e8) throw new BadRequestException({ code: "android.clientInvalid" });
    if (credential) await this.enrollment.current(credential);
    else {
      if (!token) throw new UnauthorizedException({ code: "auth.sessionRequired" });
      await this.sessions.getAuthenticated(token, new Date(), false);
    }
    const [policy, inputs] = await Promise.all([this.policy(), this.inputs()]);
    return { ...this.evaluate(inputs, policy.graceDays, new Date().toISOString(), versionCode), policyRevision: policy.revision, graceDays: policy.graceDays };
  }
}
