import type {
  TerminalActivityAttentionReason,
  TerminalActivityState,
} from "@getpaseo/protocol/terminal-activity";

export interface TerminalActivitySnapshot {
  state: TerminalActivityState | null;
  attentionReason: TerminalActivityAttentionReason | null;
  changedAt: number;
}

export class TerminalActivityTracker {
  // unknown != idle: a plain shell, or a terminal whose agent was killed, has no dot or rollup.
  private resolvedState: TerminalActivityState | null = null;
  private attentionReason: TerminalActivityAttentionReason | null = null;
  private changedAt = Date.now();
  // The hook session that started or first confirmed the current turn. A nested
  // `claude -p` in the pane (Bash tool, advisors, teammates) inherits the pane's hook
  // env and posts its own running/idle; its Stop must not finish the outer turn.
  // Kept across needs_input so the owner resumes after an approval.
  private ownerSessionId: string | null = null;

  private readonly changeListeners = new Set<
    (snapshot: TerminalActivitySnapshot, previous: TerminalActivitySnapshot) => void
  >();

  set(
    state: TerminalActivityState,
    attentionReason?: TerminalActivityAttentionReason,
    sessionId?: string,
  ): void {
    const owner = this.ownerSessionId;
    if (sessionId && owner && sessionId !== owner && this.resolvedState === "working") {
      return;
    }
    if (sessionId && state === "working") {
      // Starting a turn makes the reporter the owner, replacing one kept across a
      // needs_input that never finished (Esc on an approval, then /clear).
      this.ownerSessionId =
        this.resolvedState === "working" ? (this.ownerSessionId ?? sessionId) : sessionId;
    }

    if (state === "attention") {
      this.setState("idle", attentionReason === "quota" ? "quota" : "needs_input");
      return;
    }

    // A later idle report (the prompt, or a Stop hook) must not turn a quota
    // banner into a finished turn. The next real turn clears it by going working.
    if (state === "idle" && this.attentionReason === "quota") {
      return;
    }

    if (state === "idle" && this.resolvedState === "working") {
      this.setState("idle", "finished");
      return;
    }

    if (state === "idle" && this.attentionReason === "finished") {
      return;
    }

    this.setState(state, null);
  }

  clear(): void {
    this.setState(null, null);
  }

  clearAttention(): boolean {
    if (!this.attentionReason) {
      return false;
    }
    this.setState("idle", null);
    return true;
  }

  interrupt(): void {
    if (this.resolvedState !== "working") {
      return;
    }
    this.setState(null, null);
  }

  private setState(
    state: TerminalActivityState | null,
    attentionReason: TerminalActivityAttentionReason | null,
  ): void {
    if (state === null || attentionReason === "finished" || attentionReason === "quota") {
      this.ownerSessionId = null;
    }
    if (state === this.resolvedState && attentionReason === this.attentionReason) {
      return;
    }

    const previous = this.getSnapshot();
    this.resolvedState = state;
    this.attentionReason = attentionReason;
    this.changedAt = Date.now();

    const snapshot = this.getSnapshot();
    for (const listener of Array.from(this.changeListeners)) {
      listener(snapshot, previous);
    }
  }

  onChange(
    listener: (snapshot: TerminalActivitySnapshot, previous: TerminalActivitySnapshot) => void,
  ): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  getSnapshot(): TerminalActivitySnapshot {
    return {
      state: this.resolvedState,
      attentionReason: this.attentionReason,
      changedAt: this.changedAt,
    };
  }

  dispose(): void {
    this.changeListeners.clear();
  }
}
