import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ChildProcess } from "node:child_process";
import type { ModelInfo, Query } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeOptions, ClaudeQueryFactory } from "./query.js";
import {
  claudeModelCapability,
  discoverClaudeModels,
  findClaudeModel,
  getClaudeModelsWithSettings,
  mapClaudeModels,
  normalizeClaudeRuntimeModelId,
  resolveConfiguredClaudeModel,
  resolveObservedClaudeModelId,
} from "./models.js";

const dirs: string[] = [];
const futureModel: ModelInfo = {
  value: "arbitrary-future-7-31[wide]",
  resolvedModel: "arbitrary-future-7-31",
  displayName: "Future model",
  description: "Discovered by the provider",
  supportsEffort: true,
  supportedEffortLevels: ["low", "xhigh"],
  supportsAdaptiveThinking: true,
  supportsFastMode: true,
  supportsAutoMode: true,
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function configDirectory(settings?: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-models-"));
  dirs.push(dir);
  if (settings !== undefined)
    await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify(settings));
  return dir;
}

function probeFactory(models: ModelInfo[] = [futureModel]) {
  const supportedModels = vi.fn(async () => models);
  const close = vi.fn();
  const queryFactory = vi.fn(() => ({ supportedModels, close }) as unknown as Query);
  return { queryFactory, supportedModels, close };
}

describe("native Claude model mapping", () => {
  it("preserves arbitrary future launch IDs, aliases, and supplied capabilities", () => {
    const [model] = mapClaudeModels([futureModel]);
    expect(model).toMatchObject({
      id: futureModel.value,
      aliases: [futureModel.resolvedModel],
      label: "Future model",
    });
    expect(model?.thinkingOptions?.map((option) => option.id)).toEqual([
      "low",
      "xhigh",
      "ultracode",
    ]);
    expect(claudeModelCapability(model, "supportsFastMode")).toBe(true);
    expect(findClaudeModel([model!], futureModel.resolvedModel)).toBe(model);
    expect(model).not.toHaveProperty("contextWindowMaxTokens");
    expect(model).not.toHaveProperty("defaultThinkingOptionId");
    expect(model?.thinkingOptions?.some((option) => option.id === "off")).toBe(false);
  });

  it("exposes native Fable 5.1 without any model-name allowlist", () => {
    const row = {
      ...futureModel,
      value: "claude-fable-5-1[1m]",
      resolvedModel: "claude-fable-5-1",
      displayName: "Fable",
      description: "Fable 5.1",
    };
    const [model] = mapClaudeModels([row]);
    expect(model?.id).toBe(row.value);
    expect(findClaudeModel([model!], row.resolvedModel)?.id).toBe(row.value);
    expect(normalizeClaudeRuntimeModelId(row.resolvedModel)).toBe(row.resolvedModel);
    expect(normalizeClaudeRuntimeModelId("claude-fable-5-1-20260901")).toBe(
      "claude-fable-5-1-20260901",
    );
  });

  it("keeps models with missing capability metadata selectable without inventing capabilities", () => {
    const [model] = mapClaudeModels([
      { value: "provider/opaque-v99", displayName: "Opaque", description: "" },
    ]);
    expect(model?.isSelectable).not.toBe(false);
    expect(model?.thinkingOptions).toBeUndefined();
    expect(claudeModelCapability(model, "supportsAdaptiveThinking")).toBe(false);
    expect(claudeModelCapability(model, "supportsFastMode")).toBe(false);
    expect(
      resolveConfiguredClaudeModel({ provider: "claude", id: "custom", label: "Custom" }),
    ).toEqual({ provider: "claude", id: "custom", label: "Custom" });
    expect(resolveObservedClaudeModelId(" vendor/new-version ")).toBe("vendor/new-version");
    expect(resolveObservedClaudeModelId("<synthetic>")).toBeNull();
  });

  it("uses native default aliases and explicit capability removal", () => {
    const models = mapClaudeModels([
      { ...futureModel, value: "default" },
      { ...futureModel, supportsEffort: false, supportsFastMode: false },
    ]);
    expect(findClaudeModel(models, undefined)?.id).toBe("default");
    expect(models[1]?.thinkingOptions).toEqual([]);
    expect(claudeModelCapability(models[1], "supportsFastMode")).toBe(false);
  });
});

