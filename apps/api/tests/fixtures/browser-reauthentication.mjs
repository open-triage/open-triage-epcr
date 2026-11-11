/** Explicit legacy protocol regression; application actions never request this.
 * Authentication navigates away; its promise belongs to the outgoing document. */
export async function beginBrowserReauthentication(page) {
  await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("open-triage.clinician-session.v1"));
    void fixture.reauthenticateClinicianSession("", session.csrfToken, true).catch(() => {});
  });
  await page.getByRole("link", { name: "Continue fictional provider login", exact: true }).waitFor({ state: "visible" });
}
