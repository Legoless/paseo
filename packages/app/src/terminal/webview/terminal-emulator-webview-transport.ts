export type TerminalGuestTransportKind = "electron" | "react-native";

export const TERMINAL_GUEST_MESSAGE_CHANNEL = "paseo:terminal-guest-message";

interface TerminalGuestBridge {
  sendToHost: (channel: string, message: string) => void;
  onHostMessage: (handler: (message: string) => void) => void;
}

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage?: (data: string) => void;
    };
    __PASEO_TERMINAL_TRANSPORT__?: TerminalGuestTransportKind;
    __PASEO_TERMINAL_GUEST__?: TerminalGuestBridge;
  }
}

/**
 * The guest bundle is shared by the native RN-WebView host and the Electron `<webview>` host. The
 * Electron preload injects `__PASEO_TERMINAL_TRANSPORT__ = "electron"`; everything else keeps the
 * ReactNativeWebView transport. Message shapes are identical either way.
 */
export function resolveTerminalGuestTransportKind(): TerminalGuestTransportKind {
  return window.__PASEO_TERMINAL_TRANSPORT__ === "electron" ? "electron" : "react-native";
}

export function sendTerminalGuestMessage(message: unknown): void {
  const serialized = JSON.stringify(message);
  if (resolveTerminalGuestTransportKind() === "electron") {
    window.__PASEO_TERMINAL_GUEST__?.sendToHost(TERMINAL_GUEST_MESSAGE_CHANNEL, serialized);
    return;
  }
  window.ReactNativeWebView?.postMessage?.(serialized);
}

export function subscribeTerminalGuestMessages(handler: (message: unknown) => void): void {
  if (resolveTerminalGuestTransportKind() !== "electron") {
    return;
  }
  window.__PASEO_TERMINAL_GUEST__?.onHostMessage((serialized) => {
    try {
      handler(JSON.parse(serialized));
    } catch {
      // Malformed host messages are dropped; the bridge reports receive failures itself.
    }
  });
}
