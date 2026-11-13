"use client";
import React, { useEffect, useState } from "react";
import { resolveMessage } from "../app/localization";
import { UI_UPDATE_CHECK_EVENT, UI_UPDATE_FAILED_EVENT } from "../app/ui-update-boundary";

export function NativeUiLoading() {
  const [unavailable, setUnavailable] = useState(() => typeof navigator !== "undefined" && !navigator.onLine), [attempt, setAttempt] = useState(0);
  const t = (key: string) => resolveMessage(document.documentElement.lang, key);
  useEffect(() => {
    const failed = () => setUnavailable(true);
    const timer = window.setTimeout(failed, 20_000);
    window.addEventListener(UI_UPDATE_FAILED_EVENT, failed);
    return () => { window.clearTimeout(timer); window.removeEventListener(UI_UPDATE_FAILED_EVENT, failed); };
  }, [attempt]);
  return <main className="login-shell"><section className="login-card native-ui-loading">
    <h1>{t("android.uiLoading")}</h1>
    {unavailable ? <><p role="status">{t("android.uiUnavailable")}</p><button className="button-primary" type="button" onClick={() => {
      setUnavailable(false); setAttempt(value => value + 1); window.dispatchEvent(new Event(UI_UPDATE_CHECK_EVENT));
    }}>{t("admin.retry")}</button></> : <p role="status" aria-busy="true">{t("login.opening")}</p>}
  </section></main>;
}

