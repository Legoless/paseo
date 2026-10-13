import type { ProviderError, ProviderEvent } from "@getpaseo/plugin/server/provider";
import { MspConnection, type Notification } from "./connection.js";
import { Timeline } from "./timeline.js";
import {
  childSessionSchema,
  pageSchema,
  itemNotificationSchema,
  notificationSchema,
  deltaSchema,
  turnSchema,
  ackSchema,
  gapSchema,
  type WireItem,
} from "./wire.js";

interface Child {
  timeline: Timeline;
  cursor: string | undefined;
  turns: Map<string, "active" | "completed">;
}
export class Children {
  private readonly children = new Map<string, Child>();
  constructor(
    private readonly host: MspConnection,
    private readonly parentId: string,
    private readonly cwd: string,
    private readonly emit: (event: ProviderEvent) => void,
  ) {}

  async update(item: WireItem): Promise<void> {
    if (
      !item.childSessionId ||
      !(
        item.kind === "subagent" ||
        item.kind === "workflow" ||
        item.tool === "workflow" ||
        item.tool.startsWith("subagent_")
      )
    )
      return;
    const id = item.childSessionId;
    if (!this.children.has(id)) {
      const { session, viewCursor } = await this.host.request(
        "session/read",
        { sessionId: id },
        childSessionSchema,
      );
      this.emit({
        type: "session.opened",
        sessionId: id,
        parentSessionId: this.parentId,
        toolCallId: item.callId ?? item.itemId,
        capabilities: [],
        restoration: "parent",
        cwd: session.workspaceRoot ?? this.cwd,
        title: session.title,
      });
      const child: Child = {
        timeline: new Timeline(this.host, id, id, this.emit),
        cursor: undefined,
        turns: new Map(),
      };
      this.children.set(id, child);
      await this.page(id);
      // Reads do not subscribe; replay anything appended between paging and attaching live views.
      await this.host.request(
        "view/subscribe",
        { sessionId: id, after: child.cursor ?? viewCursor },
        ackSchema,
      );
      return;
    }
    await this.page(id);
  }
  async notify(id: string, event: Notification): Promise<void> {
    const child = this.children.get(id);
    if (!child) return;
    if (event.method === "view/gap") {
      child.cursor = gapSchema.parse(event.params).after;
      await this.page(id);
      return;
    }
    const envelope = notificationSchema.parse(event.params);
    if (envelope.viewCursor) child.cursor = envelope.viewCursor;
    if (["item/started", "item/updated", "item/completed"].includes(event.method)) {
      const { item } = itemNotificationSchema.parse(event.params);
      await child.timeline.fold(item);
    } else if (event.method === "item/delta") child.timeline.delta(deltaSchema.parse(event.params));
    else if (event.method === "turn/started") {
      const { turnId } = turnSchema.parse(event.params);
      if (child.turns.has(turnId)) return;
      child.turns.set(turnId, "active");
      this.emit({ type: "session.turn", sessionId: id, turnId, state: "started" });
    } else if (event.method === "turn/completed") {
      const params = turnSchema.parse(event.params);
      if (child.turns.get(params.turnId) === "completed") return;
      child.turns.set(params.turnId, "completed");
      let state: "completed" | "canceled" | "failed" = "completed";
      let error: ProviderError | undefined;
      if (params.terminal === "cancelled") state = "canceled";
      else if (params.error || params.terminal === "failed") {
        state = "failed";
        error = { message: "Muse turn failed" };
        if (params.error) error = { code: params.error.kind, message: params.error.message };
      }
      this.emit({
        type: "session.turn",
        sessionId: id,
        turnId: params.turnId,
        state,
        error,
      });
    }
  }
  async refresh(): Promise<void> {
    for (const id of this.children.keys()) await this.page(id);
  }
  private async page(id: string): Promise<void> {
    const child = this.children.get(id)!;
    let next: string | null;
    do {
      const page = await this.host.request(
        "view/page",
        { sessionId: id, cursor: child.cursor, limit: 1000, direction: "forward" },
        pageSchema,
      );
      for (const event of page.events) await this.notify(id, event);
      next = page.nextCursor;
      if (next !== null) child.cursor = next;
    } while (next !== null);
  }
  close(): void {
    for (const sessionId of this.children.keys()) this.emit({ type: "session.closed", sessionId });
    this.children.clear();
  }
}
