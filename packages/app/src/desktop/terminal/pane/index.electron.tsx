import {
  createElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { StyleSheet, View } from "react-native";
import type { ITheme } from "@xterm/xterm";
import type { TerminalState } from "@getpaseo/protocol/messages";
import type { TerminalInputModeState } from "@getpaseo/protocol/terminal-input-mode";
import type { TerminalOutputData } from "@/terminal/runtime/terminal-emulator-runtime";
import type {
  TerminalLocalFileLinkSource,
  TerminalLocalFileLinkTarget,
} from "@/terminal/local-links/terminal-local-link-provider";
import type { PendingTerminalModifiers } from "@/utils/terminal-keys";
import { openExternalUrl } from "@/utils/open-external-url";
import { getDesktopHost } from "@/desktop/host";
import { selectTerminalClipboardWriter } from "@/desktop/terminal/copy-selection";
import type {
  TerminalEmulatorHandle,
  TerminalEmulatorProps,
} from "@/components/terminal-emulator-contract";
import { shouldHandleTerminalBridgeMessage } from "@/components/terminal-webview-message-routing";
import { TERMINAL_GUEST_MESSAGE_CHANNEL } from "@/terminal/webview/terminal-emulator-webview-transport";
import {
  INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
  isTerminalGuestOverlayVisible,
  reduceTerminalGuestLifecycle,
  scheduleDeferredReload,
  shouldScheduleDeferredReload,
} from "@/desktop/terminal/guest-lifecycle";
import { TerminalGuestCrashOverlay } from "./crash-overlay";

type BridgeInboundMessage =
  | {
      type: "mount";
      streamKey: string;
      initialSnapshot: TerminalState | null;
      scrollbackLines: number;
      theme: ITheme;
      fontFamily?: string;
      fontSize?: number;
      pendingModifiers: PendingTerminalModifiers;
      swipeGesturesEnabled: boolean;
    }
  | { type: "unmount"; streamKey: string }
  | { type: "writeOutput"; streamKey: string; text: string }
  | { type: "restoreOutput"; streamKey: string; text: string }
  | { type: "renderSnapshot"; streamKey: string; state: TerminalState | null }
  | { type: "paste"; streamKey: string; text: string }
  | { type: "clear"; streamKey: string }
  | { type: "focus"; streamKey: string; forceRefocus?: boolean }
  | { type: "resize"; streamKey: string; forceClaim: boolean; shouldClaim?: boolean }
  | { type: "setTheme"; streamKey: string; theme: ITheme }
  | { type: "setScrollback"; streamKey: string; lines: number }
  | { type: "setFont"; streamKey: string; fontFamily?: string; fontSize?: number }
  | { type: "setPendingModifiers"; streamKey: string; pendingModifiers: PendingTerminalModifiers }
  | { type: "setSwipeGesturesEnabled"; streamKey: string; enabled: boolean }
  | {
      type: "resolveLocalFileLinkResponse";
      streamKey: string;
      requestId: number;
      target: TerminalLocalFileLinkTarget | null;
    };

type BridgeOutboundMessage =
  | { type: "bridgeReady" }
  | { type: "rendererReady"; streamKey: string; isReady: boolean }
  | { type: "input"; streamKey: string; data: string }
  | {
      type: "resize";
      streamKey: string;
      rows: number;
      cols: number;
      shouldClaim?: boolean;
      forceClaim?: boolean;
    }
  | {
      type: "terminalKey";
      streamKey: string;
      key: string;
      ctrl: boolean;
      shift: boolean;
      alt: boolean;
      meta: boolean;
    }
  | { type: "pendingModifiersConsumed"; streamKey: string }
  | { type: "inputModeChange"; streamKey: string; state: TerminalInputModeState }
  | { type: "openExternalUrl"; streamKey: string; url: string }
  | {
      type: "resolveLocalFileLink";
      streamKey: string;
      requestId: number;
      source: TerminalLocalFileLinkSource;
    }
  | {
      type: "openLocalFileLink";
      streamKey: string;
      target: TerminalLocalFileLinkTarget;
      disposition: "main" | "side";
    }
  | { type: "swipeLeft"; streamKey: string }
  | { type: "swipeRight"; streamKey: string }
  | { type: "copySelection"; streamKey: string; text: string }
  | { type: "debug"; message: string; details?: unknown };

interface ElectronTerminalWebview extends HTMLElement {
  src: string;
  send: (channel: string, ...args: unknown[]) => void;
  executeJavaScript?: (code: string) => Promise<unknown>;
  getWebContentsId?: () => number;
}

interface WebviewIpcMessageEvent extends Event {
  channel: string;
  args: unknown[];
}

interface RenderProcessGoneEvent extends Event {
  details?: { reason?: string };
}

const TERMINAL_GUEST_PATH = "/terminal-guest.html";
const READ_GUEST_SELECTION_SCRIPT =
  "window.__PASEO_TERMINAL_WEBVIEW_GET_SELECTION__ ? window.__PASEO_TERMINAL_WEBVIEW_GET_SELECTION__() : ''";

async function writeTerminalClipboardText(text: string): Promise<void> {
  const writer = selectTerminalClipboardWriter({
    bridge: getDesktopHost()?.terminal,
    fallback: {
      writeText: (value) => navigator.clipboard.writeText(value),
    },
  });
  await writer.writeText(text);
}

const HOST_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  display: "flex",
  overflow: "hidden",
};

