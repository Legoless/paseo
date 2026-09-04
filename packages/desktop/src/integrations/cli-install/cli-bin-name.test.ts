import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// The installer symlinks ~/.local/bin/<name> at the shim electron-builder shipped
// as Resources/bin/<name>. Those two names live in different files — one TS, one
// YAML — and nothing else keeps them in step. A mismatch is invisible until
// someone runs the CLI out of a packaged build and it is simply not there.
const DESKTOP_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function shippedCliBinNames(configFile: string): Set<string> {
  const yaml = readFileSync(path.join(DESKTOP_ROOT, configFile), "utf8");
  return new Set([...yaml.matchAll(/to:\s*bin\/(\S+)/g)].map((match) => match[1] ?? ""));
}

describe("bundled CLI name", () => {
  it("ships Neo's shim as paseoneo so it sits beside the official paseo", () => {
    expect(shippedCliBinNames("electron-builder.neo.yml")).toEqual(
      new Set(["paseoneo", "paseoneo.cmd"]),
    );
  });

  it("keeps the default build on paseo", () => {
    expect(shippedCliBinNames("electron-builder.yml")).toEqual(new Set(["paseo", "paseo.cmd"]));
  });

  // The shim is POSIX sh and cannot import variant.ts, so Neo's home and port
  // are written out a second time there. Nothing else notices if one side moves.
  it("points the shim at the same home and port the app uses for Neo", async () => {
    const shim = readFileSync(path.join(DESKTOP_ROOT, "bin/paseo"), "utf8");
    vi.resetModules();
    vi.stubEnv("PASEO_VARIANT", "neo");
    const { NEO_PASEO_HOME, NEO_PASEO_LISTEN } = await import("../../variant.js");
    vi.unstubAllEnvs();

    expect(NEO_PASEO_HOME.replace(process.env.HOME ?? "", "${HOME}")).toBe("${HOME}/.paseo-neo");
    expect(shim).toContain('PASEO_HOME="${PASEO_HOME:-${HOME}/.paseo-neo}"');
    expect(shim).toContain(`PASEO_LISTEN="\${PASEO_LISTEN:-${NEO_PASEO_LISTEN}}"`);
  });

  it("resolves the same names from the variant", async () => {
    vi.resetModules();
    vi.stubEnv("PASEO_VARIANT", "neo");
    await expect(import("../../variant.js").then((m) => m.CLI_BIN_NAME)).resolves.toBe("paseoneo");

    vi.resetModules();
    vi.stubEnv("PASEO_VARIANT", "");
    await expect(import("../../variant.js").then((m) => m.CLI_BIN_NAME)).resolves.toBe("paseo");
    vi.unstubAllEnvs();
  });
});
