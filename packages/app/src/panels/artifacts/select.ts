import type { StreamItem } from "@/types/stream";

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)]\((<[^>]+>|[^)\n]+)\)/g;

export interface ArtifactAgentInput {
  id: string;
  title: string | null;
  cwd: string;
  workspaceId?: string | null;
  archivedAt?: Date | null;
}

export interface ArtifactEntry {
  id: string;
  agentId: string;
  agentTitle: string | null;
  workspaceRoot: string;
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
    for (const item of items) {
      if (item.kind !== "assistant_message") {
        continue;
      }
      const images = extractAssistantImages(item.text);
      for (const [imageIndex, image] of images.entries()) {
        entries.push({
          id: `${agent.id}:${item.id}:${imageIndex}`,
          agentId: agent.id,
          agentTitle: agent.title,
          workspaceRoot: agent.cwd,
          itemId: item.id,
          imageIndex,
          source: image.source,
          alt: image.alt,
          timestamp: item.timestamp,
        });
      }
    }
  }

  entries.sort(compareArtifactEntries);
  return entries;
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

function extractAssistantImages(markdown: string): Array<{ source: string; alt: string | null }> {
  const images: Array<{ source: string; alt: string | null }> = [];
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const source = normalizeMarkdownImageSource(match[2] ?? "");
    if (!source) {
      continue;
    }
    const alt = match[1]?.trim() || null;
    images.push({ source, alt });
  }
  return images;
}

function normalizeMarkdownImageSource(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner || null;
  }
  const titleMatch = /^(.*?)(?:\s+(['"]).*?\2)?$/.exec(trimmed);
  const source = titleMatch?.[1]?.trim() ?? trimmed;
  return source || null;
}
