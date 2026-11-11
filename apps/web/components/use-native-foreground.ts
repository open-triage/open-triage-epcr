"use client";
import { useSyncExternalStore } from "react";
import { APPLICATION_FOREGROUND_EVENT, foregroundNetworkAllowed } from "../app/application-foreground";

function subscribe(changed: () => void): () => void {
  window.addEventListener(APPLICATION_FOREGROUND_EVENT, changed);
  return () => window.removeEventListener(APPLICATION_FOREGROUND_EVENT, changed);
}
/** Native pause/resume rerenders automatic readers even when connectivity is unchanged. */
export function useNativeForeground(): boolean {
  return useSyncExternalStore(subscribe, foregroundNetworkAllowed, () => true);
}
