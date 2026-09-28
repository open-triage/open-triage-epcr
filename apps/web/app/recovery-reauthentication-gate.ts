/**
 * Prevents background refreshes from repeatedly requesting recovery grants
 * after the server requires fresh credentials. An explicit successful
 * reauthentication opens the gate for all reports in the current session.
 */
export class RecoveryReauthenticationGate {
  private readonly blockedReportIds = new Set<string>();
  private readonly checkedReportIds = new Set<string>();

  shouldAttempt(reportId: string): boolean {
    return !this.blockedReportIds.has(reportId) && !this.checkedReportIds.has(reportId);
  }

  /** A completed report only needs one successful recovery check per session. */
  checked(reportId: string): void {
    this.checkedReportIds.add(reportId);
  }

  requireReauthentication(reportId: string): void {
    this.blockedReportIds.add(reportId);
  }

  reauthenticated(): void {
    this.blockedReportIds.clear();
    this.checkedReportIds.clear();
  }
}
