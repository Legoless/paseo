import type { StreamItem } from "@/types/stream";

export const DEFAULT_MOUNTED_RECENT_STREAM_ITEMS = 20;

type MountedRecentStreamItemsE2ETestGlobals = typeof globalThis & {
  __PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS?: unknown;
};

function readPositiveIntegerOverride(value: unknown): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value as number);
  return normalized > 0 ? normalized : null;
}

export function getMountedRecentStreamItems(): number {
  const override = readPositiveIntegerOverride(
    (globalThis as MountedRecentStreamItemsE2ETestGlobals)
      .__PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS,
  );
  return override ?? DEFAULT_MOUNTED_RECENT_STREAM_ITEMS;
}

// The window rewinds to its turn's user message so a turn renders whole, but one long autonomous
// turn can hold tens of thousands of rows. Mounting all of them exhausted the desktop renderer's
// 4 GB V8 heap, so past this many extra rows the window starts mid-turn instead.
export const MAX_MOUNTED_TURN_REWIND = 200;

export function findMountedWindowStart(input: {
  items: StreamItem[];
  minMountedCount: number;
}): number {
  const { items, minMountedCount } = input;
  if (items.length <= minMountedCount) {
    return 0;
  }

  const cutoff = items.length - minMountedCount;
  const floor = Math.max(cutoff - MAX_MOUNTED_TURN_REWIND, 0);
  let startIndex = cutoff;
  while (startIndex > floor && items[startIndex]?.kind !== "user_message") {
    startIndex -= 1;
  }
  return startIndex === 0 || items[startIndex]?.kind === "user_message" ? startIndex : cutoff;
}
