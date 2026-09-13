import { describe, expect, test } from "vitest";
import {
  INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
  TERMINAL_GUEST_BRIDGE_READY_TIMEOUT_MS,
  TERMINAL_GUEST_RENDERER_READY_TIMEOUT_MS,
  isTerminalGuestOverlayVisible,
  reduceTerminalGuestLifecycle,
  scheduleDeferredReload,
  shouldScheduleDeferredReload,
  type TerminalGuestLifecycleEvent,
  type TerminalGuestLifecycleState,
} from "./guest-lifecycle";

function reduce(
  state: TerminalGuestLifecycleState,
  ...events: TerminalGuestLifecycleEvent[]
): TerminalGuestLifecycleState {
  return events.reduce(reduceTerminalGuestLifecycle, state);
}

describe("terminal guest lifecycle reducer", () => {
  test("starts idle", () => {
    expect(INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE).toEqual({
      phase: "idle",
      epoch: 0,
      bridgeReady: false,
      rendererReady: false,
      bridgeReadyDeadline: null,
      rendererReadyDeadline: null,
    });
  });

  test("mount arms the bridge-ready watchdog", () => {
    const state = reduce(INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE, { type: "mount", now: 1_000 });
    expect(state.phase).toBe("mounting");
    expect(state.bridgeReadyDeadline).toBe(1_000 + TERMINAL_GUEST_BRIDGE_READY_TIMEOUT_MS);
    expect(state.rendererReadyDeadline).toBeNull();
  });

  test("bridgeReady swaps the bridge watchdog for the renderer watchdog", () => {
    const state = reduce(
      INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
      { type: "mount", now: 1_000 },
      { type: "bridgeReady", now: 1_200 },
    );
    expect(state.bridgeReady).toBe(true);
    expect(state.bridgeReadyDeadline).toBeNull();
    expect(state.rendererReadyDeadline).toBe(1_200 + TERMINAL_GUEST_RENDERER_READY_TIMEOUT_MS);
  });

  test("rendererReady reaches ready and clears both watchdogs", () => {
    const state = reduce(
      INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
      { type: "mount", now: 1_000 },
      { type: "bridgeReady", now: 1_200 },
      { type: "rendererReady", now: 1_300 },
    );
    expect(state.phase).toBe("ready");
    expect(state.rendererReady).toBe(true);
    expect(state.bridgeReadyDeadline).toBeNull();
    expect(state.rendererReadyDeadline).toBeNull();
  });

  test("tick before the bridge deadline keeps mounting", () => {
    const state = reduce(
      INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
      { type: "mount", now: 1_000 },
      { type: "tick", now: 1_000 + TERMINAL_GUEST_BRIDGE_READY_TIMEOUT_MS - 1 },
    );
    expect(state.phase).toBe("mounting");
  });

  test("tick after the bridge deadline without bridgeReady marks dead", () => {
    const state = reduce(
      INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
      { type: "mount", now: 1_000 },
      { type: "tick", now: 1_000 + TERMINAL_GUEST_BRIDGE_READY_TIMEOUT_MS },
    );
    expect(state.phase).toBe("dead");
  });

  test("tick after the renderer deadline without rendererReady marks dead", () => {
    const state = reduce(
      INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
      { type: "mount", now: 1_000 },
      { type: "bridgeReady", now: 1_200 },
      { type: "tick", now: 1_200 + TERMINAL_GUEST_RENDERER_READY_TIMEOUT_MS },
    );
    expect(state.phase).toBe("dead");
  });

  test("render-process-gone with a non-clean reason marks dead", () => {
    const state = reduce(
      INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
      { type: "mount", now: 1_000 },
      { type: "bridgeReady", now: 1_100 },
      { type: "rendererReady", now: 1_200 },
      { type: "renderProcessGone", now: 2_000, reason: "crashed" },
    );
    expect(state.phase).toBe("dead");
  });

  test("render-process-gone with clean-exit is ignored", () => {
    const ready = reduce(
      INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
      { type: "mount", now: 1_000 },
      { type: "bridgeReady", now: 1_100 },
      { type: "rendererReady", now: 1_200 },
    );
    const state = reduce(ready, { type: "renderProcessGone", now: 2_000, reason: "clean-exit" });
    expect(state).toBe(ready);
  });

  test("unresponsive marks hung and responsive recovers to ready", () => {
    const ready = reduce(
      INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
      { type: "mount", now: 1_000 },
      { type: "bridgeReady", now: 1_100 },
      { type: "rendererReady", now: 1_200 },
    );
    const hung = reduce(ready, { type: "unresponsive", now: 2_000 });
    expect(hung.phase).toBe("hung");
    const recovered = reduce(hung, { type: "responsive", now: 2_500 });
    expect(recovered.phase).toBe("ready");
  });

  test("destroyed marks dead", () => {
    const state = reduce(
      INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
      { type: "mount", now: 1_000 },
      { type: "destroyed", now: 1_500 },
    );
    expect(state.phase).toBe("dead");
  });

  test("reload bumps the epoch and re-arms the bridge watchdog", () => {
    const dead = reduce(
      INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
      { type: "mount", now: 1_000 },
      { type: "renderProcessGone", now: 2_000, reason: "crashed" },
    );
    const state = reduce(dead, { type: "reload", now: 3_000 });
    expect(state.phase).toBe("mounting");
    expect(state.epoch).toBe(1);
    expect(state.bridgeReady).toBe(false);
    expect(state.rendererReady).toBe(false);
    expect(state.bridgeReadyDeadline).toBe(3_000 + TERMINAL_GUEST_BRIDGE_READY_TIMEOUT_MS);
  });

  test("overlay is visible only while dead or hung", () => {
    expect(isTerminalGuestOverlayVisible(INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE)).toBe(false);
    expect(
      isTerminalGuestOverlayVisible(
        reduce(INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE, { type: "mount", now: 1_000 }),
      ),
    ).toBe(false);
    expect(
      isTerminalGuestOverlayVisible(
        reduce(
          INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
          { type: "mount", now: 1_000 },
          { type: "unresponsive", now: 1_500 },
        ),
      ),
    ).toBe(true);
    expect(
      isTerminalGuestOverlayVisible(
        reduce(
          INITIAL_TERMINAL_GUEST_LIFECYCLE_STATE,
          { type: "mount", now: 1_000 },
          { type: "renderProcessGone", now: 1_500, reason: "killed" },
        ),
      ),
    ).toBe(true);
  });
});

describe("deferred reload", () => {
  test("skips clean-exit", () => {
    expect(shouldScheduleDeferredReload("clean-exit")).toBe(false);
    expect(shouldScheduleDeferredReload("crashed")).toBe(true);
    expect(shouldScheduleDeferredReload("killed")).toBe(true);
  });

  test("never invokes reload synchronously", () => {
    const calls: string[] = [];
    const scheduled: Array<() => void> = [];
    scheduleDeferredReload(
      () => calls.push("reload"),
      (callback) => scheduled.push(callback),
    );
    expect(calls).toEqual([]);
    expect(scheduled).toHaveLength(1);
    scheduled[0]();
    expect(calls).toEqual(["reload"]);
  });
});
