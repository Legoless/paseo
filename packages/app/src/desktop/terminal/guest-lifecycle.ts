/**
 * Pure lifecycle state machine for an Electron isolated terminal guest. The React pane owns the
 * `<webview>` element and feeds DOM/bridge events in; this module owns the phase transitions so the
 * crash/hang affordance and the 2.5s bridge/renderer-ready watchdogs stay testable without Electron.
 *
 * The watchdog semantics mirror `terminal-emulator-webview.native.tsx`: the bridge-ready timer arms
 * when the guest document starts loading, and the renderer-ready timer arms once the bridge is up
 * and the mount message has been sent. A missed deadline marks the guest dead rather than silently
 * remounting — recovery is the user's Reload affordance.
 */
export const TERMINAL_GUEST_BRIDGE_READY_TIMEOUT_MS = 2_500;
export const TERMINAL_GUEST_RENDERER_READY_TIMEOUT_MS = 2_500;

export type TerminalGuestLifecyclePhase = "idle" | "mounting" | "ready" | "dead" | "hung";

export interface TerminalGuestLifecycleState {
  phase: TerminalGuestLifecyclePhase;
  /** Bumped on reload; the pane recreates the `<webview>` element when this changes. */
  epoch: number;
  bridgeReady: boolean;
  rendererReady: boolean;
  bridgeReadyDeadline: number | null;
  rendererReadyDeadline: number | null;
}

export const INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE: TerminalGuestLifecycleState = {
  phase: "idle",
  epoch: 0,
  bridgeReady: false,
  rendererReady: false,
  bridgeReadyDeadline: null,
  rendererReadyDeadline: null,
};

export type TerminalGuestLifecycleEvent =
  | { type: "mount"; now: number }
  | { type: "bridgeReady"; now: number }
  | { type: "rendererReady"; now: number }
  | { type: "renderProcessGone"; now: number; reason: string }
  | { type: "unresponsive"; now: number }
  | { type: "responsive"; now: number }
  | { type: "destroyed"; now: number }
  | { type: "reload"; now: number }
  | { type: "tick"; now: number };

function markDead(state: TerminalGuestLifecycleState): TerminalGuestLifecycleState {
  return {
    ...state,
    phase: "dead",
    bridgeReadyDeadline: null,
    rendererReadyDeadline: null,
  };
}

function armMounting(
  state: TerminalGuestLifecycleState,
  now: number,
  epoch: number,
): TerminalGuestLifecycleState {
  return {
    ...state,
    phase: "mounting",
    epoch,
    bridgeReady: false,
    rendererReady: false,
    bridgeReadyDeadline: now + TERMINAL_GUEST_BRIDGE_READY_TIMEOUT_MS,
    rendererReadyDeadline: null,
  };
}

function resolveTick(state: TerminalGuestLifecycleState, now: number): TerminalGuestLifecycleState {
  if (state.phase !== "mounting") {
    return state;
  }
  const bridgeExpired =
    !state.bridgeReady && state.bridgeReadyDeadline !== null && now >= state.bridgeReadyDeadline;
  const rendererExpired =
    state.bridgeReady &&
    !state.rendererReady &&
    state.rendererReadyDeadline !== null &&
    now >= state.rendererReadyDeadline;
  return bridgeExpired || rendererExpired ? markDead(state) : state;
}

export function reduceTerminalGuestLifecycle(
  state: TerminalGuestLifecycleState,
  event: TerminalGuestLifecycleEvent,
): TerminalGuestLifecycleState {
  switch (event.type) {
    case "mount":
      return armMounting(state, event.now, state.epoch);
    case "bridgeReady":
      if (state.phase !== "mounting") {
        return state;
      }
      return {
        ...state,
        bridgeReady: true,
        bridgeReadyDeadline: null,
        rendererReadyDeadline: event.now + TERMINAL_GUEST_RENDERER_READY_TIMEOUT_MS,
      };
    case "rendererReady":
      if (state.phase !== "mounting") {
        return state;
      }
      return {
        ...state,
        phase: "ready",
        rendererReady: true,
        bridgeReadyDeadline: null,
        rendererReadyDeadline: null,
      };
    case "renderProcessGone":
      return event.reason === "clean-exit" ? state : markDead(state);
    case "unresponsive":
      return state.phase === "dead" ? state : { ...state, phase: "hung" };
    case "responsive":
      return state.phase === "hung" ? { ...state, phase: "ready" } : state;
    case "destroyed":
      return markDead(state);
    case "reload":
      return armMounting(state, event.now, state.epoch + 1);
    case "tick":
      return resolveTick(state, event.now);
  }
}

export function isTerminalGuestOverlayVisible(state: TerminalGuestLifecycleState): boolean {
  return state.phase === "dead" || state.phase === "hung";
}

/**
 * A clean guest exit is a normal teardown, not a crash; never offer or schedule recovery for it.
 */
export function shouldScheduleDeferredReload(reason: string): boolean {
  return reason !== "clean-exit";
}

/**
 * Reloading a guest synchronously from a `render-process-gone` handler has historically crashed the
 * Electron browser process, so every reload goes through a macrotask. `schedule` is injectable for
 * tests.
 */
export function scheduleDeferredReload(
  reload: () => void,
  schedule: (callback: () => void) => void = (callback) => {
    setTimeout(callback, 0);
  },
): void {
  schedule(reload);
}
