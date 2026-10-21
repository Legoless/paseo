export interface TerminalOutputCoalescerTimers {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export interface TerminalOutputCoalescerFlush {
  payload: Buffer;
  chars: number;
  bytes: number;
}

export interface TerminalOutputCoalescerOptions {
  timers: TerminalOutputCoalescerTimers;
  flushDelayMs?: number;
  now?: () => number;
  onFlush: (payload: TerminalOutputCoalescerFlush) => void;
}

const DEFAULT_FLUSH_DELAY_MS = 5;

function outputClearsScreen(data: string): boolean {
  // ESC [ 2 J and ESC [ 3 J. Ink full-clears, then writes the frame. A leading-edge
  // flush of only the clear paints a blank pane before the redraw arrives.
  for (let index = 0; index < data.length - 3; index += 1) {
    if (data.charCodeAt(index) !== 0x1b || data.charCodeAt(index + 1) !== 0x5b) {
      continue;
    }
    const kind = data.charCodeAt(index + 2);
    if ((kind === 0x32 || kind === 0x33) && data.charCodeAt(index + 3) === 0x4a) {
      return true;
    }
  }
  return false;
}

export class TerminalOutputCoalescer {
  private readonly timers: TerminalOutputCoalescerTimers;
  private readonly flushDelayMs: number;
  private readonly now: () => number;
  private readonly onFlush: (payload: TerminalOutputCoalescerFlush) => void;
  private chunks: Buffer[] = [];
  private bytes = 0;
  private chars = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt: number | null = null;
  private pendingClearsScreen = false;

  constructor(options: TerminalOutputCoalescerOptions) {
    this.timers = options.timers;
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
    this.now = options.now ?? Date.now;
    this.onFlush = options.onFlush;
  }

  handle(data: string): void {
    if (data.length === 0) {
      return;
    }

    const chunk = Buffer.from(data, "utf8");
    this.chunks.push(chunk);
    this.bytes += chunk.byteLength;
    this.chars += data.length;
    if (outputClearsScreen(data)) {
      this.pendingClearsScreen = true;
    }

    // Leading edge: if nothing is pending and no flush happened within the last
    // flushDelayMs, flush immediately so interactive echo isn't delayed a full
    // window. A screen clear waits for the trailing window instead, so the redraw
    // that follows in the same burst stays in that frame. Otherwise accumulate
    // and let the trailing timer drain the burst.
    if (!this.flushTimer) {
      const elapsed =
        this.lastFlushAt === null ? Number.POSITIVE_INFINITY : this.now() - this.lastFlushAt;
      if (elapsed >= this.flushDelayMs && !this.pendingClearsScreen) {
        this.flush();
        return;
      }
      this.flushTimer = this.timers.setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.flushDelayMs);
    }
  }

  flush(): void {
    this.clearTimer();

    if (this.chunks.length === 0) {
      return;
    }

    const payload =
      this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.bytes);
    const bytes = this.bytes;
    const chars = this.chars;
    this.clearPending();
    this.lastFlushAt = this.now();

    this.onFlush({ payload, bytes, chars });
  }

  // Record that a frame was emitted out-of-band on this stream (e.g. a snapshot
  // frame sent directly, bypassing the coalescer). This keeps the next handled
  // chunk on the trailing path instead of leading-edge flushing it back-to-back
  // with that frame, preserving the small gap consumers rely on after a snapshot.
  markFlushed(): void {
    this.lastFlushAt = this.now();
  }

  dispose(): void {
    this.clearTimer();
    this.clearPending();
  }

  private clearTimer(): void {
    if (!this.flushTimer) {
      return;
    }
    this.timers.clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private clearPending(): void {
    this.chunks = [];
    this.bytes = 0;
    this.chars = 0;
    this.pendingClearsScreen = false;
  }
}
