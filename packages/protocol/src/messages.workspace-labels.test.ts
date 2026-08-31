import { describe, expect, test } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("workspace label wire schemas", () => {
  test("keeps the capability optional for old daemons", () => {
    const features = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "old-host",
      features: {},
    }).features;
    expect(features.workspaceLabels).toBeUndefined();
    expect(features.agentLabels).toBeUndefined();
  });

  test("parses the explicit list subscription and sequenced response", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "workspace.label.list.request",
        requestId: "req-1",
        subscribe: { subscriptionId: "labels-1" },
        sync: { generation: "generation-1", afterSeq: 4 },
      }),
    ).toMatchObject({ type: "workspace.label.list.request" });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "workspace.label.list.response",
        payload: {
          requestId: "req-1",
          labels: [],
          sync: {
            mode: "changes",
            generation: "generation-1",
            headSeq: 4,
            removals: [],
          },
        },
      }),
    ).toMatchObject({ type: "workspace.label.list.response", payload: { labels: [] } });
  });

  test("accepts optional label data without requiring it on legacy workspace messages", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "workspace.label.update",
        payload: {
          kind: "upsert",
          label: { name: "Needs review", color: "sky" },
          generation: "generation-1",
          seq: 5,
        },
      }),
    ).toMatchObject({ payload: { label: { name: "Needs review", color: "sky" } } });
  });

  test("carries a name and a colour on one edit, and neither is required", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "workspace.label.update.request",
        requestId: "req-edit",
        name: "Urgent",
        newName: "Priority",
        color: "sky",
      }),
    ).toMatchObject({ newName: "Priority", color: "sky" });
    // A colour-only edit and a name-only edit are the same operation with a field left out.
    expect(
      SessionInboundMessageSchema.parse({
        type: "workspace.label.update.request",
        requestId: "req-color",
        name: "Urgent",
        color: "amber",
      }),
    ).toEqual({
      type: "workspace.label.update.request",
      requestId: "req-color",
      name: "Urgent",
      color: "amber",
    });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "workspace.label.update.response",
        payload: {
          requestId: "req-edit",
          label: { name: "Priority", color: "sky" },
          affectedWorkspaceCount: 2,
        },
      }),
    ).toMatchObject({ payload: { affectedWorkspaceCount: 2 } });
  });

  test("uses a distinct operation for authoritative non-mutating delete inspection", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "workspace.label.delete.inspect.request",
        requestId: "req-delete",
        name: "Urgent",
      }),
    ).toMatchObject({ type: "workspace.label.delete.inspect.request" });
  });

  test("requires the fields promised by each operation", () => {
    expect(() =>
      SessionOutboundMessageSchema.parse({
        type: "workspace.label.assignment.set.response",
        payload: { requestId: "req-assignment", label: { name: "Urgent", color: "red" } },
      }),
    ).toThrow();
    expect(() =>
      SessionOutboundMessageSchema.parse({
        type: "workspace.label.delete.inspect.response",
        payload: { requestId: "req-inspect" },
      }),
    ).toThrow();
    expect(() =>
      SessionOutboundMessageSchema.parse({
        type: "workspace.label.update.response",
        payload: { requestId: "req-edit", label: { name: "Priority", color: "sky" } },
      }),
    ).toThrow();
  });

  test("assigns the shared catalog labels to agents through a distinct RPC", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.label.assignment.set.request",
        requestId: "req-agent-label",
        agentId: "agent-1",
        label: { name: "Urgent", color: "red" },
        assigned: true,
      }),
    ).toMatchObject({ type: "agent.label.assignment.set.request", agentId: "agent-1" });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.label.assignment.set.response",
        payload: {
          requestId: "req-agent-label",
          label: { name: "Urgent", color: "red" },
          agentLabels: ["Urgent"],
        },
      }),
    ).toMatchObject({ payload: { agentLabels: ["Urgent"] } });
  });

  test("accepts label edit counts from new daemons and their absence from old daemons", () => {
    const base = {
      type: "workspace.label.delete.inspect.response" as const,
      payload: { requestId: "req-inspect", affectedWorkspaceCount: 2 },
    };
    expect(SessionOutboundMessageSchema.parse(base)).toMatchObject(base);
    expect(
      SessionOutboundMessageSchema.parse({
        ...base,
        payload: { ...base.payload, affectedAgentCount: 3 },
      }),
    ).toMatchObject({ payload: { affectedAgentCount: 3 } });
  });
});
