import { describe, expect, it } from "vitest";

import { resolveIsolatedTerminalRenderer } from "./resolve-terminal-guest-renderer";

describe("isolated terminal renderer resolution", () => {
  it("stays embedded when the setting is off", () => {
    expect(
      resolveIsolatedTerminalRenderer({
        useIsolatedTerminalRenderer: false,
        isElectronRuntime: true,
      }),
    ).toBe("embedded");
  });

  it("stays embedded outside Electron even when the setting is on", () => {
    expect(
      resolveIsolatedTerminalRenderer({
        useIsolatedTerminalRenderer: true,
        isElectronRuntime: false,
      }),
    ).toBe("embedded");
  });

  it("isolates only when the setting is on inside Electron", () => {
    expect(
      resolveIsolatedTerminalRenderer({
        useIsolatedTerminalRenderer: true,
        isElectronRuntime: true,
      }),
    ).toBe("isolated");
  });
});