function buildThemeKey(theme: ITheme): string {
  return JSON.stringify(theme);
}

function createMountMessage(input: {
  streamKey: string;
  initialSnapshot: TerminalState | null;
  scrollbackLines: number;
  theme: ITheme;
  fontFamily?: string;
  fontSize?: number;
  pendingModifiers: PendingTerminalModifiers;
  swipeGesturesEnabled: boolean;
}): BridgeInboundMessage {
  return {
    type: "mount",
    streamKey: input.streamKey,
    initialSnapshot: input.initialSnapshot,
    scrollbackLines: input.scrollbackLines,
    theme: input.theme,
    fontFamily: input.fontFamily,
    fontSize: input.fontSize,
    pendingModifiers: input.pendingModifiers,
    swipeGesturesEnabled: input.swipeGesturesEnabled,
  };
}

/**
 * Electron isolated terminal renderer. The guest is a same-origin `<webview>` running the shared
 * terminal bundle in its own renderer process; the main renderer relays the daemon stream over
 * `webview.send` / `ipc-message` using the native bridge message shapes unchanged.
 */
export function IsolatedTerminalEmulator({
  ref,
  streamKey,
  testId = "terminal-surface",
  xtermTheme = {
    background: "#0b0b0b",
    foreground: "#e6e6e6",
    cursor: "#e6e6e6",
  },
  scrollbackLines,
  fontFamily,
  fontSize,
  swipeGesturesEnabled = false,
  onSwipeLeft,
  onSwipeRight,
  initialSnapshot = null,
  onInput,
  onFocus,
  onResize,
  onTerminalKey,
  onPendingModifiersConsumed,
  onInputModeChange,
  onResolveLocalFileLink,
  onOpenLocalFileLink,
  onRendererReadyChange,
  pendingModifiers = { ctrl: false, shift: false, alt: false },
  focusRequestToken = 0,
  resizeRequestToken = 0,
}: TerminalEmulatorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<ElectronTerminalWebview | null>(null);
  const [bridgeReadyVersion, setBridgeReadyVersion] = useState(0);
  const [lifecycle, dispatchLifecycle] = useReducer(
    reduceTerminalGuestLifecycle,
    INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
  );
  const bridgeReadyRef = useRef(false);
  const pendingMessagesRef = useRef<BridgeInboundMessage[]>([]);
  const outputDecoderRef = useRef(new TextDecoder());
  const mountRequestedStreamKeyRef = useRef<string | null>(null);
  const rendererReadyStreamKeyRef = useRef<string | null>(null);
  const mountConfigRef = useRef({
    streamKey,
    initialSnapshot,
    scrollbackLines,
    theme: xtermTheme,
    fontFamily,
    fontSize,
    pendingModifiers,
    swipeGesturesEnabled,
  });
  mountConfigRef.current = {
    streamKey,
    initialSnapshot,
    scrollbackLines,
    theme: xtermTheme,
    fontFamily,
    fontSize,
    pendingModifiers,
    swipeGesturesEnabled,
  };
  const callbacksRef = useRef({
    onInput,
    onFocus,
    onResize,
    onTerminalKey,
    onPendingModifiersConsumed,
    onInputModeChange,
    onRendererReadyChange,
    onResolveLocalFileLink,
    onOpenLocalFileLink,
    onSwipeLeft,
    onSwipeRight,
  });
  callbacksRef.current = {
    onInput,
    onFocus,
    onResize,
    onTerminalKey,
    onPendingModifiersConsumed,
    onInputModeChange,
    onRendererReadyChange,
    onResolveLocalFileLink,
    onOpenLocalFileLink,
    onSwipeLeft,
    onSwipeRight,
  };

  const sendToWebView = useCallback((message: BridgeInboundMessage) => {
    const webview = webviewRef.current;
    if (!bridgeReadyRef.current || !webview) {
      pendingMessagesRef.current.push(message);
      return;
    }
    webview.send(TERMINAL_GUEST_MESSAGE_CHANNEL, JSON.stringify(message));
  }, []);

  const flushPendingMessages = useCallback(() => {
    const webview = webviewRef.current;
    if (!bridgeReadyRef.current || !webview) {
      return;
    }
    const pending = pendingMessagesRef.current.splice(0);
    for (const message of pending) {
      webview.send(TERMINAL_GUEST_MESSAGE_CHANNEL, JSON.stringify(message));
    }
  }, []);

  useImperativeHandle(
    ref,
    (): TerminalEmulatorHandle => ({
      writeOutput: (data: TerminalOutputData) => {
        const output = outputDecoderRef.current.decode(data, { stream: true });
        if (output.length === 0) {
          return;
        }
        sendToWebView({ type: "writeOutput", streamKey, text: output });
      },
      restoreOutput: (data: TerminalOutputData) => {
        outputDecoderRef.current.decode();
        const text = outputDecoderRef.current.decode(data, { stream: false });
        if (text.length === 0) {
          return;
        }
        sendToWebView({ type: "restoreOutput", streamKey, text });
      },
      renderSnapshot: (state: TerminalState | null) => {
        outputDecoderRef.current.decode();
        sendToWebView({ type: "renderSnapshot", streamKey, state });
      },
      paste: (text: string) => {
        sendToWebView({ type: "paste", streamKey, text });
      },
      copySelection: async (clipboard) => {
        const webview = webviewRef.current;
        if (!webview?.executeJavaScript) {
          return "";
        }
        let selection = "";
        try {
          const result = await webview.executeJavaScript(READ_GUEST_SELECTION_SCRIPT);
          if (typeof result === "string") {
            selection = result;
          }
        } catch {
          return "";
        }
        if (selection.length === 0) {
          return "";
        }
        const writer = selectTerminalClipboardWriter({
          bridge: getDesktopHost()?.terminal,
          fallback: clipboard,
        });
        await writer.writeText(selection);
        return selection;
      },
      clear: () => {
        outputDecoderRef.current.decode();
        sendToWebView({ type: "clear", streamKey });
      },
      claimSize: () => {
        sendToWebView({ type: "resize", streamKey, forceClaim: true });
      },
      showKeyboard: () => {
        sendToWebView({ type: "focus", streamKey, forceRefocus: true });
        webviewRef.current?.focus();
      },
      blur: () => {
        const webview = webviewRef.current;
        if (!webview) {
          return;
        }
        webview.blur();
        if (webview.executeJavaScript) {
          void webview
            .executeJavaScript(
              "window.__PASEO_TERMINAL_WEBVIEW_BLUR__ && window.__PASEO_TERMINAL_WEBVIEW_BLUR__(); true;",
            )
            .catch(() => {});
        }
      },
    }),
    [sendToWebView, streamKey],
  );

  useEffect(() => {
    outputDecoderRef.current.decode();
  }, [streamKey]);

  const handleLifecycleMessage = useCallback((message: BridgeOutboundMessage): boolean => {
    if (message.type === "bridgeReady") {
      bridgeReadyRef.current = true;
      dispatchLifecycle({ type: "bridgeReady", now: Date.now() });
      setBridgeReadyVersion((value) => value + 1);
      return true;
    }
    if (message.type === "rendererReady") {
      if (message.streamKey === mountRequestedStreamKeyRef.current) {
        rendererReadyStreamKeyRef.current = message.isReady ? message.streamKey : null;
        if (message.isReady) {
          dispatchLifecycle({ type: "rendererReady", now: Date.now() });
        }
      }
      callbacksRef.current.onRendererReadyChange?.({
        streamKey: message.streamKey,
        isReady: message.isReady,
      });
      return true;
    }
    return false;
  }, []);

  const resolveLocalFileLink = useCallback(
    async (message: Extract<BridgeOutboundMessage, { type: "resolveLocalFileLink" }>) => {
      try {
        const target = await (callbacksRef.current.onResolveLocalFileLink?.(message.source) ??
          null);
        sendToWebView({
          type: "resolveLocalFileLinkResponse",
          streamKey: message.streamKey,
          requestId: message.requestId,
          target,
        });
      } catch {
        sendToWebView({
          type: "resolveLocalFileLinkResponse",
          streamKey: message.streamKey,
          requestId: message.requestId,
          target: null,
        });
      }
    },
    [sendToWebView],
  );

  const handleTerminalMessage = useCallback(
    (
      message: Exclude<BridgeOutboundMessage, { type: "bridgeReady" } | { type: "rendererReady" }>,
    ) => {
      if (message.type === "resolveLocalFileLink") {
        void resolveLocalFileLink(message);
        return;
      }
      if (message.type === "openLocalFileLink") {
        callbacksRef.current.onOpenLocalFileLink?.(message.target, message.disposition);
        return;
      }
      switch (message.type) {
        case "input":
          callbacksRef.current.onInput?.(message.data);
          break;
        case "resize":
          callbacksRef.current.onResize?.({
            rows: message.rows,
            cols: message.cols,
            shouldClaim: message.shouldClaim !== false,
            forceClaim: message.forceClaim,
          });
          break;
        case "terminalKey":
          callbacksRef.current.onTerminalKey?.({
            key: message.key,
            ctrl: message.ctrl,
            shift: message.shift,
            alt: message.alt,
            meta: message.meta,
          });
          break;
        case "pendingModifiersConsumed":
          callbacksRef.current.onPendingModifiersConsumed?.();
          break;
        case "inputModeChange":
          callbacksRef.current.onInputModeChange?.(message.state);
          break;
        case "openExternalUrl":
          void openExternalUrl(message.url);
          break;
        case "copySelection":
          void writeTerminalClipboardText(message.text).catch(() => {});
          break;
        case "swipeLeft":
          callbacksRef.current.onSwipeLeft?.();
          break;
        case "swipeRight":
          callbacksRef.current.onSwipeRight?.();
          break;
      }
    },
    [resolveLocalFileLink],
  );

  const handleIpcMessage = useCallback(
    (event: Event) => {
      const ipcEvent = event as WebviewIpcMessageEvent;
      if (ipcEvent.channel !== TERMINAL_GUEST_MESSAGE_CHANNEL) {
        return;
      }
      const serialized = ipcEvent.args?.[0];
      if (typeof serialized !== "string") {
        return;
      }
      let message: BridgeOutboundMessage;
      try {
        message = JSON.parse(serialized) as BridgeOutboundMessage;
      } catch {
        return;
      }

      if (message.type === "bridgeReady" || message.type === "rendererReady") {
        handleLifecycleMessage(message);
        return;
      }
      if (
        !shouldHandleTerminalBridgeMessage(message, {
          desiredStreamKey: streamKey,
          mountedStreamKey: mountRequestedStreamKeyRef.current,
        })
      ) {
        return;
      }
      handleTerminalMessage(message);
    },
    [handleLifecycleMessage, handleTerminalMessage, streamKey],
  );

  const handleIpcMessageRef = useRef(handleIpcMessage);
  handleIpcMessageRef.current = handleIpcMessage;
  const stableIpcMessageListener = useCallback((event: Event) => {
    handleIpcMessageRef.current(event);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return () => {};
    }

    const webview = document.createElement("webview") as ElectronTerminalWebview;
    webview.src = `${window.location.origin}${TERMINAL_GUEST_PATH}`;
    webview.style.width = "100%";
    webview.style.height = "100%";
    webview.style.border = "0";
    webview.style.display = "flex";
    webview.style.background = "transparent";
    const handleRenderProcessGone = (event: Event) => {
      const reason = (event as RenderProcessGoneEvent).details?.reason ?? "unknown";
      if (!shouldScheduleDeferredReload(reason)) {
        return;
      }
      dispatchLifecycle({ type: "renderProcessGone", now: Date.now(), reason });
    };
    const handleDestroyed = () => {
      dispatchLifecycle({ type: "destroyed", now: Date.now() });
    };
    webview.addEventListener("ipc-message", stableIpcMessageListener);
    webview.addEventListener("render-process-gone", handleRenderProcessGone);
    webview.addEventListener("destroyed", handleDestroyed);
    host.replaceChildren(webview);
    webviewRef.current = webview;
    dispatchLifecycle({ type: "mount", now: Date.now() });

    return () => {
      webview.removeEventListener("ipc-message", stableIpcMessageListener);
      webview.removeEventListener("render-process-gone", handleRenderProcessGone);
      webview.removeEventListener("destroyed", handleDestroyed);
      webview.remove();
      if (webviewRef.current === webview) {
        webviewRef.current = null;
      }
      bridgeReadyRef.current = false;
      pendingMessagesRef.current = [];
      mountRequestedStreamKeyRef.current = null;
      rendererReadyStreamKeyRef.current = null;
    };
  }, [lifecycle.epoch, stableIpcMessageListener]);

  useEffect(() => {
    const terminal = getDesktopHost()?.terminal;
    if (!terminal?.onGuestState) {
      return () => {};
    }
    const unsubscribe = terminal.onGuestState((event) => {
      const webview = webviewRef.current;
      if (!webview?.getWebContentsId) {
        return;
      }
      let webContentsId: number;
      try {
        webContentsId = webview.getWebContentsId();
      } catch {
        return;
      }
      if (event.webContentsId !== webContentsId) {
        return;
      }
      if (event.state === "unresponsive") {
        dispatchLifecycle({ type: "unresponsive", now: Date.now() });
      } else if (event.state === "responsive") {
        dispatchLifecycle({ type: "responsive", now: Date.now() });
      }
    });
    if (typeof unsubscribe === "function") {
      return unsubscribe;
    }
    return () => {
      void unsubscribe?.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (lifecycle.phase !== "mounting") {
      return;
    }
    const timer = setInterval(() => {
      dispatchLifecycle({ type: "tick", now: Date.now() });
    }, 250);
    return () => clearInterval(timer);
  }, [lifecycle.phase]);

  const handleReloadGuest = useCallback(() => {
    scheduleDeferredReload(() => {
      dispatchLifecycle({ type: "reload", now: Date.now() });
    });
  }, []);

  useEffect(() => {
    if (bridgeReadyVersion <= 0) return;
    const mountMessage = createMountMessage(mountConfigRef.current);
    mountRequestedStreamKeyRef.current = streamKey;
    rendererReadyStreamKeyRef.current = null;
    sendToWebView(mountMessage);
    flushPendingMessages();
  }, [bridgeReadyVersion, flushPendingMessages, sendToWebView, streamKey]);

  const themeKey = useMemo(() => buildThemeKey(xtermTheme), [xtermTheme]);
  useEffect(() => {
    if (!mountRequestedStreamKeyRef.current) return;
    sendToWebView({ type: "setTheme", streamKey, theme: xtermTheme });
  }, [sendToWebView, streamKey, themeKey, xtermTheme]);

  useEffect(() => {
    if (!mountRequestedStreamKeyRef.current) return;
    sendToWebView({ type: "setScrollback", streamKey, lines: scrollbackLines });
  }, [scrollbackLines, sendToWebView, streamKey]);

  useEffect(() => {
    if (!mountRequestedStreamKeyRef.current) return;
    sendToWebView({ type: "setFont", streamKey, fontFamily, fontSize });
  }, [fontFamily, fontSize, sendToWebView, streamKey]);

  useEffect(() => {
    if (!mountRequestedStreamKeyRef.current) return;
    sendToWebView({ type: "setPendingModifiers", streamKey, pendingModifiers });
  }, [pendingModifiers, sendToWebView, streamKey]);

  useEffect(() => {
    if (!mountRequestedStreamKeyRef.current) return;
    sendToWebView({ type: "setSwipeGesturesEnabled", streamKey, enabled: swipeGesturesEnabled });
  }, [sendToWebView, streamKey, swipeGesturesEnabled]);

  useEffect(() => {
    if (focusRequestToken <= 0) return;
    sendToWebView({ type: "resize", streamKey, forceClaim: true });
    sendToWebView({ type: "focus", streamKey });
    webviewRef.current?.focus?.();
  }, [focusRequestToken, sendToWebView, streamKey]);

  useEffect(() => {
    if (resizeRequestToken <= 0) return;
    sendToWebView({ type: "resize", streamKey, forceClaim: false, shouldClaim: false });
  }, [resizeRequestToken, sendToWebView, streamKey]);

  useEffect(() => {
    return () => {
      if (mountRequestedStreamKeyRef.current) {
        const previousStreamKey = mountRequestedStreamKeyRef.current;
        callbacksRef.current.onRendererReadyChange?.({
          streamKey: previousStreamKey,
          isReady: false,
        });
        sendToWebView({ type: "unmount", streamKey: previousStreamKey });
      }
    };
  }, [sendToWebView]);

  const backgroundColor = xtermTheme.background ?? "#0b0b0b";
  const rootStyle = useMemo(() => [styles.root, { backgroundColor }], [backgroundColor]);

  return (
    <View style={rootStyle} testID={testId}>
      {createElement("div", { ref: hostRef, style: HOST_STYLE })}
      {isTerminalGuestOverlayVisible(lifecycle) ? (
        <TerminalGuestCrashOverlay onReload={handleReloadGuest} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
  },
});
