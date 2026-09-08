import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Logger } from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentModelDefinition, AgentSession, AgentSessionConfig } from "../agent-sdk-types.js";
import { CodexAppServerAgentClient, CodexAppServerAgentSession } from "./codex-app-server-agent.js";
import {
  createFakeCodexAppServer,
  type FakeCodexAppServer,
} from "./codex/test-utils/fake-app-server.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { asInternals } from "../../test-utils/class-mocks.js";

const FUTURE_MODEL = "future-model/unknown-generation";
const TIERS = [
  { id: "priority", name: "Fast", description: "Native priority description" },
  { id: "economy/vNext", name: "Economy", description: "Native economy description" },
];
const PLAN = {
  type: "toggle",
  id: "plan_mode",
  label: "Plan",
  description: "Switch Codex into planning-only collaboration mode",
  tooltip: "Toggle plan mode",
  icon: "list-todo",
  value: false,
};
const sessions: AgentSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
});

function createConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    provider: "codex",
    cwd: "/tmp/codex-speed-test",
    modeId: "auto",
    model: FUTURE_MODEL,
    ...overrides,
  };
}

async function connectedSession(overrides: Partial<AgentSessionConfig> = {}) {
  const appServer = createFakeCodexAppServer({
    "model/list": () => ({
      data: [
        {
          id: FUTURE_MODEL,
          isDefault: true,
          defaultReasoningEffort: "medium",
          serviceTiers: TIERS,
        },
      ],
    }),
    "collaborationMode/list": () => ({
      data: [
        { name: "Code", mode: "code" },
        { name: "Plan", mode: "plan" },
      ],
    }),
  });
  const session = new CodexAppServerAgentSession(
    createConfig(overrides),
    null,
    createTestLogger(),
    async () => appServer.child,
  );
  sessions.push(session);
  await session.connect();
  appServer.assertNoErrors();
  return { session, appServer };
}

function catalogClient(appServers: FakeCodexAppServer[]) {
  const client = new CodexAppServerAgentClient(createTestLogger());
  const internals = asInternals<{
    goalsEnabledPromise: Promise<boolean> | null;
    autoReviewEnabledPromise: Promise<boolean> | null;
    spawnAppServer: () => Promise<ChildProcessWithoutNullStreams>;
  }>(client);
  internals.goalsEnabledPromise = Promise.resolve(false);
  internals.autoReviewEnabledPromise = Promise.resolve(false);
  let spawns = 0;
  internals.spawnAppServer = async () => {
    const appServer = appServers[spawns++];
    if (!appServer) throw new Error("Unexpected Codex helper process");
    return appServer.child;
  };
  return { client, spawns: () => spawns };
}

