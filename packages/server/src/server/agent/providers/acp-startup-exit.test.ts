import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

import { GenericACPAgentClient } from "./generic-acp-agent.js";
import { KimiACPAgentClient } from "./kimi-acp-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

// Exercise the public catalog API with a real child, including stdout EOF and
// stderr draining. No provider installation or external service is involved.
const failingCommand: [string, ...string[]] = [
  process.execPath,
  "-e",
  "process.stdin.once('data', () => { process.stderr.write('launcher failed: fixture startup error\\n'); process.exitCode = 1; process.stdin.destroy(); });",
];

describe("ACP catalog startup failures", () => {
  test("reports a process that exits during initialize with its stderr", async () => {
    const client = new GenericACPAgentClient({
      logger: createTestLogger(),
      command: failingCommand,
    });
    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: process.cwd(), force: true }),
    ).rejects.toThrow(/launcher failed: fixture startup error/);
  }, 5_000);

  test("session startup reports the same process exit with its stderr", async () => {
    const client = new GenericACPAgentClient({
      logger: createTestLogger(),
      command: failingCommand,
    });
    await expect(client.createSession({ provider: "acp", cwd: process.cwd() })).rejects.toThrow(
      /launcher failed: fixture startup error/,
    );
  }, 5_000);

  test("provider diagnostics report the startup exit instead of an initialize timeout", async () => {
    const client = new GenericACPAgentClient({
      logger: createTestLogger(),
      command: failingCommand,
      diagnosticPhaseTimeoutMs: 2_000,
    });
    const { diagnostic } = await client.getDiagnostic();
    expect(diagnostic).toContain(
      "ACP agent process exited before initialization completed (exit code 1)",
    );
    expect(diagnostic).toContain("launcher failed: fixture startup error");
    expect(diagnostic).not.toContain("initialize timed out");
  });

  test("invalid provider options reject without crashing the host process", async () => {
    const clientModule = new URL("./generic-acp-agent.ts", import.meta.url).href;
    const loggerModule = new URL("../../../test-utils/test-logger.ts", import.meta.url).href;
    const script = `
      import { GenericACPAgentClient } from ${JSON.stringify(clientModule)};
      import { createTestLogger } from ${JSON.stringify(loggerModule)};
      const client = new GenericACPAgentClient({
        logger: createTestLogger(),
        command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
      });
      try {
        await client.fetchCatalog({
          scope: 'workspace', cwd: process.cwd(), force: true,
          providerOptions: { clientCapabilities: { fs: 'invalid' } },
        });
        throw new Error('Expected invalid options to reject');
      } catch (error) {
        if (error.name !== 'ZodError') throw error;
      }
      // Let child cleanup and Node's unhandled-rejection check complete.
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log('host stayed alive');
    `;
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { timeout: 10_000 },
    );
    expect(result.stdout).toContain("host stayed alive");
    // Node 26 warns that tsx's module.register() is deprecated. That is the loader, not the host.
    expect(result.stderr.replace(/\(node:\d+\) \[DEP0205\][\s\S]*/, "").trim()).toBe("");
  });

  test("a successful catalog probe still returns its models and closes cleanly", async () => {
    const client = new GenericACPAgentClient({
      logger: createTestLogger(),
      command: [
        process.execPath,
        "-e",
        `
        require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
          const request = JSON.parse(line);
          const result = request.method === 'initialize'
            ? { protocolVersion: 1, agentCapabilities: {} }
            : { sessionId: 'fixture', models: {
                currentModelId: 'fixture-model',
                availableModels: [{ modelId: 'fixture-model', name: 'Fixture model' }]
              } };
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
        });
      `,
      ],
    });
    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: process.cwd(),
      force: true,
    });
    expect(catalog.models).toEqual([
      expect.objectContaining({ id: "fixture-model", label: "Fixture model" }),
    ]);
  });

  test("reports a process that exits during session/new immediately instead of waiting for timeout", async () => {
    const exitDuringSessionNew: [string, ...string[]] = [
      process.execPath,
      "-e",
      `
      require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
        const request = JSON.parse(line);
        if (request.method === 'initialize') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');
          return;
        }
        if (request.method === 'session/new') {
          process.stderr.write('session/new crashed: mcp bootstrap failed\\n');
          process.exit(1);
        }
      });
      `,
    ];
    const client = new GenericACPAgentClient({
      logger: createTestLogger(),
      command: exitDuringSessionNew,
      probePhaseTimeoutMs: 10_000,
      diagnosticPhaseTimeoutMs: 10_000,
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: process.cwd(), force: true }),
    ).rejects.toThrow(/session\/new crashed: mcp bootstrap failed/);

    const { diagnostic } = await client.getDiagnostic();
    expect(diagnostic).toContain("session/new crashed: mcp bootstrap failed");
    expect(diagnostic).not.toContain("ACP session/new timed out");
  }, 5_000);

  test("extends catalog session/new deadline on vendor setup notifications without JSON-RPC errors", async () => {
    const clientModule = new URL("./generic-acp-agent.ts", import.meta.url).href;
    const loggerModule = new URL("../../../test-utils/test-logger.ts", import.meta.url).href;
    const agentScript = `
      require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
        const request = JSON.parse(line);
        if (request.method === 'initialize') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');
          return;
        }
        if (request.method === 'session/new') {
          const phases = ['auth', 'folder_trust', 'plugin_registry', 'mcp_merge', 'agent_build'];
          phases.forEach((phase, index) => {
            setTimeout(() => {
              process.stdout.write(JSON.stringify({
                jsonrpc: '2.0',
                method: '_x.ai/session/setup',
                params: { method: 'session/new', phase, sessionId: null },
              }) + '\\n');
            }, (index + 1) * 30);
          });
          setTimeout(() => {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: {
                sessionId: 'grok-session',
                models: {
                  currentModelId: 'grok-4.7',
                  availableModels: [{ modelId: 'grok-4.7', name: 'Grok 4.7' }],
                },
              },
            }) + '\\n');
          }, 190);
        }
      });
    `;
    const script = `
      import { GenericACPAgentClient } from ${JSON.stringify(clientModule)};
      import { createTestLogger } from ${JSON.stringify(loggerModule)};
      const client = new GenericACPAgentClient({
        logger: createTestLogger(),
        command: [process.execPath, '-e', ${JSON.stringify(agentScript)}],
        providerId: 'grok',
        probePhaseTimeoutMs: 80,
      });
      const catalog = await client.fetchCatalog({ scope: 'workspace', cwd: process.cwd(), force: true });
      console.log(JSON.stringify(catalog.models.map((m) => m.id)));
    `;
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { timeout: 10_000 },
    );
    expect(result.stdout).toContain('["grok-4.7"]');
    expect(result.stderr.replace(/\(node:\d+\) \[DEP0205\][\s\S]*/, "").trim()).toBe("");
  });

  test("shares host-scoped catalog cache keys for grok and kimi without changing generic ACP providers", async () => {
    const logger = createTestLogger();
    const grok = new GenericACPAgentClient({
      logger,
      command: ["grok", "agent", "stdio"],
      providerId: "grok",
    });
    const kimi = new KimiACPAgentClient({
      logger,
      command: ["kimi", "acp"],
    });
    const custom = new GenericACPAgentClient({
      logger,
      command: ["custom-acp"],
      providerId: "custom-acp",
    });

    await expect(
      grok.getCatalogCacheKey({ scope: "workspace", cwd: "/a", force: false }),
    ).resolves.toBe("host");
    await expect(
      grok.getCatalogCacheKey({ scope: "workspace", cwd: "/b", force: false }),
    ).resolves.toBe("host");
    await expect(
      kimi.getCatalogCacheKey({ scope: "workspace", cwd: "/a", force: false }),
    ).resolves.toBe("host");
    await expect(
      custom.getCatalogCacheKey({ scope: "workspace", cwd: "/a", force: false }),
    ).resolves.toBeUndefined();
  });
});
