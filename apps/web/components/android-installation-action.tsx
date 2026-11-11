"use client";
import { useSyncExternalStore } from "react";
import { isAndroidRuntime } from "../app/android-runtime";
import { resolveMessage } from "../app/localization";
export const ANDROID_REPLACE_INSTALLATION = "open-triage.android-replace-installation";
const subscribe = () => () => {};
export function AndroidInstallationAction({language}: {language: string}) {
  const native = useSyncExternalStore(subscribe, isAndroidRuntime, () => false);
  if (!native) return null;
  return <button type="button" data-change-installation onClick={() => window.dispatchEvent(new Event(ANDROID_REPLACE_INSTALLATION))}>{resolveMessage(language, "android.changeInstallation")}</button>;
}
