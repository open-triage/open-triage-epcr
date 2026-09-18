/**
 * Prevents background refreshes from repeatedly requesting recovery grants
 * after the server requires fresh credentials. An explicit successful
 * reauthentication opens the gate for all reports in the current session.
 */
export class RecoveryReauthenticationGate {
  private readonly blockedReportIds = new Set<string>();

  shouldAttempt(reportId: string): boolean {
    return !this.blockedReportIds.has(reportId);
  }

  requireReauthentication(reportId: string): void {
    this.blockedReportIds.add(reportId);
  }

  reauthenticated(): void {
    this.blockedReportIds.clear();
  }
}
