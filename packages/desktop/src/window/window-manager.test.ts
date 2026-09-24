import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  applyDockBadgeCount,
  applyMacWindowControlsUpdate,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  getMainWindowChromeOptions,
  readBadgeCount,
  readWindowChromeUpdate,
  readWindowTheme,
  resolveWindowBounds,
  setupRendererRecovery,
} from "./window-manager";

function rendererRecoveryHarness() {
  let url = "paseo://app/";
  const webContents = Object.assign(new EventEmitter(), {
    reload: vi.fn(),
    getURL: () => url,
  });
  let destroyed = false;
  let time = 0;
  const log = { warn: vi.fn(), error: vi.fn() };
  setupRendererRecovery({ isDestroyed: () => destroyed, webContents }, { log, now: () => time });
  return {
    webContents,
    log,
    gone: (reason: Electron.RenderProcessGoneDetails["reason"]) =>
      webContents.emit("render-process-gone", {}, { reason, exitCode: 9 }),
    destroy: () => {
      destroyed = true;
    },
    uncommitted: () => {
      url = "";
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("window-manager", () => {
  describe("readBadgeCount", () => {
    it("returns valid non-negative integers", () => {
      expect(readBadgeCount(0)).toBe(0);
      expect(readBadgeCount(3)).toBe(3);
    });

    it("falls back to zero for invalid payloads", () => {
      expect(readBadgeCount(undefined)).toBe(0);
      expect(readBadgeCount(null)).toBe(0);
      expect(readBadgeCount(Number.NaN)).toBe(0);
      expect(readBadgeCount(Number.POSITIVE_INFINITY)).toBe(0);
      expect(readBadgeCount(-1)).toBe(0);
      expect(readBadgeCount(1.5)).toBe(0);
      expect(readBadgeCount("2")).toBe(0);
      expect(readBadgeCount({ count: 2 })).toBe(0);
    });
  });

  describe("applyDockBadgeCount", () => {
    it("sets the numeric count and the macOS dock string together", () => {
      const setBadgeCount = vi.fn().mockReturnValue(true);
      const setBadge = vi.fn();

      applyDockBadgeCount({
        count: 3,
        platform: "darwin",
        app: { setBadgeCount, dock: { setBadge } },
      });

      expect(setBadgeCount).toHaveBeenCalledWith(3);
      expect(setBadge).toHaveBeenCalledWith("3");
    });

    it("clears the macOS dock string when the count is zero", () => {
      const setBadgeCount = vi.fn().mockReturnValue(true);
      const setBadge = vi.fn();

      applyDockBadgeCount({
        count: 0,
        platform: "darwin",
        app: { setBadgeCount, dock: { setBadge } },
      });

      expect(setBadgeCount).toHaveBeenCalledWith(0);
      expect(setBadge).toHaveBeenCalledWith("");
    });

    it("does not touch dock.setBadge off darwin", () => {
      const setBadgeCount = vi.fn().mockReturnValue(true);
      const setBadge = vi.fn();

      applyDockBadgeCount({
        count: 2,
        platform: "linux",
        app: { setBadgeCount, dock: { setBadge } },
      });

      expect(setBadgeCount).toHaveBeenCalledWith(2);
      expect(setBadge).not.toHaveBeenCalled();
    });
  });

  describe("readWindowTheme", () => {
    it("accepts supported title bar themes", () => {
      expect(readWindowTheme("light")).toBe("light");
      expect(readWindowTheme("dark")).toBe("dark");
    });

    it("rejects invalid title bar themes", () => {
      expect(readWindowTheme(undefined)).toBeNull();
      expect(readWindowTheme("auto")).toBeNull();
      expect(readWindowTheme("system")).toBeNull();
    });
  });

  describe("readWindowChromeUpdate", () => {
    it("accepts partial runtime overlay updates", () => {
      expect(
        readWindowChromeUpdate({
          backgroundColor: "#181B1A",
          trafficLightOffsetY: -5,
        }),
      ).toEqual({
        backgroundColor: "#181B1A",
        trafficLightOffsetY: -5,
      });
    });

    it("rejects empty and invalid payloads", () => {
      expect(readWindowChromeUpdate(undefined)).toBeNull();
      expect(readWindowChromeUpdate({})).toBeNull();
      expect(readWindowChromeUpdate({ backgroundColor: 12 })).toBeNull();
      expect(readWindowChromeUpdate({ trafficLightOffsetY: -11 })).toBeNull();
    });

    it("preserves fractional traffic-light offsets", () => {
      expect(readWindowChromeUpdate({ trafficLightOffsetY: 1.5 })).toEqual({
        trafficLightOffsetY: 1.5,
      });
    });
  });

  describe("applyMacWindowControlsUpdate", () => {
    it("uses the focus and normal traffic-light positions", () => {
      const setWindowButtonPosition = vi.fn();

      applyMacWindowControlsUpdate({
        win: { setWindowButtonPosition },
        update: { trafficLightOffsetY: -5 },
      });
      applyMacWindowControlsUpdate({
        win: { setWindowButtonPosition },
        update: { trafficLightOffsetY: 0.5 },
      });

      expect(setWindowButtonPosition).toHaveBeenNthCalledWith(1, { x: 16, y: 9 });
      expect(setWindowButtonPosition).toHaveBeenNthCalledWith(2, { x: 16, y: 14.5 });
    });
  });

  describe("getMainWindowChromeOptions", () => {
    it("uses renderer-painted controls on windows", () => {
      expect(
        getMainWindowChromeOptions({
          mode: "custom-windows",
        }),
      ).toEqual({
        frame: false,
        autoHideMenuBar: true,
      });
    });

    it("uses renderer-painted controls on linux", () => {
      expect(
        getMainWindowChromeOptions({
          mode: "custom-linux",
        }),
      ).toEqual({
        frame: false,
        autoHideMenuBar: true,
      });
    });

    it("keeps the mac traffic-light path separate", () => {
      expect(
        getMainWindowChromeOptions({
          mode: "native-mac",
        }),
      ).toEqual({
        titleBarStyle: "hidden",
        titleBarOverlay: true,
        trafficLightPosition: { x: 16, y: 14 },
      });
    });
  });

  describe("resolveWindowBounds", () => {
    it("falls back to the default size when no state is saved", () => {
      expect(resolveWindowBounds(null)).toEqual({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
      });
    });

    it("restores the full size and position", () => {
      expect(
        resolveWindowBounds({ x: 120, y: 80, width: 1024, height: 720, isMaximized: false }),
      ).toEqual({ width: 1024, height: 720, x: 120, y: 80 });
    });

    it("omits the position when only the size was persisted", () => {
      expect(resolveWindowBounds({ width: 1024, height: 720, isMaximized: true })).toEqual({
        width: 1024,
        height: 720,
      });
    });
  });

  describe("setupRendererRecovery", () => {
    it("reloads a renderer that was killed or crashed and logs why", () => {
      const h = rendererRecoveryHarness();
      h.gone("killed");
      h.gone("crashed");
      expect(h.webContents.reload).toHaveBeenCalledTimes(2);
      expect(h.log.error).toHaveBeenCalledWith("[window] renderer gone; reloading", {
        reason: "killed",
        exitCode: 9,
      });
    });

    it("does not reload after a clean exit or once the window is destroyed", () => {
      const h = rendererRecoveryHarness();
      h.gone("clean-exit");
      h.destroy();
      h.gone("crashed");
      expect(h.webContents.reload).not.toHaveBeenCalled();
      expect(h.log.error).not.toHaveBeenCalled();
    });

    it("leaves a renderer that dies before the first page commits to Chromium", () => {
      const h = rendererRecoveryHarness();
      h.uncommitted();
      h.gone("killed");
      expect(h.webContents.reload).not.toHaveBeenCalled();
    });

    it("stops after three reloads in five minutes and allows reloads again later", () => {
      const h = rendererRecoveryHarness();
      h.gone("crashed");
      h.advance(60_000);
      h.gone("crashed");
      h.advance(60_000);
      h.gone("crashed");
      h.advance(60_000);
      h.gone("crashed");
      expect(h.webContents.reload).toHaveBeenCalledTimes(3);
      expect(h.log.error).toHaveBeenLastCalledWith(expect.stringContaining("stopped reloading"), {
        reason: "crashed",
        exitCode: 9,
      });

      // The first reload is now more than five minutes old.
      h.advance(2 * 60_000);
      h.gone("crashed");
      expect(h.webContents.reload).toHaveBeenCalledTimes(4);
    });

    it("logs when the renderer becomes unresponsive and responsive again", () => {
      const h = rendererRecoveryHarness();
      h.webContents.emit("unresponsive");
      h.webContents.emit("responsive");
      expect(h.log.warn.mock.calls).toEqual([
        ["[window] renderer unresponsive"],
        ["[window] renderer responsive again"],
      ]);
      expect(h.webContents.reload).not.toHaveBeenCalled();
    });
  });
});
