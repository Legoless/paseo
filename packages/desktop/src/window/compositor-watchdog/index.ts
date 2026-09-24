import { app, type BrowserWindow, powerMonitor, type WebContents } from "electron";

import {
  CompositorWatchdog,
  type CompositorWatchdogRecovery,
  type CompositorWatchdogTarget,
} from "./watchdog-targets.js";

export { shouldRecoverFromFrameStall } from "./watchdog-targets.js";

// COMPAT(darwinCompositorWatchdog): added in v0.1.78, target removal after
// 2026-11-19. Workaround for Electron/Chromium macOS display-sleep compositor
// stalls; re-test when Electron/Chromium is upgraded.

const MAIN_WINDOW_TARGET_ID = "main-window";
const TERMINAL_GUEST_TARGET_PREFIX = "terminal-guest:";

function findGpuProcessPid(): number | null {
  for (const metric of app.getAppMetrics()) {
    if (metric.type === "GPU") {
      return metric.pid;
    }
  }
  return null;
}

// macOS display sleep can leave Chromium's GPU-process display link (the vsync
// source that drives frame production) stuck on a stale display. The compositor
// then stops producing frames and the window looks frozen: unresponsive to
// clicks and keys even though the renderer and every process stay alive. This
// watchdog polls each registered surface for frame production and, on a
// sustained stall, restarts the GPU process so Chromium rebuilds the display
// link. The restart is global: it recovers the main window and every terminal
// guest uniformly.
function recoverGpuProcess(recovery: CompositorWatchdogRecovery): void {
  const gpuPid = findGpuProcessPid();
  const label =
    recovery.targetId === MAIN_WINDOW_TARGET_ID
      ? "Desktop window"
      : `Terminal guest ${recovery.targetId}`;
  console.warn(
    `[compositor-watchdog] ${label} stopped producing frames; restarting GPU process ` +
      `(pid=${gpuPid ?? "unknown"}, attempt ${recovery.attempt}) to recover`,
  );
  if (gpuPid !== null) {
    try {
      process.kill(gpuPid, "SIGKILL");
    } catch (error) {
      console.warn("[compositor-watchdog] Could not restart GPU process", error);
    }
  }
}

let watchdog: CompositorWatchdog | null = null;

function getWatchdog(): CompositorWatchdog {
  if (!watchdog) {
    watchdog = new CompositorWatchdog({ recover: recoverGpuProcess });
  }
  return watchdog;
}

function mainWindowTarget(win: BrowserWindow): CompositorWatchdogTarget {
  return {
    id: MAIN_WINDOW_TARGET_ID,
    isDestroyed: () => win.isDestroyed(),
    // A crashed renderer cannot answer; setupRendererRecovery reloads it.
    isProbeEligible: () => win.isVisible() && !win.isMinimized() && !win.webContents.isCrashed(),
    executeJavaScript: (source) => win.webContents.executeJavaScript(source),
  };
}

export function setupDarwinCompositorWatchdog(win: BrowserWindow): void {
  if (process.platform !== "darwin") {
    return;
  }

  // Deliberately do NOT call win.webContents.setBackgroundThrottling(false) here.
  // Disabling background throttling keeps Chromium's compositor producing frames
  // continuously, which pins ProMotion displays at their max refresh rate (120Hz)
  // forever and drains the battery even while the app sits idle. The probe does
  // not need it: the visibility guards below (screen lock / isVisible /
  // isMinimized / document.visibilityState) already skip windows that legitimately
  // stop producing frames, so throttling cannot fool the probe into a false stall.
  // The freeze this watchdog targets happens while the window is visible and
  // focused (just after display wake), where background throttling never applies.

  const instance = getWatchdog();
  instance.registerTarget(mainWindowTarget(win));
  instance.start();

  const handleScreenLocked = () => instance.setScreenLocked(true);
  const handleScreenUnlocked = () => instance.setScreenLocked(false);
  powerMonitor.on("lock-screen", handleScreenLocked);
  powerMonitor.on("unlock-screen", handleScreenUnlocked);

  win.once("closed", () => {
    instance.unregisterTarget(MAIN_WINDOW_TARGET_ID);
    instance.stop();
    powerMonitor.off("lock-screen", handleScreenLocked);
    powerMonitor.off("unlock-screen", handleScreenUnlocked);
  });
}

/**
 * Probes a terminal guest WebContents like the main window. The guest is only
 * eligible while its host window is on screen; the probe's own
 * `document.visibilityState` check covers a hidden guest document.
 */
export function registerTerminalGuestCompositorWatchdogTarget(input: {
  contents: WebContents;
  hostWindow: BrowserWindow;
}): void {
  if (process.platform !== "darwin") {
    return;
  }
  const { contents, hostWindow } = input;
  getWatchdog().registerTarget({
    id: `${TERMINAL_GUEST_TARGET_PREFIX}${contents.id}`,
    isDestroyed: () => contents.isDestroyed(),
    isProbeEligible: () =>
      !contents.isCrashed() &&
      !hostWindow.isDestroyed() &&
      hostWindow.isVisible() &&
      !hostWindow.isMinimized(),
    executeJavaScript: (source) => contents.executeJavaScript(source),
  });
}

export function unregisterTerminalGuestCompositorWatchdogTarget(webContentsId: number): void {
  if (process.platform !== "darwin") {
    return;
  }
  watchdog?.unregisterTarget(`${TERMINAL_GUEST_TARGET_PREFIX}${webContentsId}`);
}
