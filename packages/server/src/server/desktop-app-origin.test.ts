import { describe, expect, it } from "vitest";
import { resolveDesktopAppOrigin } from "./bootstrap.js";

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
});
