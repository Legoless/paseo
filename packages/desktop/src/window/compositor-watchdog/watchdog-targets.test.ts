import { describe, expect, it, vi } from "vitest";

import {
  COMPOSITOR_RECOVERY_COOLDOWN_MS,
  CompositorWatchdog,
  type CompositorWatchdogTarget,
  shouldRecoverFromFrameStall,
} from "./watchdog-targets.js";

class FakeTarget implements CompositorWatchdogTarget {
  public destroyed = false;
  public eligible = true;
  public producedFrame = false;
  public visibilityState = "visible";
  public executeCount = 0;

  public constructor(public readonly id: string) {}

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public isProbeEligible(): boolean {
    return this.eligible;
  }

  public async executeJavaScript(): Promise<unknown> {
    this.executeCount += 1;
    return { producedFrame: this.producedFrame, visibilityState: this.visibilityState };
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
