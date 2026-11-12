import { platformRequestError } from "./platform-errors";

/** Transport interruption is retryable without weakening URL/MIME/HTTP checks. */
export class MediaReadInterruptedError extends Error {
  constructor() { super("Media response interrupted"); this.name = "MediaReadInterruptedError"; }
}

export async function readMediaResponse(request: () => Promise<Response>, contentType: string, invalidType: string): Promise<Blob> {
  let disconnected = false;
  const offline = () => { disconnected = true; };
  const browser = typeof window === "undefined" ? null : window;
  const offlineNow = () => typeof navigator !== "undefined" && navigator.onLine === false;
  browser?.addEventListener("offline", offline);
  try {
    let response: Response;
    try { response = await request(); }
    catch (error) {
      // Native fetch buffers the response before resolving. Remember radio loss
      // even when connectivity returns before its rejection is delivered.
      if (disconnected || offlineNow()) throw new MediaReadInterruptedError();
      throw error;
    }
    if (!response.ok) {
      throw await platformRequestError(response);
    }
    if (response.headers.get("content-type") !== contentType) throw new Error(invalidType);
    try { return await response.blob(); }
    catch (error) {
      // A broken browser response stream is transport loss, not corrupt media.
      if (error instanceof TypeError || disconnected || offlineNow()) throw new MediaReadInterruptedError();
      throw error;
    }
  } finally { browser?.removeEventListener("offline", offline); }
}
