// COMPAT(darwinCompositorWatchdog): added in v0.1.78, target removal after
// 2026-11-19. Workaround for Electron/Chromium macOS display-sleep compositor
// stalls; re-test when Electron/Chromium is upgraded.

// How often the main process probes each target for frame production.
export const FRAME_PROBE_INTERVAL_MS = 2000;
// A probed frame must arrive within this window or the probe counts as stalled.
const FRAME_PROBE_DEADLINE_MS = 300;
// Consecutive stalled probes before the watchdog restarts the GPU process (~6 s).
const FRAME_STALL_CHECKS_TO_RECOVER = 3;
// A probe the renderer has not answered within this window is ignored. A hung
// renderer main thread never answers, and restarting the GPU cannot fix it.
export const PROBE_RESPONSE_TIMEOUT_MS = 2_000;
// executeJavaScript on a dead frame, or across a reload, never settles in Electron (it only
// logs "Render frame was disposed"), so a probe still unanswered after this is abandoned.
export const PROBE_ABANDON_MS = 30_000;
// Minimum gap between GPU-process restarts.
export const COMPOSITOR_RECOVERY_COOLDOWN_MS = 60_000;
// Grace period for Chromium to relaunch the GPU process before probing resumes.
const GPU_RELAUNCH_GRACE_MS = 5_000;
// Stop restarting the GPU process after this many tries without frames returning.
const MAX_CONSECUTIVE_RECOVERIES = 3;

// Resolves { producedFrame, visibilityState } for the renderer. The frame is
// requested with requestAnimationFrame; setTimeout (not vsync-driven) bounds the
// wait so the probe always resolves even when frame production has stopped.
const FRAME_PROBE_SOURCE = `new Promise((resolve) => {
  let settled = false;
  const finish = (producedFrame) => {
    if (settled) return;
    settled = true;
    resolve({ producedFrame, visibilityState: document.visibilityState });
  };
  requestAnimationFrame(() => finish(true));
  setTimeout(() => finish(false), ${FRAME_PROBE_DEADLINE_MS});
})`;

export interface FrameStallState {
  stalledChecks: number;
  recovering: boolean;
  msSinceLastRecovery: number;
  consecutiveRecoveries: number;
}

export function shouldRecoverFromFrameStall(state: FrameStallState): boolean {
  return (
    state.stalledChecks >= FRAME_STALL_CHECKS_TO_RECOVER &&
    !state.recovering &&
    state.msSinceLastRecovery >= COMPOSITOR_RECOVERY_COOLDOWN_MS &&
    state.consecutiveRecoveries < MAX_CONSECUTIVE_RECOVERIES
  );
}

/**
 * One probed surface: the main window or a terminal guest WebContents. The
 * watchdog owns the shared recovery state machine; a target only answers
 * "am I alive / eligible / producing frames".
 */
export interface CompositorWatchdogTarget {
  readonly id: string;
  isDestroyed(): boolean;
  /** Host-level guard: false when the target legitimately stops producing frames. */
  isProbeEligible(): boolean;
  executeJavaScript(source: string): Promise<unknown>;
}

export interface CompositorWatchdogRecovery {
  targetId: string;
  attempt: number;
}

export interface CompositorWatchdogOptions {
  recover: (recovery: CompositorWatchdogRecovery) => void | Promise<void>;
  now?: () => number;
  graceMs?: number;
}

interface TargetState {
  target: CompositorWatchdogTarget;
  stalledChecks: number;
  consecutiveRecoveries: number;
  // An unanswered probe is not re-issued until it settles or is abandoned; calls would
  // queue up behind a hung renderer.
  pendingProbe: { sentAt: number } | null;
}

type FrameProbeResult = { producedFrame?: unknown; visibilityState?: unknown } | null;

/**
 * Probes registered targets for frame production and, on a sustained stall,
 * runs the injected recovery. Recovery is global (one GPU-process restart
 * recovers every target) and cooldown-guarded; stall counters are per target.
 */
