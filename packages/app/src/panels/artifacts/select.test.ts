import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  collectAgentStreamItems,
  selectLatestArtifactImageKey,
  selectWorkspaceArtifacts,
  type ArtifactAgentInput,
  type ArtifactImageHistory,
} from "./select";

function agent(
  input: Partial<ArtifactAgentInput> & Pick<ArtifactAgentInput, "id">,
): ArtifactAgentInput {
  return {
    title: input.title ?? input.id,
    cwd: input.cwd ?? "/tmp/repo",
    workspaceId: input.workspaceId ?? "ws-1",
    archivedAt: input.archivedAt,
    imageFallbackRoot: input.imageFallbackRoot,
    id: input.id,
  };
}

function assistantImage(input: {
  id: string;
  source: string;
  alt?: string;
  timestamp: Date;
  extra?: string;
  messageId?: string;
  seq?: number;
}): StreamItem {
  const alt = input.alt ?? "Screenshot";
  const extra = input.extra ? `${input.extra}\n\n` : "";
  return {
    kind: "assistant_message",
    id: input.id,
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.seq === undefined ? {} : { timelineCursor: { epoch: "e1", seq: input.seq } }),
    text: `${extra}![${alt}](${input.source})`,
    timestamp: input.timestamp,
  };
}

function historyImage(
  input: Partial<ArtifactImageHistory["images"][number]> & { seq: number; source: string },
): ArtifactImageHistory["images"][number] {
  return {
    messageId: null,
    timestamp: "2026-09-21T09:00:00.000Z",
    imageIndex: 0,
    alt: null,
    ...input,
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
        imageFallbackRoot: null,
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
        imageFallbackRoot: null,
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
        imageFallbackRoot: null,
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

describe("selectWorkspaceArtifacts with daemon image history", () => {
  const liveAt = new Date("2026-09-21T10:00:00.000Z");

  it("adds history from before the loaded window and leaves the window to the stream", () => {
    const entries = selectWorkspaceArtifacts({
      workspaceId: "ws-1",
      agents: [agent({ id: "grok", imageFallbackRoot: "~/.grok/sessions/s1" })],
      streamsByAgentId: {
        grok: [
          assistantImage({ id: "by-seq", source: "/tmp/seq.png", timestamp: liveAt, seq: 40 }),
          assistantImage({
            id: "item-9",
            messageId: "msg-9",
            source: "/tmp/id.png",
            timestamp: liveAt,
            seq: 45,
          }),
        ],
      },
      loadedRangeByAgentId: { grok: { epoch: "e1", startSeq: 40, endSeq: 45 } },
      historyByAgentId: {
        grok: {
          epoch: "e1",
          images: [
            historyImage({ seq: 3, source: "images/old.png", alt: "Old" }),
            historyImage({
              seq: 7,
              messageId: "msg-7",
              imageIndex: 1,
              source: "/tmp/seven.png",
              timestamp: "2026-09-21T09:30:00.000Z",
            }),
            historyImage({ seq: 40, source: "/tmp/seq.png" }),
            // A message still streaming when the list was built sits at an older seq.
            historyImage({ seq: 44, messageId: "msg-9", source: "/tmp/id.png" }),
          ],
        },
      },
    });

    expect(entries.map((entry) => [entry.id, entry.source])).toEqual([
      ["grok:seq:e1:3:0", "images/old.png"],
      ["grok:seq:e1:7:1", "/tmp/seven.png"],
      ["grok:by-seq:0", "/tmp/seq.png"],
      ["grok:item-9:0", "/tmp/id.png"],
    ]);
    expect(entries[0]).toEqual({
      id: "grok:seq:e1:3:0",
      agentId: "grok",
      agentTitle: "grok",
      workspaceRoot: "/tmp/repo",
      imageFallbackRoot: "~/.grok/sessions/s1",
      itemId: "seq:e1:3",
      imageIndex: 0,
      source: "images/old.png",
      alt: "Old",
      timestamp: new Date("2026-09-21T09:00:00.000Z"),
    });
  });

  it("shows parallel tool images once when the app and the daemon split the message differently", () => {
    // The app folds both images into the message they follow; the daemon lists each at its own
    // row. Deduping by message would show both twice.
    const entries = selectWorkspaceArtifacts({
      workspaceId: "ws-1",
      agents: [agent({ id: "grok" })],
      streamsByAgentId: {
        grok: [
          {
            kind: "assistant_message",
            id: "m1",
            text: "Reading both.\n\n![Image](/tmp/a.png)![Image](/tmp/b.png)",
            timestamp: liveAt,
            timelineCursor: { epoch: "e1", seq: 1 },
          },
        ],
      },
      loadedRangeByAgentId: { grok: { epoch: "e1", startSeq: 1, endSeq: 7 } },
      historyByAgentId: {
        grok: {
          epoch: "e1",
          images: [
            historyImage({ seq: 5, source: "/tmp/a.png" }),
            historyImage({ seq: 7, source: "/tmp/b.png" }),
          ],
        },
      },
    });
    expect(entries.map((entry) => entry.source)).toEqual(["/tmp/a.png", "/tmp/b.png"]);
  });

  it("waits for a fresh list when the loaded window moved to another epoch", () => {
    const entries = selectWorkspaceArtifacts({
      workspaceId: "ws-1",
      agents: [agent({ id: "grok" })],
      streamsByAgentId: { grok: [] },
      loadedRangeByAgentId: { grok: { epoch: "e2", startSeq: 1, endSeq: 3 } },
      historyByAgentId: {
        grok: { epoch: "e1", images: [historyImage({ seq: 1, source: "/tmp/old.png" })] },
      },
    });
    expect(entries).toEqual([]);
  });

  it("uses the whole list for an agent whose timeline is not loaded", () => {
    const entries = selectWorkspaceArtifacts({
      workspaceId: "ws-1",
      agents: [agent({ id: "grok" })],
      streamsByAgentId: {},
      historyByAgentId: {
        grok: {
          epoch: "e1",
          images: [
            historyImage({ seq: 1, source: "/tmp/a.png" }),
            historyImage({ seq: 9, source: "/tmp/b.png" }),
          ],
        },
      },
    });
    expect(entries.map((entry) => entry.source)).toEqual(["/tmp/a.png", "/tmp/b.png"]);
  });

  it("keeps history out for archived and other-workspace agents", () => {
    const history = { epoch: "e1", images: [historyImage({ seq: 1, source: "/tmp/a.png" })] };
    expect(
      selectWorkspaceArtifacts({
        workspaceId: "ws-1",
        agents: [
          agent({ id: "archived", archivedAt: new Date("2026-09-20T12:00:00.000Z") }),
          agent({ id: "elsewhere", workspaceId: "ws-2" }),
        ],
        streamsByAgentId: {},
        historyByAgentId: { archived: history, elsewhere: history },
      }),
    ).toEqual([]);
  });

  it("reads image links and escaped paths the way the chat renders them", () => {
    expect(
      selectWorkspaceArtifacts({
        workspaceId: "ws-1",
        agents: [agent({ id: "agent-a" })],
        streamsByAgentId: {
          "agent-a": [
            {
              kind: "assistant_message",
              id: "links",
              text: "[Saved shot](/tmp/shot.png) and [notes](/tmp/notes.md)\n\n![Win](C:\\\\Users\\\\a.png)",
              timestamp: liveAt,
            },
          ],
        },
      }).map((entry) => entry.source),
    ).toEqual(["/tmp/shot.png", "C:\\Users\\a.png"]);
  });
});

describe("selectLatestArtifactImageKey", () => {
  const at = new Date("2026-09-21T10:00:00.000Z");

  it("tracks the newest image message and ignores text-only output after it", () => {
    const shot = assistantImage({ id: "shot", source: "/tmp/a.png", timestamp: at, seq: 4 });
    const text: StreamItem = {
      kind: "assistant_message",
      id: "text",
      text: "Done.",
      timestamp: at,
    };

    expect(selectLatestArtifactImageKey([text])).toBe("");
    expect(selectLatestArtifactImageKey([shot, text])).toBe("shot@e1:4");
    expect(
      selectLatestArtifactImageKey([
        assistantImage({ id: "shot", source: "/tmp/a.png", timestamp: at, seq: 9 }),
      ]),
    ).toBe("shot@e1:9");
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
