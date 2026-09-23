import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyAgyWorkspaceMcpOverlay, toAgyMcpServer } from "./mcp.js";

describe("toAgyMcpServer", () => {
  it("maps stdio and HTTP servers to agy mcp_config.json shape", () => {
    expect(
      toAgyMcpServer({
        type: "stdio",
        command: "npx",
        args: ["-y", "server"],
        env: { TOKEN: "x" },
      }),
    ).toEqual({
      command: "npx",
      args: ["-y", "server"],
      env: { TOKEN: "x" },
    });
    expect(
      toAgyMcpServer({
        type: "http",
        url: "http://127.0.0.1:6767/mcp",
        headers: { Authorization: "Bearer t" },
      }),
    ).toEqual({
      serverUrl: "http://127.0.0.1:6767/mcp",
      headers: { Authorization: "Bearer t" },
    });
  });
});

describe("applyAgyWorkspaceMcpOverlay", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("merges Paseo servers into workspace mcp_config.json and restores the previous file", () => {
    const cwd = join(tmpdir(), `agy-mcp-${Date.now()}`);
    dirs.push(cwd);
    mkdirSync(join(cwd, ".agents"), { recursive: true });
    writeFileSync(
      join(cwd, ".agents", "mcp_config.json"),
      `${JSON.stringify({ mcpServers: { docs: { command: "docs" } } }, null, 2)}\n`,
    );

    const overlay = applyAgyWorkspaceMcpOverlay(cwd, {
      paseo: { type: "http", url: "http://127.0.0.1:6767/mcp" },
    });
    expect(overlay).not.toBeNull();
    const written = JSON.parse(readFileSync(join(cwd, ".agents", "mcp_config.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(written.mcpServers.docs).toEqual({ command: "docs" });
    expect(written.mcpServers.paseo).toEqual({ serverUrl: "http://127.0.0.1:6767/mcp" });

    overlay?.restore();
    const restored = JSON.parse(readFileSync(join(cwd, ".agents", "mcp_config.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(restored.mcpServers).toEqual({ docs: { command: "docs" } });
  });

  it("leaves a missing workspace directory missing", () => {
    const cwd = join(tmpdir(), `agy-mcp-missing-${Date.now()}`);
    dirs.push(cwd);

    const overlay = applyAgyWorkspaceMcpOverlay(cwd, {
      paseo: { type: "http", url: "http://127.0.0.1:9/mcp" },
    });

    expect(overlay).toBeNull();
    expect(existsSync(cwd)).toBe(false);
  });

  it("removes a file it created when no previous config existed", () => {
    const cwd = join(tmpdir(), `agy-mcp-empty-${Date.now()}`);
    dirs.push(cwd);
    mkdirSync(cwd, { recursive: true });
    const overlay = applyAgyWorkspaceMcpOverlay(cwd, {
      paseo: { type: "http", url: "http://127.0.0.1:9/mcp" },
    });
    expect(existsSync(join(cwd, ".agents", "mcp_config.json"))).toBe(true);
    overlay?.restore();
    expect(existsSync(join(cwd, ".agents", "mcp_config.json"))).toBe(false);
  });
});
