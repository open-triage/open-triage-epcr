import { APPLICATION_FOREGROUND_EVENT, applicationVisible } from "./application-foreground";

/** Permission dialogs and native lifecycle changes need not change DOM visibility. */
export function observeMediaInterruption(interrupt: () => void): () => void {
  const changed = () => { if (!applicationVisible()) interrupt(); };
  window.addEventListener(APPLICATION_FOREGROUND_EVENT, changed);
  document.addEventListener("visibilitychange", changed);
  window.addEventListener("pagehide", interrupt);
  return () => {
    window.removeEventListener(APPLICATION_FOREGROUND_EVENT, changed);
    document.removeEventListener("visibilitychange", changed);
    window.removeEventListener("pagehide", interrupt);
  };
}