describe("Codex native speed capabilities", () => {
  test("an unknown future model exposes the exact advertised service tiers", async () => {
    const { session, appServer } = await connectedSession();
    expect(session.features).toEqual([
      {
        type: "select",
        id: "service_tier",
        label: "Speed",
        tooltip: "Select inference speed",
        icon: "zap",
        value: "",
        options: [
          { id: "", label: "Default" },
          { id: "priority", label: "Fast", description: "Native priority description" },
          { id: "economy/vNext", label: "Economy", description: "Native economy description" },
        ],
      },
      PLAN,
    ]);
    await session.setFeature("service_tier", "economy/vNext");
    await session.startTurn("hello");
    expect(await appServer.waitForTurnStart()).toMatchObject({ serviceTier: "economy/vNext" });
  });

  test("a familiar model name without advertised tiers exposes no Speed control", async () => {
    const { session, appServer } = await connectedSession({
      model: "gpt-5-future-no-tiers",
      featureValues: { fast_mode: true },
    });
    expect(session.features).toEqual([PLAN]);
    await session.startTurn("hello");
    const turnRequest = await appServer.waitForTurnStart();
    expect(turnRequest).toMatchObject({ model: "gpt-5-future-no-tiers", serviceTier: null });
    expect(turnRequest).not.toHaveProperty("effort");
    expect(appServer.requests().filter((request) => request.method === "model/list")).toHaveLength(
      1,
    );
  });

  test("saved fast_mode becomes an advertised native tier and preserves Plan", async () => {
    const { session, appServer } = await connectedSession({
      featureValues: { fast_mode: true, plan_mode: true },
    });
    expect(session.features[0]).toMatchObject({ id: "service_tier", value: "priority" });
    await session.startTurn("hello");
    expect(await appServer.waitForTurnStart()).toMatchObject({
      serviceTier: "priority",
      collaborationMode: { mode: "plan" },
    });
    expect(asInternals<{ config: AgentSessionConfig }>(session).config.featureValues).toEqual({
      service_tier: "priority",
      plan_mode: true,
    });
  });

  test("explicit native tier IDs win over old flags and are sent unchanged", async () => {
    const { session, appServer } = await connectedSession({
      featureValues: { fast_mode: true, service_tier: "economy/vNext" },
    });
    expect(session.features[0]).toMatchObject({ value: "economy/vNext" });
    await session.startTurn("hello");
    expect(await appServer.waitForTurnStart()).toMatchObject({ serviceTier: "economy/vNext" });
  });

  test("selecting Default explicitly clears the turn service tier", async () => {
    const { session, appServer } = await connectedSession({
      featureValues: { service_tier: "priority" },
    });
    await session.setFeature("service_tier", "");
    await session.startTurn("hello");
    expect(await appServer.waitForTurnStart()).toMatchObject({ serviceTier: null });
  });

  test("tier updates validate against the selected model without changing a valid choice", async () => {
    const { session } = await connectedSession({
      featureValues: { service_tier: "economy/vNext" },
    });
    await expect(session.setFeature("service_tier", "unadvertised")).rejects.toThrow(
      "not available",
    );
    await expect(session.setFeature("service_tier", true)).rejects.toThrow("not available");
    await expect(session.setFeature("fast_mode", true)).rejects.toThrow("Unknown Codex feature");
    expect(session.features[0]).toMatchObject({ value: "economy/vNext" });
  });

  test("switching to a model without the selected tier clears it", async () => {
    const { session, appServer } = await connectedSession({
      featureValues: { service_tier: "priority" },
    });
    await session.setModel("another-future-model");
    expect(session.features).toEqual([PLAN]);
    await session.startTurn("hello");
    expect(await appServer.waitForTurnStart()).toMatchObject({ serviceTier: null });
  });

  test("turn summaries report the native tier without logging the prompt", async () => {
    const { session } = await connectedSession({
      featureValues: { service_tier: "economy/vNext" },
    });
    const info = vi.spyOn(asInternals<{ logger: Logger }>(session).logger, "info");
    const prompt = "Secret prompt content must stay out of diagnostic summaries";
    await session.startTurn(prompt);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ model: FUTURE_MODEL, serviceTier: "economy/vNext" }),
      "Starting Codex app-server turn",
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain(prompt);
  });

  test("Plan can still be changed independently of speed", async () => {
    const { session, appServer } = await connectedSession({
      featureValues: { service_tier: "economy/vNext" },
    });
    await session.setFeature("plan_mode", true);
    expect(await session.getRuntimeInfo()).toMatchObject({ extra: { collaborationMode: "Plan" } });
    await session.startTurn("hello");
    expect(await appServer.waitForTurnStart()).toMatchObject({
      serviceTier: "economy/vNext",
      collaborationMode: { mode: "plan" },
    });
  });
});