export class CompositorWatchdog {
  private readonly targets = new Map<string, TargetState>();
  private readonly recover: CompositorWatchdogOptions["recover"];
  private readonly now: () => number;
  private readonly graceMs: number;
  private recovering = false;
  private lastRecoveryAt = 0;
  private screenLocked = false;
  private probing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  public constructor(options: CompositorWatchdogOptions) {
    this.recover = options.recover;
    this.now = options.now ?? Date.now;
    this.graceMs = options.graceMs ?? GPU_RELAUNCH_GRACE_MS;
  }

  public registerTarget(target: CompositorWatchdogTarget): void {
    const existing = this.targets.get(target.id);
    if (existing) {
      existing.target = target;
      return;
    }
    this.targets.set(target.id, {
      target,
      stalledChecks: 0,
      consecutiveRecoveries: 0,
      pendingProbe: null,
    });
  }

  public unregisterTarget(id: string): void {
    this.targets.delete(id);
  }

  public setScreenLocked(locked: boolean): void {
    this.screenLocked = locked;
    for (const state of this.targets.values()) {
      state.stalledChecks = 0;
    }
  }

  public start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => void this.probeOnce(), FRAME_PROBE_INTERVAL_MS);
  }

  public stop(): void {
    if (this.timer === null) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  public dispose(): void {
    this.stop();
    this.targets.clear();
  }

  public async probeOnce(): Promise<void> {
    // The interval fires regardless of how long a pass takes; never overlap passes.
    if (this.recovering || this.probing) {
      return;
    }
    this.probing = true;
    try {
      for (const state of Array.from(this.targets.values())) {
        await this.probeTarget(state);
      }
    } finally {
      this.probing = false;
    }
  }

  private async probeTarget(state: TargetState): Promise<void> {
    const { target } = state;
    if (target.isDestroyed()) {
      this.unregisterTarget(target.id);
      return;
    }
    if (this.recovering) {
      return;
    }
    // A freeze is only meaningful, and only distinguishable from a normal idle
    // surface, while the target is actually on screen. A locked screen, a
    // minimized window, or a hidden one legitimately stops producing frames.
    if (this.screenLocked || !target.isProbeEligible()) {
      state.stalledChecks = 0;
      return;
    }

    if (state.pendingProbe && this.now() - state.pendingProbe.sentAt < PROBE_ABANDON_MS) {
      return;
    }

    // An unanswered or failed probe (hung, busy, or dead renderer) resolves to
    // null and resets the streak like a hidden document: only answered probes
    // show a compositor stall, and a GPU restart while the renderer is busy is
    // itself what blanks the window.
    const probe = { sentAt: this.now() };
    state.pendingProbe = probe;
    let responseTimer: ReturnType<typeof setTimeout> | undefined;
    const answered = Promise.resolve()
      .then(() => target.executeJavaScript(FRAME_PROBE_SOURCE) as Promise<FrameProbeResult>)
      .catch(() => null)
      .finally(() => {
        // An abandoned probe that settles late must not clear the one that replaced it.
        if (state.pendingProbe === probe) {
          state.pendingProbe = null;
        }
      });
    const unanswered = new Promise<null>((resolve) => {
      responseTimer = setTimeout(() => resolve(null), PROBE_RESPONSE_TIMEOUT_MS);
    });
    const result = await Promise.race([answered, unanswered]);
    clearTimeout(responseTimer);
    if (!result || result.visibilityState !== "visible") {
      state.stalledChecks = 0;
      return;
    }
    if (result.producedFrame === true) {
      state.stalledChecks = 0;
      state.consecutiveRecoveries = 0;
      return;
    }

    state.stalledChecks += 1;
    if (
      shouldRecoverFromFrameStall({
        stalledChecks: state.stalledChecks,
        recovering: this.recovering,
        msSinceLastRecovery: this.now() - this.lastRecoveryAt,
        consecutiveRecoveries: state.consecutiveRecoveries,
      })
    ) {
      await this.recoverTarget(state);
    }
  }

  private async recoverTarget(state: TargetState): Promise<void> {
    this.recovering = true;
    this.lastRecoveryAt = this.now();
    state.consecutiveRecoveries += 1;
    state.stalledChecks = 0;
    await this.recover({ targetId: state.target.id, attempt: state.consecutiveRecoveries });
    if (this.graceMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.graceMs));
    }
    this.recovering = false;
  }
}
