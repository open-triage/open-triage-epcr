"use client";
import { resolveMessage } from "../app/localization";
import { OidcDraftPanel } from "./oidc-draft";

export function AuthenticationPolicyPanel({ language, csrfToken, canWrite }: { language: string; csrfToken: string; canWrite: boolean }) {
  return <section className="admin-configuration agency-settings authentication-policy" aria-labelledby="authentication-heading">
    <div className="section-heading"><h2 id="authentication-heading">{resolveMessage(language, "admin.authentication")}</h2></div>
    <OidcDraftPanel language={language} csrfToken={csrfToken} canWrite={canWrite}/>
  </section>;
}
