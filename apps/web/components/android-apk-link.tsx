"use client";
import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { isAndroidRuntime } from "../app/android-runtime";

const subscribe = () => () => {};
export const APK_DOWNLOAD_FAILED = "open-triage.apk-download-failed";
type Props = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel" | "referrerPolicy" | "onClick"> & {
  verifiedUrl: string;
  unavailableMessage: string;
};

/** The parent validates this exact URL against its server/catalog release metadata. */
export function AndroidApkLink({ verifiedUrl, unavailableMessage, children, ...props }: Props) {
  const native = useSyncExternalStore(subscribe, isAndroidRuntime, () => false);
  const attempted = useRef<string | null>(null), [failed, setFailed] = useState<string | null>(null);
  const errorId = useId();
  useEffect(() => {
    attempted.current = null;
    if (!native) return;
    const unavailable = (event: Event) => {
      if (attempted.current === verifiedUrl && (event as CustomEvent<{ url?: string }>).detail?.url === verifiedUrl) setFailed(verifiedUrl);
    };
    window.addEventListener(APK_DOWNLOAD_FAILED, unavailable);
    return () => window.removeEventListener(APK_DOWNLOAD_FAILED, unavailable);
  }, [native, verifiedUrl]);
  return <>
    <a {...props} href={verifiedUrl} target={native ? undefined : "_blank"} rel="noopener noreferrer" referrerPolicy="no-referrer"
      aria-describedby={failed === verifiedUrl ? errorId : undefined} onClick={() => { attempted.current = verifiedUrl; setFailed(null); }}>{children}</a>
    {failed === verifiedUrl && <p id={errorId} role="alert" className="admin-error">{unavailableMessage}</p>}
  </>;
}
