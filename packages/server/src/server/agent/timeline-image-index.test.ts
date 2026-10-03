import { describe, expect, it } from "vitest";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { buildTimelineImageIndex } from "./timeline-image-index.js";

function row(seq: number, item: AgentTimelineRow["item"], turnId = "turn-1"): AgentTimelineRow {
  return { seq, timestamp: `2026-01-01T00:00:0${seq}.000Z`, item, turnId };
}

describe("buildTimelineImageIndex", () => {
  it("finds an embed split across streamed assistant chunks at the merged message cursor", () => {
    const rows: AgentTimelineRow[] = [
      row(1, { type: "assistant_message", text: "Here: ![Sh" }),
      row(2, { type: "assistant_message", text: "ot](/tmp/sh" }),
      row(3, { type: "assistant_message", text: "ot.png) done" }),
    ];

    expect(buildTimelineImageIndex("epoch-1", rows)).toEqual({
      epoch: "epoch-1",
      images: [
        {
          seq: 3,
          messageId: null,
          timestamp: "2026-01-01T00:00:03.000Z",
          imageIndex: 0,
          source: "/tmp/shot.png",
          alt: "Shot",
        },
      ],
    });
  });

  it("indexes several images per message and image links, per message", () => {
    const rows: AgentTimelineRow[] = [
      row(1, {
        type: "assistant_message",
        messageId: "msg-a",
        text: "![One](/tmp/one.png)\n[two](out/two.jpg) [notes](notes.md)",
      }),
      row(2, { type: "user_message", text: "more" }, "turn-2"),
      row(3, { type: "assistant_message", text: "![Three](https://x.test/3.webp)" }, "turn-2"),
    ];

    expect(
      buildTimelineImageIndex("epoch-1", rows).images.map(
        ({ seq, messageId, imageIndex, source, alt }) => ({
          seq,
          messageId,
          imageIndex,
          source,
          alt,
        }),
      ),
    ).toEqual([
      { seq: 1, messageId: "msg-a", imageIndex: 0, source: "/tmp/one.png", alt: "One" },
      { seq: 1, messageId: "msg-a", imageIndex: 1, source: "out/two.jpg", alt: "two" },
      { seq: 3, messageId: null, imageIndex: 0, source: "https://x.test/3.webp", alt: "Three" },
    ]);
  });

  it("ignores non-assistant rows and messages without images", () => {
    const rows: AgentTimelineRow[] = [
      row(1, { type: "user_message", text: "![Upload](/tmp/user.png)" }),
      row(2, { type: "reasoning", text: "![Thought](/tmp/thought.png)" }),
      row(3, { type: "assistant_message", text: "No images, just /tmp/bare.png" }),
    ];

    expect(buildTimelineImageIndex("epoch-1", rows)).toEqual({ epoch: "epoch-1", images: [] });
  });
});