describe("Codex model catalog", () => {
  test("paginates native models, keeps unknown reasoning and tier IDs, and preserves visibility/defaults", async () => {
    const cursors: unknown[] = [];
    const appServer = createFakeCodexAppServer({
      "model/list": (params) => {
        cursors.push(params);
        if (cursors.length === 1)
          return {
            data: [{ id: "retired-future-model", hidden: true }],
            nextCursor: "native/page-2",
          };
        return {
          data: [
            {
              id: FUTURE_MODEL,
              model: FUTURE_MODEL,
              displayName: "Future model",
              isDefault: true,
              hidden: false,
              supportedReasoningEfforts: [
                { reasoningEffort: "beyond-ultra", description: "Native effort" },
              ],
              defaultReasoningEffort: "beyond-ultra",
              serviceTiers: TIERS,
              defaultServiceTier: "economy/vNext",
            },
          ],
          nextCursor: null,
        };
      },
    });
    const { client, spawns } = catalogClient([appServer]);
    const catalog = await client.fetchCatalog({ scope: "global", force: false });
    expect(cursors).toEqual([{}, { cursor: "native/page-2" }]);
    expect(catalog.models[0]).toMatchObject({ id: "retired-future-model", isSelectable: false });
    expect(catalog.models[1]).toMatchObject({
      id: FUTURE_MODEL,
      isDefault: true,
      isSelectable: true,
      defaultThinkingOptionId: "beyond-ultra",
      thinkingOptions: [
        {
          id: "beyond-ultra",
          label: "beyond-ultra",
          description: "Native effort",
          isDefault: true,
        },
      ],
      metadata: { serviceTiers: TIERS, defaultServiceTier: "economy/vNext" },
    });
    expect((await client.listFeatures(createConfig())).map((feature) => feature.id)).toEqual([
      "service_tier",
      "plan_mode",
    ]);
    await client.listFeatures(createConfig({ cwd: "/elsewhere" }));
    expect(spawns()).toBe(1);
    expect(appServer.requests().filter((request) => request.method === "thread/start")).toEqual([]);
    appServer.assertNoErrors();
  });

  test("draft discovery normalizes an old Fast preference using an advertised future tier", async () => {
    const { client, spawns } = catalogClient([]);
    client.setModelCatalog([
      {
        provider: "codex",
        id: FUTURE_MODEL,
        label: "Future model",
        metadata: { serviceTiers: [{ id: "next-native-tier", name: "Fast" }] },
      },
    ]);
    expect(
      (await client.listFeatures(createConfig({ featureValues: { fast_mode: true } })))[0],
    ).toMatchObject({ id: "service_tier", value: "next-native-tier" });
    expect(
      (
        await client.listFeatures(
          createConfig({ featureValues: { fast_mode: true, service_tier: "" } }),
        )
      )[0],
    ).toMatchObject({ id: "service_tier", value: "" });
    expect(spawns()).toBe(0);
  });

  test("a cold cwd catalog read refreshes native models even without force", async () => {
    const initial = createFakeCodexAppServer({
      "model/list": () => ({ data: [{ id: FUTURE_MODEL, serviceTiers: TIERS }] }),
    });
    const refreshed = createFakeCodexAppServer({
      "model/list": () => ({ data: [{ id: FUTURE_MODEL, serviceTiers: [] }] }),
    });
    const { client, spawns } = catalogClient([initial, refreshed]);
    expect((await client.listFeatures(createConfig())).map((feature) => feature.id)).toContain(
      "service_tier",
    );
    await client.fetchCatalog({ scope: "workspace", cwd: "/new-project", force: false });
    expect(await client.listFeatures(createConfig({ cwd: "/new-project" }))).toEqual([PLAN]);
    expect(spawns()).toBe(2);
  });

  test("final merged catalog updates reach existing sessions and do not discover replacement models again", async () => {
    const appServer = createFakeCodexAppServer();
    const { client, spawns } = catalogClient([appServer]);
    const model: AgentModelDefinition = {
      provider: "codex",
      id: FUTURE_MODEL,
      label: "Configured future model",
      metadata: { serviceTiers: TIERS },
    };
    client.setModelCatalog([model]);
    const session = await client.createSession(
      createConfig({ featureValues: { service_tier: "priority" } }),
    );
    sessions.push(session);
    expect(session.features?.[0]).toMatchObject({ id: "service_tier", value: "priority" });
    client.setModelCatalog([{ ...model, metadata: { serviceTiers: [TIERS[1]] } }]);
    expect(session.features?.[0]).toMatchObject({
      id: "service_tier",
      value: "",
      options: [
        { id: "", label: "Default" },
        { id: "economy/vNext", label: "Economy", description: "Native economy description" },
      ],
    });
    expect((await client.listFeatures(createConfig()))[0]).toEqual(session.features?.[0]);
    expect(spawns()).toBe(1);
    expect(appServer.requests().filter((request) => request.method === "model/list")).toEqual([]);
  });

  test("resolved catalogs stay scoped to each live session's directory", async () => {
    const { client } = catalogClient([createFakeCodexAppServer(), createFakeCodexAppServer()]);
    const model: AgentModelDefinition = {
      provider: "codex",
      id: FUTURE_MODEL,
      label: "Future model",
    };
    const scopeA = { scope: "workspace" as const, cwd: "/workspace/a", force: false };
    const scopeB = { scope: "workspace" as const, cwd: "/workspace/b", force: false };
    client.setModelCatalog([{ ...model, metadata: { serviceTiers: [TIERS[0]] } }], scopeA);
    client.setModelCatalog([{ ...model, metadata: { serviceTiers: [TIERS[1]] } }], scopeB);
    const sessionA = await client.createSession(
      createConfig({ cwd: scopeA.cwd, featureValues: { service_tier: "priority" } }),
    );
    const sessionB = await client.createSession(
      createConfig({ cwd: scopeB.cwd, featureValues: { service_tier: "economy/vNext" } }),
    );
    sessions.push(sessionA, sessionB);
    client.setModelCatalog([{ ...model, metadata: { serviceTiers: [] } }], scopeB);
    expect(sessionA.features?.[0]).toMatchObject({
      id: "service_tier",
      value: "priority",
      options: [
        { id: "", label: "Default" },
        { id: "priority", label: "Fast", description: "Native priority description" },
      ],
    });
    expect(sessionB.features).toEqual([]);
    expect((await client.listFeatures(createConfig({ cwd: scopeA.cwd })))[0]).toMatchObject({
      id: "service_tier",
    });
    expect(await client.listFeatures(createConfig({ cwd: scopeB.cwd }))).toEqual([PLAN]);
  });

  test("a superseded native load cannot overwrite the newer published catalog", async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const first = createFakeCodexAppServer({ "model/list": () => firstResponse });
    const second = createFakeCodexAppServer({
      "model/list": () => ({ data: [{ id: FUTURE_MODEL, serviceTiers: [TIERS[1]] }] }),
    });
    const { client } = catalogClient([first, second]);
    const stale = client.fetchCatalog({ scope: "global", force: false });
    await first.waitForRequest("model/list");
    const current = await client.fetchCatalog({ scope: "global", force: true });
    client.setModelCatalog(current.models, { scope: "global", force: true });
    resolveFirst({ data: [{ id: FUTURE_MODEL, serviceTiers: [TIERS[0]] }] });
    await stale;
    expect((await client.listFeatures(createConfig()))[0]).toMatchObject({
      options: [
        { id: "", label: "Default" },
        { id: "economy/vNext", label: "Economy", description: "Native economy description" },
      ],
    });
  });

  test("rejects a repeated native pagination cursor and disposes its helper", async () => {
    const appServer = createFakeCodexAppServer({
      "model/list": () => ({ data: [], nextCursor: "same-page" }),
    });
    const kill = vi.spyOn(appServer.child, "kill");
    const { client } = catalogClient([appServer]);
    await expect(client.fetchCatalog({ scope: "global", force: false })).rejects.toThrow(
      "repeated a pagination cursor",
    );
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });
});
