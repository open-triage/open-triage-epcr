"use client";
import { useEffect, useState } from "react";
import { ANDROID_TLS_STATUS_EVENT } from "../app/android-connection-failure";
import { resolveMessage } from "../app/localization";

/** Keep the clinical subtree mounted so a failed connection never discards its draft. */
export function AndroidTlsNotice() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const changed = (event: Event) => setFailed(Boolean((event as CustomEvent<{ failed: boolean }>).detail?.failed));
    window.addEventListener(ANDROID_TLS_STATUS_EVENT, changed);
    return () => window.removeEventListener(ANDROID_TLS_STATUS_EVENT, changed);
  }, []);
  return failed ? <p role="alert" className="admin-error" data-android-tls-failure>{resolveMessage(document.documentElement.lang, "android.tlsFailed")}</p> : null;
}
