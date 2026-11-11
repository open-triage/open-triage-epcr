import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isAndroidRuntime } from "./android-runtime";
import { setNativeForeground } from "./application-foreground";

type LifecyclePlugin = {
  state(): Promise<{ active: boolean }>;
  addListener(event: "foreground", listener: (state: { active: boolean }) => void): Promise<PluginListenerHandle>;
};
const lifecycle = registerPlugin<LifecyclePlugin>("OpenTriageLifecycle");
let installation: Promise<void> | undefined;
/** Attach before mounting clinical components, retaining events across activity pauses. */
export function installAndroidLifecycle(): Promise<void> {
  if (!isAndroidRuntime()) return Promise.resolve();
  return installation ??= (async () => {
    let revision = 0;
    await lifecycle.addListener("foreground", state => { revision++; setNativeForeground(state.active); });
    const before = revision;
    const initial = await lifecycle.state();
    if (before === revision) setNativeForeground(initial.active);
  })().catch(error => { installation = undefined; throw error; });
}
