import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { resolveDesktopAppOrigin } from "./bootstrap.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";

afterEach(() => vi.unstubAllEnvs());

// A packaged renderer connects from its variant's own protocol scheme. Allowing
// only the default one is what stopped Paseo Neo's UI reaching its own daemon.
describe("resolveDesktopAppOrigin", () => {
  it("uses the scheme the desktop app passes", () => {
    expect(resolveDesktopAppOrigin({ PASEO_APP_SCHEME: "paseo-neo" })).toBe("paseo-neo://app");
  });

  it("defaults to the official scheme for a standalone daemon", () => {
    expect(resolveDesktopAppOrigin({})).toBe("paseo://app");
  });

  it("ignores a blank scheme rather than building '://app'", () => {
    expect(resolveDesktopAppOrigin({ PASEO_APP_SCHEME: "   " })).toBe("paseo://app");
  });

  it("allows desktop origins through the running daemon without allowing unrelated origins", async () => {
    vi.stubEnv("PASEO_APP_SCHEME", "paseo-neo");
    const daemon = await createTestPaseoDaemon({ corsAllowedOrigins: [] });
    const httpUrl = `http://127.0.0.1:${daemon.port}/api/health`;
    const socketUrl = `ws://127.0.0.1:${daemon.port}/ws`;
    try {
      for (const origin of ["paseo://app", "paseo-neo://app"]) {
        const response = await fetch(httpUrl, { headers: { Origin: origin } });
        expect(response.headers.get("access-control-allow-origin")).toBe(origin);
        const socket = new WebSocket(socketUrl, { origin });
        try {
          await once(socket, "open");
        } finally {
          socket.terminate();
        }
      }

      const origin = "https://untrusted.example";
      const response = await fetch(httpUrl, { headers: { Origin: origin } });
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      const socket = new WebSocket(socketUrl, { origin });
      try {
        await expect(once(socket, "open")).rejects.toThrow("Unexpected server response: 403");
      } finally {
        socket.terminate();
      }
    } finally {
      await daemon.close();
    }
  });
});