describe("Claude catalog discovery", () => {
  it("uses only the native control plane and tears down without sending a prompt or persisting a transcript", async () => {
    const dir = await configDirectory();
    const mock = probeFactory();
    expect(
      await discoverClaudeModels({
        cwd: dir,
        resolveBinary: async () => "/test/claude",
        queryFactory: mock.queryFactory,
      }),
    ).toEqual([futureModel]);
    const input = mock.queryFactory.mock.calls[0]?.[0] as {
      prompt: AsyncIterable<unknown>;
      options: ClaudeOptions;
    };
    const prompts: unknown[] = [];
    for await (const prompt of input.prompt) prompts.push(prompt);
    expect(prompts).toEqual([]);
    expect(input.options).toMatchObject({
      persistSession: false,
      extraArgs: { print: null },
      tools: [],
      mcpServers: {},
      strictMcpConfig: true,
      settings: { disableAllHooks: true },
    });
    expect(input.options.abortController?.signal.aborted).toBe(true);
    expect(mock.close).toHaveBeenCalledOnce();
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("closes a failed probe and propagates the failure to the snapshot cache", async () => {
    const mock = probeFactory();
    mock.supportedModels.mockRejectedValue(new Error("Provider catalog unavailable"));
    await expect(
      discoverClaudeModels({
        cwd: os.tmpdir(),
        resolveBinary: async () => "/test/claude",
        queryFactory: mock.queryFactory,
      }),
    ).rejects.toThrow("Provider catalog unavailable");
    expect(mock.close).toHaveBeenCalledOnce();
  });

  it("aborts a hanging control-plane request and closes its probe", async () => {
    const mock = probeFactory();
    mock.supportedModels.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = discoverClaudeModels({
      cwd: os.tmpdir(),
      resolveBinary: async () => "/test/claude",
      queryFactory: mock.queryFactory,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mock.supportedModels).toHaveBeenCalledOnce());
    controller.abort(new Error("Refresh cancelled"));
    await expect(pending).rejects.toThrow("Refresh cancelled");
    expect(mock.close).toHaveBeenCalledOnce();
  });

  it("terminates its own child process after discovery", async () => {
    let child: ChildProcess | undefined;
    const queryFactory: ClaudeQueryFactory = ({ options }) => {
      child = options.spawnClaudeCodeProcess!({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: os.tmpdir(),
        env: process.env,
        signal: options.abortController!.signal,
      });
      child.on("error", (error) => {
        if (error.name !== "AbortError") throw error;
      });
      return { supportedModels: async () => [futureModel], close: () => {} } as unknown as Query;
    };
    await discoverClaudeModels({
      cwd: os.tmpdir(),
      resolveBinary: async () => process.execPath,
      queryFactory,
    });
    expect(child).toBeDefined();
    expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true);
  });

  it("exposes provider-wide Auto for mixed models while keeping the default model's mode safe", async () => {
    const mock = probeFactory([
      { ...futureModel, value: "default", supportsAutoMode: false },
      futureModel,
    ]);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      configDir: await configDirectory(),
      resolveBinary: async () => "/test/claude",
      queryFactory: mock.queryFactory,
    });
    const catalog = await client.fetchCatalog({ scope: "global", force: true });
    expect(catalog.modes?.some((mode) => mode.id === "auto")).toBe(true);
    expect(catalog.defaultModeId).toBe("default");
    expect(catalog.models[0]?.metadata?.unsupportedModeIds).toEqual(["auto"]);
    expect(catalog.models[1]?.metadata?.unsupportedModeIds).toEqual([]);
    const session = await client.createSession({
      provider: "claude",
      cwd: os.tmpdir(),
      model: "default",
    });
    expect((await session.getAvailableModes!()).some((mode) => mode.id === "auto")).toBe(false);
    await session.close();
  });

  it("does not publish stale discovery over the manager's committed catalog", async () => {
    let finishOld!: (models: ModelInfo[]) => void;
    const oldModels = new Promise<ModelInfo[]>((resolve) => {
      finishOld = resolve;
    });
    const mock = probeFactory();
    mock.supportedModels
      .mockReturnValueOnce(oldModels)
      .mockResolvedValueOnce([{ ...futureModel, supportsFastMode: false }]);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      configDir: await configDirectory(),
      resolveBinary: async () => "/test/claude",
      queryFactory: mock.queryFactory,
    });
    const options = { scope: "workspace" as const, cwd: os.tmpdir(), force: true };
    const old = client.fetchCatalog(options);
    await vi.waitFor(() => expect(mock.supportedModels).toHaveBeenCalledTimes(1));
    const current = await client.fetchCatalog(options);
    client.setModelCatalog(current.models, options);
    finishOld([futureModel]);
    await old;
    expect(
      await client.listFeatures({ provider: "claude", cwd: os.tmpdir(), model: futureModel.value }),
    ).toEqual([]);
  });

  it("refreshes native metadata and retains only explicitly configured extra models", async () => {
    const configDir = await configDirectory({
      model: "custom-model",
      env: {
        ANTHROPIC_DEFAULT_OPUS_MODEL: "custom-model",
        ANTHROPIC_DEFAULT_FUTURE_MODEL: "another-model",
      },
    });
    const mock = probeFactory();
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      resolveBinary: async () => "/test/claude",
      configDir,
      queryFactory: mock.queryFactory,
    });
    const first = await client.fetchCatalog({ scope: "global", force: true });
    expect(first.models.map((model) => model.id)).toEqual([
      futureModel.value,
      "custom-model",
      "another-model",
    ]);
    expect(first.models[1]?.thinkingOptions).toBeUndefined();
    mock.supportedModels.mockResolvedValue([
      { ...futureModel, supportsFastMode: false, supportedEffortLevels: ["low"] },
    ]);
    const second = await client.fetchCatalog({ scope: "global", force: true });
    expect(second.models[0]?.thinkingOptions?.map((option) => option.id)).toEqual(["low"]);
    expect(claudeModelCapability(second.models[0], "supportsFastMode")).toBe(false);
    expect(mock.close).toHaveBeenCalledTimes(2);
  });

  it("recognizes a configured canonical alias without adding a capability-less duplicate", async () => {
    const configDir = await configDirectory({ model: futureModel.resolvedModel });
    const models = await getClaudeModelsWithSettings(createTestLogger(), configDir, [futureModel]);
    expect(models).toHaveLength(1);
    expect(findClaudeModel(models, futureModel.resolvedModel)?.id).toBe(futureModel.value);
  });

  it("keeps native discovery when optional settings are absent or malformed", async () => {
    const configDir = await configDirectory();
    const expected = mapClaudeModels([futureModel]);
    expect(await getClaudeModelsWithSettings(createTestLogger(), configDir, [futureModel])).toEqual(
      expected,
    );
    await fs.writeFile(path.join(configDir, "settings.json"), "{");
    expect(await getClaudeModelsWithSettings(createTestLogger(), configDir, [futureModel])).toEqual(
      expected,
    );
  });
});

