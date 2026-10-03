import type { AgentTimelineImageIndexPayload } from "@getpaseo/client/internal/daemon-client";
import type { AgentTimelineCursorState } from "@/stores/session-store";
import { extractMarkdownImages, type MarkdownImage } from "@getpaseo/protocol/markdown-images";
import type { AssistantMessageItem, StreamItem } from "@/types/stream";

/** An agent's full-history image list from `agent.timeline.list_images`. */
export type ArtifactImageHistory = Pick<AgentTimelineImageIndexPayload, "epoch" | "images">;

export interface ArtifactAgentInput {
  id: string;
  title: string | null;
  cwd: string;
  workspaceId?: string | null;
  archivedAt?: Date | null;
  /** See `resolveAgentImageFallbackRoot`. */
  imageFallbackRoot?: string | null;
}

export interface ArtifactEntry {
  id: string;
  agentId: string;
  agentTitle: string | null;
  workspaceRoot: string;
  imageFallbackRoot: string | null;
  itemId: string;
  imageIndex: number;
  source: string;
  alt: string | null;
  timestamp: Date;
}

export function selectWorkspaceArtifacts(input: {
  workspaceId: string;
  agents: readonly ArtifactAgentInput[];
  streamsByAgentId: Readonly<Record<string, readonly StreamItem[]>>;
  historyByAgentId?: Readonly<Record<string, ArtifactImageHistory>>;
  /** Each agent's loaded timeline window; history inside it is already in the stream. */
  loadedRangeByAgentId?: Readonly<Record<string, AgentTimelineCursorState | undefined>>;
}): ArtifactEntry[] {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    return [];
  }

  const entries: ArtifactEntry[] = [];
  for (const agent of input.agents) {
    if (agent.archivedAt) {
      continue;
    }
    if ((agent.workspaceId ?? "").trim() !== workspaceId) {
      continue;
    }

    const items = input.streamsByAgentId[agent.id] ?? [];
    const pushEntry = (itemId: string, imageIndex: number, image: MarkdownImage, at: Date) => {
      entries.push({
        id: `${agent.id}:${itemId}:${imageIndex}`,
        agentId: agent.id,
        agentTitle: agent.title,
        workspaceRoot: agent.cwd,
        imageFallbackRoot: agent.imageFallbackRoot ?? null,
        itemId,
        imageIndex,
        source: image.source,
        alt: image.alt,
        timestamp: at,
      });
    };
    for (const item of items) {
      if (item.kind !== "assistant_message") {
        continue;
      }
      for (const [imageIndex, image] of extractMarkdownImages(item.text).entries()) {
        pushEntry(item.id, imageIndex, image, item.timestamp);
      }
    }

    // The loaded stream is the freshest copy of its window and shares item ids with the chat, so
    // history only fills in what lies before that window. Deduping by position rather than by
    // message: the daemon and the app split a run of assistant rows into messages differently
    // (tool updates land in place in the app), so the same image sits under different messages.
    const history = input.historyByAgentId?.[agent.id];
    const loaded = input.loadedRangeByAgentId?.[agent.id];
    // Without the window a loaded stream's start is unknown (a merged message carries its last
    // chunk's position), so history waits for it rather than risk showing an image twice.
    const windowUnknown = !loaded && items.length > 0;
    if (!history || windowUnknown || (loaded && loaded.epoch !== history.epoch)) {
      continue;
    }
    for (const image of history.images) {
      if (loaded && isLoadedSeq(loaded, image.seq)) {
        continue;
      }
      const itemId = `seq:${history.epoch}:${image.seq}`;
      pushEntry(itemId, image.imageIndex, image, new Date(image.timestamp));
    }
  }

  entries.sort(compareArtifactEntries);
  return entries;
}

function isLoadedSeq(loaded: AgentTimelineCursorState, seq: number): boolean {
  return (
    seq >= loaded.startSeq ||
    (loaded.retainedRanges ?? []).some((range) => seq >= range.startSeq && seq <= range.endSeq)
  );
}

/**
 * Identifies the loaded stream's newest image-bearing message and its position. It changes when
 * the daemon's image list may be behind the stream; text-only output leaves the list unchanged.
 */
export function selectLatestArtifactImageKey(items: readonly StreamItem[]): string {
  const item = items.findLast(
    (candidate): candidate is AssistantMessageItem =>
      candidate.kind === "assistant_message" && extractMarkdownImages(candidate.text).length > 0,
  );
  if (!item) {
    return "";
  }
  const cursor = item.timelineCursor;
  return cursor ? `${item.id}@${cursor.epoch}:${cursor.seq}` : item.id;
}

export function collectAgentStreamItems(input: {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
}): StreamItem[] {
  if (input.head.length === 0) {
    return [...input.tail];
  }
  const tailIds = new Set(input.tail.map((item) => item.id));
  const uniqueHead = input.head.filter((item) => !tailIds.has(item.id));
  return [...input.tail, ...uniqueHead];
}

function compareArtifactEntries(left: ArtifactEntry, right: ArtifactEntry): number {
  const timeDelta = left.timestamp.getTime() - right.timestamp.getTime();
  if (timeDelta !== 0) {
    return timeDelta;
  }
  const agentDelta = left.agentId.localeCompare(right.agentId);
  if (agentDelta !== 0) {
    return agentDelta;
  }
  const itemDelta = left.itemId.localeCompare(right.itemId);
  if (itemDelta !== 0) {
    return itemDelta;
  }
  return left.id.localeCompare(right.id);
}
