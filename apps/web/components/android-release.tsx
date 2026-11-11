"use client";
import React, { useEffect, useState } from "react";
import { approvedAndroidReleaseUrl, parseAndroidReleaseDescriptor, type AndroidReleaseAvailability } from "@open-triage/contracts";
import { loadAndroidRelease } from "../app/admin-context";
import { resolveMessage } from "../app/localization";

export function AndroidReleasePanel({ language }: { language: string }) {
  const [release, setRelease] = useState<AndroidReleaseAvailability | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  const t = (key: string) => resolveMessage(language, key);
  useEffect(() => {
    let active = true;
    void loadAndroidRelease().then(value => {
      if (value.status !== "available" && (value.status !== "unavailable" || !["not-selected", "unverified", "incompatible", "unavailable"].includes(value.reason))) throw new Error("Invalid release status");
      if (value.status === "available") {
        const descriptor = parseAndroidReleaseDescriptor(value.descriptor);
        if (value.downloadUrl !== approvedAndroidReleaseUrl(value.tag, descriptor)) throw new Error("Invalid download location");
      }
      if (active) setRelease(value);
    }).catch(() => { if (active) setRelease({ status: "unavailable", reason: "unavailable" }); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [attempt]);
  return <section className="android-release-section" aria-labelledby="android-release-heading" aria-busy={busy}>
    <div className="section-heading"><h3 id="android-release-heading">{t("androidRelease.title")}</h3>
      <button type="button" disabled={busy} onClick={() => { setBusy(true); setAttempt(value => value + 1); }}>{t("androidRelease.refresh")}</button></div>
    {busy && <p role="status">{t("androidRelease.verifying")}</p>}
    {release?.status === "unavailable" && !busy && <p role="status">{t(`androidRelease.${release.reason}`)}</p>}
    {release?.status === "available" && <>
      <dl className="android-release-metadata">
        <div><dt>{t("androidRelease.version")}</dt><dd>{release.descriptor.versionName} ({release.descriptor.versionCode})</dd></div>
        <div><dt>{t("androidRelease.url")}</dt><dd><code>{release.downloadUrl}</code></dd></div>
        <div><dt>{t("androidRelease.digest")}</dt><dd><code>{release.descriptor.apkSha256}</code></dd></div>
      </dl>
      {!busy && <a className="button-link button-primary" href={release.downloadUrl} rel="noopener noreferrer" target="_blank">{t("androidRelease.download")}</a>}
    </>}
  </section>;
}
