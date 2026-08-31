import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getAgentWorkspaceLabelKey } from "@getpaseo/protocol/agent-labels";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager, type AgentManagerEvent } from "./agent-manager.js";
import { AgentStorage, type StoredAgentRecord } from "./agent-storage.js";
import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import type { AgentClient } from "./agent-sdk-types.js";

describe("agent workspace-label assignments", () => {
  let paseoHome: string | null = null;

  afterEach(async () => {
    if (paseoHome) await rm(paseoHome, { recursive: true, force: true });
  });

  test("replaces only reserved assignments and publishes stored agents on demand", async () => {
    paseoHome = await mkdtemp(join(tmpdir(), "paseo-agent-labels-"));
    const logger = createTestLogger();
    const storage = new AgentStorage(join(paseoHome, "agents"), logger);
    const agentId = "agent-one";
    const record: StoredAgentRecord = {
      id: agentId,
      provider: "codex",
      cwd: "/repo",
      workspaceId: "workspace-one",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
      labels: {
        purpose: "review",
        [getAgentWorkspaceLabelKey("Urgent")]: "Urgent",
      },
      lastStatus: "closed",
      config: null,
      persistence: null,
    };
    await storage.upsert(record);
    const manager = new AgentManager({ registry: storage, logger });
    const events: AgentManagerEvent[] = [];
    manager.subscribe((event) => events.push(event), { replayState: false });

    await manager.replaceWorkspaceLabelAgentStates(
      [
        {
          agentId,
          assignments: { [getAgentWorkspaceLabelKey("Priority")]: "Priority" },
        },
      ],
      { publish: false },
    );

    expect((await storage.get(agentId))?.labels).toEqual({
      purpose: "review",
      [getAgentWorkspaceLabelKey("Priority")]: "Priority",
    });
    expect(events).toEqual([]);

    await manager.publishWorkspaceLabelAgentStates([agentId]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "stored_agent_state",
        record: expect.objectContaining({
          id: agentId,
          labels: {
            purpose: "review",
            [getAgentWorkspaceLabelKey("Priority")]: "Priority",
          },
        }),
      }),
    ]);
  });

  test("holds live state publication until an assignment transaction settles", async () => {
    paseoHome = await mkdtemp(join(tmpdir(), "paseo-agent-labels-live-"));
    const logger = createTestLogger();
    const storage = new AgentStorage(join(paseoHome, "agents"), logger);
    const manager = new AgentManager({
      clients: { codex: createTestAgentClient("codex") },
      registry: storage,
      logger,
    });
    const agent = await manager.createAgent({ provider: "codex", cwd: paseoHome }, undefined, {
      workspaceId: "workspace-one",
    });
    const urgent = { [getAgentWorkspaceLabelKey("Urgent")]: "Urgent" };
    const priority = { [getAgentWorkspaceLabelKey("Priority")]: "Priority" };
    await manager.replaceWorkspaceLabelAgentStates([{ agentId: agent.id, assignments: urgent }]);
    const events: AgentManagerEvent[] = [];
    manager.subscribe((event) => events.push(event), { replayState: false });

    await manager.holdWorkspaceLabelAgentStates([{ agentId: agent.id, assignments: urgent }]);
    await manager.replaceWorkspaceLabelAgentStates([{ agentId: agent.id, assignments: priority }], {
      publish: false,
    });
    await manager.setLabels(agent.id, { purpose: "review" });
    expect(events).toEqual([]);

    await manager.replaceWorkspaceLabelAgentStates([{ agentId: agent.id, assignments: urgent }], {
      publish: false,
    });
    await manager.releaseWorkspaceLabelAgentStates([agent.id]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "agent_state",
        agent: expect.objectContaining({
          labels: { purpose: "review", ...urgent },
        }),
      }),
    ]);

    events.length = 0;
    await manager.holdWorkspaceLabelAgentStates([{ agentId: agent.id, assignments: urgent }]);
    await manager.replaceWorkspaceLabelAgentStates([{ agentId: agent.id, assignments: priority }], {
      publish: false,
    });
    await manager.closeAgent(agent.id);
    expect(events).toEqual([]);
    await manager.replaceWorkspaceLabelAgentStates([{ agentId: agent.id, assignments: urgent }], {
      publish: false,
    });
    await manager.releaseWorkspaceLabelAgentStates([agent.id]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "stored_agent_state",
        record: expect.objectContaining({ labels: { purpose: "review", ...urgent } }),
      }),
    ]);

    await manager.flush();
  });

  test("registration reloads durable assignments after provider startup", async () => {
    paseoHome = await mkdtemp(join(tmpdir(), "paseo-agent-labels-register-"));
    const logger = createTestLogger();
    const storage = new AgentStorage(join(paseoHome, "agents"), logger);
    const agentId = "00000000-0000-4000-8000-000000000701";
    const urgent = { [getAgentWorkspaceLabelKey("Urgent")]: "Urgent" };
    const priority = { [getAgentWorkspaceLabelKey("Priority")]: "Priority" };
    await storage.upsert({
      id: agentId,
      provider: "codex",
      cwd: paseoHome,
      workspaceId: "workspace-one",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
      labels: urgent,
      lastStatus: "closed",
      config: null,
      persistence: null,
    });
    let releaseProvider!: () => void;
    let providerStarted!: () => void;
    const providerGate = new Promise<void>((resolve) => (releaseProvider = resolve));
    const started = new Promise<void>((resolve) => (providerStarted = resolve));
    const base = createTestAgentClient("codex");
    const delayed: AgentClient = {
      provider: base.provider,
      capabilities: base.capabilities,
      createSession: async (config, context, options) => {
        const session = await base.createSession(config, context, options);
        providerStarted();
        await providerGate;
        return session;
      },
      resumeSession: (handle, overrides, context, options) =>
        base.resumeSession(handle, overrides, context, options),
      fetchCatalog: (options, context) => base.fetchCatalog(options, context),
      isAvailable: (signal) => base.isAvailable(signal),
    };
    const manager = new AgentManager({ clients: { codex: delayed }, registry: storage, logger });

    const registration = manager.createAgent({ provider: "codex", cwd: paseoHome }, agentId, {
      workspaceId: "workspace-one",
      labels: urgent,
    });
    await started;
    await manager.replaceWorkspaceLabelAgentStates([{ agentId, assignments: priority }], {
      publish: false,
    });
    releaseProvider();

    await expect(registration).resolves.toMatchObject({ labels: priority });
    expect((await storage.get(agentId))?.labels).toEqual(priority);
    await manager.closeAgent(agentId);
    await manager.flush();
  });
});
