import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMPOSITOR_RECOVERY_COOLDOWN_MS,
  CompositorWatchdog,
  type CompositorWatchdogTarget,
  PROBE_ABANDON_MS,
  PROBE_RESPONSE_TIMEOUT_MS,
  shouldRecoverFromFrameStall,
} from "./watchdog-targets.js";

class FakeTarget implements CompositorWatchdogTarget {
  public destroyed = false;
  public eligible = true;
  public producedFrame = false;
  public visibilityState = "visible";
  public executeCount = 0;
  // When set, the probe answers with this promise instead of right away.
  public response: Promise<unknown> | null = null;

  public constructor(public readonly id: string) {}

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public isProbeEligible(): boolean {
    return this.eligible;
  }

  public async executeJavaScript(): Promise<unknown> {
    this.executeCount += 1;
    return (
      this.response ?? { producedFrame: this.producedFrame, visibilityState: this.visibilityState }
    );
  }
}

function createWatchdog(now: () => number = () => 1_000_000) {
  const recover = vi.fn();
  const watchdog = new CompositorWatchdog({ recover, now, graceMs: 0 });
  return { watchdog, recover };
}

describe("compositor-watchdog targets", () => {
  it("recovers after a sustained stall on a registered target", async () => {
    const { watchdog, recover } = createWatchdog();
    const target = new FakeTarget("terminal-guest:1");
    watchdog.registerTarget(target);

    await watchdog.probeOnce();
    await watchdog.probeOnce();
    expect(recover).not.toHaveBeenCalled();

    await watchdog.probeOnce();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith({ targetId: "terminal-guest:1", attempt: 1 });
  });

  it("does not recover while the target produces frames", async () => {
    const { watchdog, recover } = createWatchdog();
    const target = new FakeTarget("terminal-guest:1");
    target.producedFrame = true;
    watchdog.registerTarget(target);

    for (let i = 0; i < 5; i += 1) {
      await watchdog.probeOnce();
    }
    expect(recover).not.toHaveBeenCalled();
  });

  it("resets a target that is not probe-eligible", async () => {
    const { watchdog, recover } = createWatchdog();
    const target = new FakeTarget("terminal-guest:1");
    watchdog.registerTarget(target);

    await watchdog.probeOnce();
    await watchdog.probeOnce();
    target.eligible = false;
    await watchdog.probeOnce();
    target.eligible = true;
    await watchdog.probeOnce();
    await watchdog.probeOnce();

    expect(recover).not.toHaveBeenCalled();
  });

  it("resets a target whose document is hidden", async () => {
    const { watchdog, recover } = createWatchdog();
    const target = new FakeTarget("terminal-guest:1");
    watchdog.registerTarget(target);

    await watchdog.probeOnce();
    await watchdog.probeOnce();
    target.visibilityState = "hidden";
    await watchdog.probeOnce();
    target.visibilityState = "visible";
    await watchdog.probeOnce();
    await watchdog.probeOnce();

    expect(recover).not.toHaveBeenCalled();
  });

  it("resets stalls while the screen is locked", async () => {
    const { watchdog, recover } = createWatchdog();
    const target = new FakeTarget("terminal-guest:1");
    watchdog.registerTarget(target);

    await watchdog.probeOnce();
    await watchdog.probeOnce();
    watchdog.setScreenLocked(true);
    await watchdog.probeOnce();
    watchdog.setScreenLocked(false);
    await watchdog.probeOnce();
    await watchdog.probeOnce();

    expect(recover).not.toHaveBeenCalled();
  });

  it("applies the recovery cooldown globally across targets", async () => {
    let now = 1_000_000;
    const { watchdog, recover } = createWatchdog(() => now);
    const first = new FakeTarget("terminal-guest:1");
    const second = new FakeTarget("terminal-guest:2");
    watchdog.registerTarget(first);
    watchdog.registerTarget(second);

    for (let i = 0; i < 3; i += 1) {
      await watchdog.probeOnce();
    }
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenLastCalledWith({ targetId: "terminal-guest:1", attempt: 1 });

    first.producedFrame = true;
    for (let i = 0; i < 3; i += 1) {
      await watchdog.probeOnce();
    }
    expect(recover).toHaveBeenCalledTimes(1);

    now += COMPOSITOR_RECOVERY_COOLDOWN_MS;
    await watchdog.probeOnce();
    expect(recover).toHaveBeenCalledTimes(2);
    expect(recover).toHaveBeenLastCalledWith({ targetId: "terminal-guest:2", attempt: 1 });
  });

  it("caps consecutive recoveries per target", async () => {
    let now = 1_000_000;
    const { watchdog, recover } = createWatchdog(() => now);
    const target = new FakeTarget("terminal-guest:1");
    watchdog.registerTarget(target);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      for (let i = 0; i < 3; i += 1) {
        await watchdog.probeOnce();
      }
      expect(recover).toHaveBeenCalledTimes(attempt);
      now += COMPOSITOR_RECOVERY_COOLDOWN_MS;
    }

    for (let i = 0; i < 3; i += 1) {
      await watchdog.probeOnce();
    }
    expect(recover).toHaveBeenCalledTimes(3);
  });

  it("drops destroyed targets without probing them", async () => {
    const { watchdog, recover } = createWatchdog();
    const target = new FakeTarget("terminal-guest:1");
    watchdog.registerTarget(target);
    target.destroyed = true;

    await watchdog.probeOnce();

    expect(target.executeCount).toBe(0);
    expect(recover).not.toHaveBeenCalled();
  });

  describe("unanswered probes", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function probePass(watchdog: CompositorWatchdog): Promise<void> {
      const pass = watchdog.probeOnce();
      await vi.advanceTimersByTimeAsync(PROBE_RESPONSE_TIMEOUT_MS);
      await pass;
    }

    it("ignores a hung target without re-probing it and keeps probing the others", async () => {
      const { watchdog, recover } = createWatchdog();
      const hung = new FakeTarget("main-window");
      hung.response = new Promise(() => {});
      const stalled = new FakeTarget("terminal-guest:1");
      watchdog.registerTarget(hung);
      watchdog.registerTarget(stalled);

      for (let i = 0; i < 3; i += 1) {
        await probePass(watchdog);
      }

      expect(hung.executeCount).toBe(1);
      expect(stalled.executeCount).toBe(3);
      expect(recover).toHaveBeenCalledTimes(1);
      expect(recover).toHaveBeenCalledWith({ targetId: "terminal-guest:1", attempt: 1 });
    });

    it("does not start a pass while the previous one is still waiting", async () => {
      const { watchdog } = createWatchdog();
      const hung = new FakeTarget("main-window");
      hung.response = new Promise(() => {});
      const other = new FakeTarget("terminal-guest:1");
      watchdog.registerTarget(hung);
      watchdog.registerTarget(other);

      const first = watchdog.probeOnce();
      await watchdog.probeOnce();
      expect(other.executeCount).toBe(0);

      await vi.advanceTimersByTimeAsync(PROBE_RESPONSE_TIMEOUT_MS);
      await first;
      expect(other.executeCount).toBe(1);
    });

    it("treats a rejected probe as no signal that breaks the stall streak", async () => {
      const { watchdog, recover } = createWatchdog();
      const target = new FakeTarget("main-window");
      watchdog.registerTarget(target);

      await probePass(watchdog);
      await probePass(watchdog);
      target.response = Promise.reject(new Error("Render frame was disposed"));
      await probePass(watchdog);
      target.response = null;
      await probePass(watchdog);
      await probePass(watchdog);
      expect(recover).not.toHaveBeenCalled();

      await probePass(watchdog);
      expect(recover).toHaveBeenCalledTimes(1);
    });

    it("re-probes a target once its late probe settles", async () => {
      const { watchdog } = createWatchdog();
      const target = new FakeTarget("main-window");
      let failProbe: (error: Error) => void = () => {};
      target.response = new Promise((_, reject) => {
        failProbe = reject;
      });
      watchdog.registerTarget(target);

      await probePass(watchdog);
      await probePass(watchdog);
      expect(target.executeCount).toBe(1);

      failProbe(new Error("Render frame was disposed"));
      await vi.advanceTimersByTimeAsync(0);
      target.response = null;
      await probePass(watchdog);
      expect(target.executeCount).toBe(2);
    });

    it("abandons a probe that never settles and probes the reloaded renderer again", async () => {
      const { watchdog } = createWatchdog(Date.now);
      const target = new FakeTarget("main-window");
      // A probe sent to a renderer that then dies never settles.
      target.response = new Promise(() => {});
      watchdog.registerTarget(target);

      await probePass(watchdog);
      await probePass(watchdog);
      expect(target.executeCount).toBe(1);

      await vi.advanceTimersByTimeAsync(PROBE_ABANDON_MS);
      target.response = null;
      await probePass(watchdog);
      expect(target.executeCount).toBe(2);
      await probePass(watchdog);
      expect(target.executeCount).toBe(3);
    });
  });

  it("keeps the pure state machine exported for the main window", () => {
    expect(
      shouldRecoverFromFrameStall({
        stalledChecks: 3,
        recovering: false,
        msSinceLastRecovery: 120_000,
        consecutiveRecoveries: 0,
      }),
    ).toBe(true);
  });
});
