"use client";
import { useEffect, useEffectEvent } from "react";
import { registerAndroidBack } from "../app/android-navigation";

export function useAndroidBack(handler: () => boolean | Promise<boolean>, priority = 0) {
  const latest = useEffectEvent(handler);
  useEffect(() => registerAndroidBack(() => latest(), priority), [priority]);
}
