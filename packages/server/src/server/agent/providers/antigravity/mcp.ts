import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { McpServerConfig } from "@getpaseo/protocol/agent-types";

export interface AgyMcpOverlay {
  path: string;
  restore(): void;
}

interface AgyMcpConfigFile {
  mcpServers: Record<string, Record<string, unknown>>;
}

export function applyAgyWorkspaceMcpOverlay(
  cwd: string,
  servers: Record<string, McpServerConfig>,
): AgyMcpOverlay | null {
  if (Object.keys(servers).length === 0) return null;

  const agentsDir = join(cwd, ".agents");
  const path = join(agentsDir, "mcp_config.json");
  const createdDir = !existsSync(agentsDir);
  const previous = existsSync(path) ? readFileSync(path) : null;
  const existing = previous === null ? { mcpServers: {} } : parseAgyMcpConfig(previous, path);

  mkdirSync(agentsDir, { recursive: true });
  const mcpServers = { ...existing.mcpServers };
  for (const [name, server] of Object.entries(servers)) {
    mcpServers[name] = toAgyMcpServer(server);
  }
  writeFileSync(path, `${JSON.stringify({ ...existing, mcpServers }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return {
    path,
    restore() {
      if (previous === null) {
        unlinkSync(path);
        if (createdDir) {
          try {
            rmdirSync(agentsDir);
          } catch {
            // Directory still has other workspace files.
          }
        }
        return;
      }
      writeFileSync(path, previous);
    },
  };
}

export function toAgyMcpServer(config: McpServerConfig): Record<string, unknown> {
  if (config.type === "stdio") {
    return {
      command: config.command,
      ...(config.args ? { args: config.args } : {}),
      ...(config.env ? { env: config.env } : {}),
    };
  }
  return {
    serverUrl: config.url,
    ...(config.headers ? { headers: config.headers } : {}),
  };
}

function parseAgyMcpConfig(bytes: Buffer, path: string): AgyMcpConfigFile {
  const text = bytes.toString("utf8").trim();
  if (text.length === 0) return { mcpServers: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse Antigravity MCP config: ${path}`, { cause: error });
    }
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Antigravity MCP config must contain a JSON object: ${path}`);
  }
  const record = parsed as Record<string, unknown>;
  const mcpServers = isServerMap(record.mcpServers) ? record.mcpServers : {};
  return { ...record, mcpServers };
}

function isServerMap(value: unknown): value is Record<string, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => entry !== null && typeof entry === "object");
}