it("sessions use the current provider-scoped catalog for features and modes", async () => {
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude",
  });
  client.setModelCatalog(mapClaudeModels([futureModel]));
  const session = await client.createSession({
    provider: "claude",
    cwd: os.tmpdir(),
    model: futureModel.resolvedModel,
  });
  expect(session.features?.map((feature) => feature.id)).toEqual(["fast_mode"]);
  expect((await session.getAvailableModes!()).some((mode) => mode.id === "auto")).toBe(true);
  client.setModelCatalog(
    mapClaudeModels([
      {
        ...futureModel,
        supportsFastMode: false,
        supportsAutoMode: false,
        supportedEffortLevels: ["low"],
      },
    ]),
  );
  expect(session.features).toEqual([]);
  expect((await session.getAvailableModes!()).some((mode) => mode.id === "auto")).toBe(false);
  await expect(session.setThinkingOption!("xhigh")).rejects.toThrow("not available");
  await expect(session.setFeature!("fast_mode", true)).rejects.toThrow("not available");
  await session.close();
});

it("isolates session capabilities by workspace scope and refreshes only that scope", async () => {
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude",
  });
  const first = {
    scope: "workspace" as const,
    cwd: path.join(os.tmpdir(), "scope-one"),
    force: true,
  };
  const second = {
    scope: "workspace" as const,
    cwd: path.join(os.tmpdir(), "scope-two"),
    force: true,
  };
  client.setModelCatalog(mapClaudeModels([futureModel]), first);
  client.setModelCatalog(mapClaudeModels([{ ...futureModel, supportsFastMode: false }]), second);
  const one = await client.createSession({
    provider: "claude",
    cwd: first.cwd,
    model: futureModel.value,
  });
  const two = await client.createSession({
    provider: "claude",
    cwd: second.cwd,
    model: futureModel.value,
  });
  expect(one.features?.map((feature) => feature.id)).toEqual(["fast_mode"]);
  expect(two.features).toEqual([]);
  client.setModelCatalog(mapClaudeModels([{ ...futureModel, supportsFastMode: true }]), second);
  expect(two.features?.map((feature) => feature.id)).toEqual(["fast_mode"]);
  expect(one.features?.map((feature) => feature.id)).toEqual(["fast_mode"]);
  await one.close();
  await two.close();
});

it("does not reuse a native global catalog as a workspace catalog", async () => {
  const mock = probeFactory([{ ...futureModel, supportsFastMode: false }]);
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    configDir: await configDirectory(),
    resolveBinary: async () => "/test/claude",
    queryFactory: mock.queryFactory,
  });
  client.setModelCatalog(mapClaudeModels([futureModel]), { scope: "global", force: false });
  const session = await client.createSession({
    provider: "claude",
    cwd: os.tmpdir(),
    model: futureModel.value,
  });
  expect(mock.supportedModels).toHaveBeenCalledOnce();
  expect(session.features).toEqual([]);
  await session.close();
});
