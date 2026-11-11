import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isAndroidRuntime } from "./android-runtime";
import { setNativeForeground } from "./application-foreground";
import { handleAndroidBack } from "./android-navigation";

type LifecyclePlugin = {
  state(): Promise<{ active: boolean }>;
  background(): Promise<void>;
  addListener(event: "foreground", listener: (state: { active: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: "back", listener: () => void): Promise<PluginListenerHandle>;
};
const lifecycle = registerPlugin<LifecyclePlugin>("OpenTriageLifecycle");
let installation: Promise<void> | undefined;
/** Attach before mounting clinical components, retaining events across activity pauses. */
export function installAndroidLifecycle(): Promise<void> {
  if (!isAndroidRuntime()) return Promise.resolve();
  return installation ??= (async () => {
    let revision = 0;
    await lifecycle.addListener("foreground", state => { revision++; setNativeForeground(state.active); });
    await lifecycle.addListener("back", () => {
      // A failed boundary stays on the current screen; never fall through to history or exit.
      void handleAndroidBack(() => lifecycle.background()).catch(() => {});
    });
    const before = revision;
    const initial = await lifecycle.state();
    if (before === revision) setNativeForeground(initial.active);
  })().catch(error => { installation = undefined; throw error; });
}
