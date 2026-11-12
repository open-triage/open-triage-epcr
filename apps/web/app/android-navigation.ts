/** Back never traverses WebView history: identity and report scope belong to the shared app. */
type Handler = { priority: number; run: () => boolean | Promise<boolean> };
const handlers = new Set<Handler>();
let pending = false;

export function registerAndroidBack(run: Handler["run"], priority = 0): () => void {
  const entry = { priority, run };
  handlers.add(entry);
  return () => { handlers.delete(entry); };
}

export async function handleAndroidBack(background: () => Promise<void>): Promise<void> {
  if (pending) return;
  pending = true;
  try {
    const modal = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
      .filter(node => node.getClientRects().length > 0).at(-1);
    if (modal) {
      // Dispatch through the React subtree so media capture/delete/save guards run first.
      const target = modal.contains(document.activeElement) ? document.activeElement! :
        modal.querySelector<HTMLElement>("button, input, textarea, select, [tabindex]") ?? modal;
      const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      Object.defineProperty(escape, "androidBack", { value: true });
      target.dispatchEvent(escape);
      return;
    }
    for (const entry of [...handlers].sort((a, b) => b.priority - a.priority)) {
      if (handlers.has(entry) && await entry.run()) return;
    }
    await background();
  } finally { pending = false; }
}
