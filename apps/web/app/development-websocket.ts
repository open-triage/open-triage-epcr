import { Capacitor } from "@capacitor/core";
import { createWebSocket as connect } from "next/dist/client/dev/hot-reloader/app/web-socket.js";

export { createProcessTurbopackMessage, useWebSocketPing } from "next/dist/client/dev/hot-reloader/app/web-socket.js";

/** Native HTTP transport cannot carry HMR. Its reconnect budget would reload a healthy UI. */
export function createWebSocket(...args: Parameters<typeof connect>): WebSocket {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    // Next passes this handle to its ping hook, which only sends on OPEN sockets.
    // Do not install reconnect, online or visibility handlers in this environment.
    return Object.assign(new EventTarget(), {
      readyState: WebSocket.CLOSED,
      OPEN: WebSocket.OPEN,
      close() {},
      send() {},
    }) as unknown as WebSocket;
  }
  return connect(...args);
}
