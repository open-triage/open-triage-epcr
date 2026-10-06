/**
 * Prevents background refreshes from repeatedly requesting recovery grants
 * after the server requires fresh credentials. An explicit successful
 * reauthentication opens the gate for all reports in the current session.
 */
export class RecoveryReauthenticationGate {
  private reauthenticationRequired = false;
  private readonly checkedReportIds = new Set<string>();

  shouldAttempt(reportId: string): boolean {
    return !this.reauthenticationRequired && !this.checkedReportIds.has(reportId);
  }

  /** A completed report only needs one successful recovery check per session. */
  checked(reportId: string): void {
    this.checkedReportIds.add(reportId);
  }

  requireReauthentication(): void {
    this.reauthenticationRequired = true;
  }

  reauthenticated(): void {
    this.reauthenticationRequired = false;
    this.checkedReportIds.clear();
  }
}
