import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  collectAgentStreamItems,
  selectWorkspaceArtifacts,
  type ArtifactAgentInput,
} from "./select";

function agent(
  input: Partial<ArtifactAgentInput> & Pick<ArtifactAgentInput, "id">,
): ArtifactAgentInput {
  return {
    title: input.title ?? input.id,
    cwd: input.cwd ?? "/tmp/repo",
    workspaceId: input.workspaceId ?? "ws-1",
    archivedAt: input.archivedAt,
    id: input.id,
  };
}

function assistantImage(input: {
  id: string;
  source: string;
  alt?: string;
  timestamp: Date;
  extra?: string;
}): StreamItem {
  const alt = input.alt ?? "Screenshot";
  const extra = input.extra ? `${input.extra}\n\n` : "";
  return {
    kind: "assistant_message",
    id: input.id,
    text: `${extra}![${alt}](${input.source})`,
    timestamp: input.timestamp,
  };
}

function userImage(input: { id: string; timestamp: Date }): StreamItem {
  return {
    kind: "user_message",
    id: input.id,
    text: "![Upload](/tmp/user.png)",
    timestamp: input.timestamp,
  };
}

describe("selectWorkspaceArtifacts", () => {
  const firstShotAt = new Date("2026-09-21T10:00:00.000Z");
  const secondShotAt = new Date("2026-09-21T10:01:00.000Z");

  it("collects assistant images from every current workspace agent, oldest first", () => {
    expect(
      selectWorkspaceArtifacts({
        workspaceId: "ws-1",
        agents: [
          agent({ id: "agent-b", title: "Browser" }),
          agent({ id: "agent-a", title: "Coder" }),
        ],
        streamsByAgentId: {
          "agent-b": [
            assistantImage({
              id: "msg-b",
              source: "/tmp/browser.png",
              alt: "Checkout",
              timestamp: secondShotAt,
            }),
          ],
          "agent-a": [
            assistantImage({
              id: "msg-a",
              source: "https://example.com/a.png",
              alt: "Diff",
              timestamp: firstShotAt,
            }),
          ],
        },
      }),
    ).toEqual([
      {
        id: "agent-a:msg-a:0",
        agentId: "agent-a",
        agentTitle: "Coder",
        workspaceRoot: "/tmp/repo",
        itemId: "msg-a",
        imageIndex: 0,
        source: "https://example.com/a.png",
        alt: "Diff",
        timestamp: firstShotAt,
      },
      {
        id: "agent-b:msg-b:0",
        agentId: "agent-b",
        agentTitle: "Browser",
        workspaceRoot: "/tmp/repo",
        itemId: "msg-b",
        imageIndex: 0,
        source: "/tmp/browser.png",
        alt: "Checkout",
        timestamp: secondShotAt,
      },
    ]);
  });

  it("drops archived agents and images the user attached", () => {
    expect(
      selectWorkspaceArtifacts({
        workspaceId: "ws-1",
        agents: [
          agent({ id: "live", title: "Live" }),
          agent({ id: "old", title: "Old", archivedAt: new Date("2026-09-20T12:00:00.000Z") }),
        ],
        streamsByAgentId: {
          live: [
            userImage({ id: "user-1", timestamp: firstShotAt }),
            assistantImage({
              id: "live-shot",
              source: "/tmp/live.png",
              timestamp: secondShotAt,
            }),
          ],
          old: [
            assistantImage({
              id: "old-shot",
              source: "/tmp/old.png",
              timestamp: firstShotAt,
            }),
          ],
        },
      }),
    ).toEqual([
      {
        id: "live:live-shot:0",
        agentId: "live",
        agentTitle: "Live",
        workspaceRoot: "/tmp/repo",
        itemId: "live-shot",
        imageIndex: 0,
        source: "/tmp/live.png",
        alt: "Screenshot",
        timestamp: secondShotAt,
      },
    ]);
  });

  it("ignores agents from other workspaces and empty workspace ids", () => {
    const streams = {
      "ws-1-agent": [
        assistantImage({
          id: "keep",
          source: "/tmp/keep.png",
          timestamp: firstShotAt,
        }),
      ],
      "ws-2-agent": [
        assistantImage({
          id: "other",
          source: "/tmp/other.png",
          timestamp: firstShotAt,
        }),
      ],
    };

    expect(
      selectWorkspaceArtifacts({
        workspaceId: "ws-1",
        agents: [
          agent({ id: "ws-1-agent", workspaceId: "ws-1" }),
          agent({ id: "ws-2-agent", workspaceId: "ws-2" }),
        ],
        streamsByAgentId: streams,
      }),
    ).toEqual([
      expect.objectContaining({
        id: "ws-1-agent:keep:0",
        source: "/tmp/keep.png",
      }),
    ]);
    expect(
      selectWorkspaceArtifacts({
        workspaceId: "   ",
        agents: [agent({ id: "ws-1-agent" })],
        streamsByAgentId: streams,
      }),
    ).toEqual([]);
  });

  it("emits one row per image in an assistant message", () => {
    expect(
      selectWorkspaceArtifacts({
        workspaceId: "ws-1",
        agents: [agent({ id: "agent-a" })],
        streamsByAgentId: {
          "agent-a": [
            {
              kind: "assistant_message",
              id: "multi",
              text: "![One](/tmp/one.png)\n\n![Two](https://example.com/two.png)",
              timestamp: firstShotAt,
            },
          ],
        },
      }).map((entry) => entry.source),
    ).toEqual(["/tmp/one.png", "https://example.com/two.png"]);
  });
});

describe("collectAgentStreamItems", () => {
  it("appends live head items that are not already in the tail", () => {
    const tailItem = assistantImage({
      id: "tail",
      source: "/tmp/tail.png",
      timestamp: new Date("2026-09-21T10:00:00.000Z"),
    });
    const headItem = assistantImage({
      id: "head",
      source: "/tmp/head.png",
      timestamp: new Date("2026-09-21T10:01:00.000Z"),
    });

    expect(collectAgentStreamItems({ tail: [tailItem], head: [tailItem, headItem] })).toEqual([
      tailItem,
      headItem,
    ]);
  });
});
