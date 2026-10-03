import { extractMarkdownImages } from "@getpaseo/protocol/markdown-images";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { projectTimelineRows } from "./timeline-projection.js";

export interface TimelineImageIndexEntry {
  seq: number;
  messageId: string | null;
  timestamp: string;
  imageIndex: number;
  source: string;
  alt: string | null;
}

export interface TimelineImageIndex {
  epoch: string;
  images: TimelineImageIndexEntry[];
}

export function buildTimelineImageIndex(
  epoch: string,
  rows: readonly AgentTimelineRow[],
): TimelineImageIndex {
  // Image indices must count within the whole message the app renders, and a markdown embed can
  // straddle two streamed chunks. Projection merges those chunks; rows that are already projected
  // pass through unchanged.
  const entries = projectTimelineRows({ rows, mode: "projected" });
  return {
    epoch,
    images: entries.flatMap((entry) => {
      const item = entry.item;
      if (item.type !== "assistant_message") {
        return [];
      }
      return extractMarkdownImages(item.text).map((image, imageIndex) => ({
        seq: entry.seqEnd,
        messageId: item.messageId ?? null,
        timestamp: entry.timestamp,
        imageIndex,
        source: image.source,
        alt: image.alt,
      }));
    }),
  };
}
