import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ProviderCatalog,
  ProviderConfigChanges,
  ProviderEvent,
  ProviderPersistence,
  ProviderPrompt,
  ProviderSessionConfig,
  ProviderLaunch,
  ProviderTimelineItem,
  ProviderUsage,
} from "@getpaseo/plugin/server/provider";
import { startDriver, selection, type Driver } from "./process.js";
import { nativeModel, validateSelection } from "./catalog.js";
import { PromptFiles } from "./prompt.js";
import { toolItem } from "./timeline.js";
import { readTranscriptItems } from "./transcript.js";
import { AntigravityError, diagnostic, type Frame, type Step } from "./wire.js";

const persistenceSchema = z
  .object({ version: z.literal(1), data: z.object({ conversationId: z.string().min(1) }).strict() })
  .strict();
interface SteeredPrompt {
  clientMessageId: string;
  text: string;
  nativeText: string;
}
interface Turn {
  id: string;
  leg: number;
  text: Map<string, string>;
  usageSteps: Set<string>;
  tools: Map<string, Extract<ProviderTimelineItem, { type: "tool_call" }>>;
  usage: Required<Pick<ProviderUsage, "inputTokens" | "outputTokens" | "cachedInputTokens">>;
  pendingSteers: SteeredPrompt[];
  switching: boolean;
}
type State =
  | { type: "dormant" }
  | { type: "starting"; driver: Driver }
  | { type: "idle"; driver: Driver }
  | { type: "running"; driver: Driver; turn: Turn }
  | { type: "stopping"; driver: Driver }
  | { type: "closed" };
interface SessionOptions {
  id: string;
  config: ProviderSessionConfig;
  launch: ProviderLaunch;
  catalog(): ProviderCatalog;
  persistence?: ProviderPersistence;
  history?: "replay" | "skip";
  emit(event: ProviderEvent): void;
}

export class Session {
  private state: State = { type: "dormant" };
  private config: ProviderSessionConfig;
  private conversationId: string | null;
  private firstMessage: boolean;
  private readonly promptFiles = new PromptFiles();
  private readonly reportedDenials = new Map<string, number>();

  constructor(private readonly options: SessionOptions) {
    const catalog = options.catalog();
    const initialConfig = { ...options.config, mode: options.config.mode ?? "full-access" };
    this.config = options.persistence
      ? normalizeResumedConfig(initialConfig, catalog)
      : initialConfig;
    this.conversationId = options.persistence
      ? persistenceSchema.parse(options.persistence).data.conversationId
      : null;
    this.firstMessage = this.conversationId === null;
    validateSelection(this.config, catalog);
  }

  async open(requestId: string, capabilities: readonly string[]): Promise<void> {
    if (this.config.persist && this.conversationId === null) await this.ensureDriver();
    this.emit({
      type: "session.opened",
      requestId,
      sessionId: this.options.id,
      capabilities,
      restoration: "core",
      persistence: this.config.persist ? this.persistence() : undefined,
      cwd: this.config.cwd,
      title: this.config.title,
    });
    if (
      this.options.persistence &&
      this.conversationId !== null &&
      this.options.history !== "skip"
    ) {
      const history = await readTranscriptItems(
        this.conversationId,
        this.config,
        this.options.launch,
      );
      for (const entry of history) {
        this.item(entry.item, entry.timestamp);
      }
    }
    this.publishFullAccessNotice();
    this.publishConfig();
    this.emit({ type: "session.commands", sessionId: this.options.id, commands: [] });
    this.emit({ type: "session.ready", requestId, sessionId: this.options.id });
  }

  async prompt(prompt: ProviderPrompt): Promise<void> {
    if (prompt.delivery === "steer") {
      if (this.state.type !== "running")
        throw new AntigravityError("Antigravity has no active turn to steer", "TURN_INACTIVE");
      const { text, nativeText } = await this.promptFiles.encode(prompt);
      if (this.state.type !== "running")
        throw new AntigravityError("Antigravity has no active turn to steer", "TURN_INACTIVE");
      const { turn } = this.state;
      turn.pendingSteers.push({
        clientMessageId: prompt.clientMessageId,
        text,
        nativeText,
      });
      this.emit({
        type: "session.prompt_result",
        sessionId: this.options.id,
        clientMessageId: prompt.clientMessageId,
        result: { type: "steer", turnId: turn.id },
      });
      this.item({
        type: "user_message",
        id: prompt.clientMessageId,
        clientMessageId: prompt.clientMessageId,
        text,
      });
      if (!turn.switching && !this.hasRunningTools(turn)) {
        void this.flushSteer(turn);
      }
      return;
    }
    if (this.state.type === "running")
      throw new AntigravityError(
        "Antigravity already has an active turn; wait for it to finish",
        "TURN_ACTIVE",
      );
    const { text, nativeText } = await this.promptFiles.encode(prompt);
    await this.ensureDriver();
    if (this.state.type !== "idle") throw new AntigravityError("Antigravity session is not ready");
    const driver = this.state.driver;
    const turn: Turn = {
      id: randomUUID(),
      leg: 0,
      text: new Map(),
      usageSteps: new Set(),
      tools: new Map(),
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      pendingSteers: [],
      switching: false,
    };
    this.state = { type: "running", driver, turn };
    this.emit({
      type: "session.prompt_result",
      sessionId: this.options.id,
      clientMessageId: prompt.clientMessageId,
      result: { type: "turn", turnId: turn.id },
    });
    this.emit({
      type: "session.turn",
      sessionId: this.options.id,
      turnId: turn.id,
      state: "started",
    });
    this.item({
      type: "user_message",
      id: prompt.clientMessageId,
      clientMessageId: prompt.clientMessageId,
      text,
    });
    const driverText =
      this.firstMessage && this.config.systemPrompt
        ? `${this.config.systemPrompt}\n\n${nativeText}`
        : nativeText;
    try {
      await driver.prompt(driverText);
      this.firstMessage = false;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.failTurn(new AntigravityError(error.message), driver);
      await driver.stop("interrupt");
    }
  }

  configure(changes: ProviderConfigChanges): void {
    const catalog = this.options.catalog();
    const config = {
      ...this.config,
      model: changes.model === null ? undefined : (changes.model ?? this.config.model),
      mode: changes.mode === null ? "full-access" : (changes.mode ?? this.config.mode),
      thinkingOption:
        changes.thinkingOption === null
          ? undefined
          : (changes.thinkingOption ?? this.config.thinkingOption),
    };
    if (changes.model !== undefined && changes.thinkingOption === undefined) {
      const model = catalog.models.find((entry) => entry.id === config.model);
      const supportsEffort = model?.thinkingOptions?.some(
        (option) => option.id === config.thinkingOption,
      );
      if (!supportsEffort) config.thinkingOption = undefined;
    }
    if (changes.settings && Object.keys(changes.settings).length > 0)
      throw new AntigravityError("Antigravity has no configurable settings");
    validateSelection(config, catalog);
    this.config = config;
    this.publishConfig();
  }

  async interrupt(): Promise<void> {
    if (this.state.type !== "running") return;
    const { driver, turn } = this.state;
    turn.pendingSteers.length = 0;
    this.state = { type: "stopping", driver };
    await driver.stop("interrupt");
    this.finishTools(turn, "canceled");
    this.emit({
      type: "session.turn",
      sessionId: this.options.id,
      turnId: turn.id,
      state: "canceled",
    });
    this.state = { type: "dormant" };
  }

  async close(): Promise<void> {
    const state = this.state;
    this.state = { type: "closed" };
    try {
      if (state.type !== "dormant" && state.type !== "closed") await state.driver.stop("close");
    } finally {
      await this.promptFiles.close();
    }
    if (state.type === "running") {
      state.turn.pendingSteers.length = 0;
      this.finishTools(state.turn, "canceled");
      this.emit({
        type: "session.turn",
        sessionId: this.options.id,
        turnId: state.turn.id,
        state: "canceled",
      });
    }
  }

  private publishFullAccessNotice(): void {
    this.emit({
      type: "session.notice",
      sessionId: this.options.id,
      notice: {
        id: `${this.options.id}:full-access`,
        severity: "warning",
        title: "Antigravity is running with full access",
        description:
          "Antigravity's CLI cannot ask for permission when another app drives it, so Paseo starts it with --dangerously-skip-permissions. Every tool call, including shell commands, runs without asking.",
      },
    });
  }

  private async ensureDriver(): Promise<void> {
    if (this.state.type === "closed") throw new AntigravityError("Antigravity session is closed");
    if (this.state.type === "stopping") {
      await this.state.driver.stop("interrupt");
      this.state = { type: "dormant" };
    }
    if (this.state.type === "idle" && this.state.driver.selection !== selection(this.config)) {
      const driver = this.state.driver;
      this.state = { type: "stopping", driver };
      await driver.stop("close");
      this.state = { type: "dormant" };
    }
    if (this.state.type !== "dormant") return;
    try {
      const driver = await this.spawnReadyDriver((next) => {
        this.state = { type: "starting", driver: next };
      });
      this.state = { type: "idle", driver };
    } catch (error) {
      this.state = { type: "dormant" };
      throw error;
    }
  }

  private async spawnReadyDriver(onSpawn: (driver: Driver) => void): Promise<Driver> {
    this.reportedDenials.clear();
    const driver: Driver = startDriver({
      launch: this.options.launch,
      config: this.config,
      model: nativeModel(this.config, this.options.catalog()),
      conversationId: this.conversationId,
      onFrame: (frame) => this.accept(frame, driver),
      onExit: (error) => this.failTurn(error, driver),
    });
    onSpawn(driver);
    try {
      const init = await driver.ready;
      if (this.conversationId !== null && init.conversation_id !== this.conversationId)
        throw new AntigravityError(
          "Antigravity restored a different conversation",
          "INVALID_RESUME",
        );
      this.conversationId = init.conversation_id;
      const native = this.options.catalog().models.find((model) => model.id === init.init.model);
      if (!this.config.model && native) {
        this.config = { ...this.config, model: native.id };
        driver.selection = selection(this.config);
        this.publishConfig();
      }
      if (this.config.persist)
        this.emit({
          type: "session.persistence",
          sessionId: this.options.id,
          persistence: this.persistence(),
        });
      return driver;
    } catch (error) {
      await driver.stop("interrupt");
      throw error;
    }
  }

  private canSteerTurn(turn: Turn): boolean {
    return (
      this.state.type === "running" &&
      this.state.turn === turn &&
      turn.pendingSteers.length > 0 &&
      !this.hasRunningTools(turn)
    );
  }

  private isRunningTurn(turn: Turn): boolean {
    return this.state.type === "running" && this.state.turn === turn;
  }

  private withSystemPrompt(nativeText: string): string {
    return this.firstMessage && this.config.systemPrompt
      ? `${this.config.systemPrompt}\n\n${nativeText}`
      : nativeText;
  }

  private async flushSteer(turn: Turn): Promise<void> {
    if (turn.switching || !this.canSteerTurn(turn)) return;
    turn.switching = true;
    try {
      while (this.canSteerTurn(turn) && this.state.type === "running") {
        await this.state.driver.stop("interrupt");
        if (!this.isRunningTurn(turn)) return;
        const driver = await this.spawnReadyDriver((next) => {
          if (this.isRunningTurn(turn)) this.state = { type: "running", driver: next, turn };
        });
        if (!this.isRunningTurn(turn)) {
          await driver.stop("interrupt");
          return;
        }
        const nativeText = turn.pendingSteers
          .splice(0)
          .map((entry) => entry.nativeText)
          .join("\n\n");
        turn.leg += 1;
        turn.switching = false;
        await driver.prompt(this.withSystemPrompt(nativeText));
        this.firstMessage = false;
        if (this.canSteerTurn(turn)) turn.switching = true;
      }
    } catch (error) {
      if (!this.isRunningTurn(turn) || this.state.type !== "running") return;
      turn.switching = false;
      this.failTurn(toAntigravityError(error), this.state.driver);
    }
  }

  private hasRunningTools(turn: Turn): boolean {
    for (const item of turn.tools.values()) {
      if (item.status === "running") return true;
    }
    return false;
  }

  private accept(frame: Frame, sourceDriver: Driver): void {
    if (
      this.state.type !== "running" ||
      this.state.driver !== sourceDriver ||
      this.state.turn.switching
    )
      return;
    const { turn, driver } = this.state;
    if (frame.event === "step_update") {
      this.acceptStep(frame.step_update, turn);
      return;
    }
    if (frame.event !== "result") return;
    const result = frame.result;
    const denied = takeNewDenials(result.denied_actions, this.reportedDenials);
    if (denied.length > 0) {
      this.emit({
        type: "session.notice",
        sessionId: this.options.id,
        notice: {
          id: `${turn.id}:denied`,
          severity: "warning",
          title: denialNoticeTitle(denied),
          description: "Antigravity's own policy denied it.",
        },
      });
    }
    if (result.status === "ERROR") {
      const canceled = result.error === "interrupted";
      this.finishTools(turn, canceled ? "canceled" : "failed");
      this.retire(driver);
      this.emit({
        type: "session.turn",
        sessionId: this.options.id,
        turnId: turn.id,
        state: canceled ? "canceled" : "failed",
        error: { message: diagnostic(result.error) },
      });
    } else {
      this.finishTools(turn, "completed");
      if (turn.pendingSteers.length > 0) {
        void this.flushSteer(turn);
        return;
      }
      this.state = { type: "idle", driver };
      this.emit({
        type: "session.turn",
        sessionId: this.options.id,
        turnId: turn.id,
        state: "completed",
      });
    }
  }

  private acceptStep(step: Step, turn: Turn): void {
    const stepKey = `${turn.leg}:${step.step_index}`;
    const id =
      turn.leg === 0
        ? `${turn.id}:${step.step_index}`
        : `${turn.id}:${turn.leg}:${step.step_index}`;
    if (step.step_type === "agent_response") {
      const previous = turn.text.get(stepKey) || "";
      const text = previous + step.text_delta;
      turn.text.set(stepKey, text);
      if (step.text_delta) this.item({ type: "assistant_message", id, messageId: id, text });
      if (step.state === "DONE" && step.usage && !turn.usageSteps.has(stepKey)) {
        turn.usageSteps.add(stepKey);
        turn.usage.inputTokens += step.usage.input_tokens;
        turn.usage.outputTokens += step.usage.output_tokens;
        turn.usage.cachedInputTokens += step.usage.cache_read_tokens;
        this.emit({
          type: "session.usage",
          sessionId: this.options.id,
          turnId: turn.id,
          usage: { ...turn.usage },
        });
      }
    } else if (step.step_type === "tool" || step.step_type === "subagent") {
      const item = toolItem(step, id);
      turn.tools.set(id, item);
      this.item(item);
      if (turn.pendingSteers.length > 0 && !turn.switching && !this.hasRunningTools(turn)) {
        void this.flushSteer(turn);
      }
    }
  }

  private failTurn(error: AntigravityError, sourceDriver?: Driver): void {
    const state = this.state;
    if (state.type !== "running" && state.type !== "idle") return;
    if (sourceDriver && state.driver !== sourceDriver) return;
    this.retire(state.driver);
    if (state.type === "running") {
      state.turn.pendingSteers.length = 0;
      this.finishTools(state.turn, "failed");
      this.emit({
        type: "session.turn",
        sessionId: this.options.id,
        turnId: state.turn.id,
        state: "failed",
        error: { message: error.message, code: error.code },
      });
    } else
      this.emit({
        type: "session.runtime_failed",
        sessionId: this.options.id,
        error: { message: error.message, code: error.code },
      });
  }

  private retire(driver: Driver): void {
    this.state = { type: "stopping", driver };
    void driver.stop("interrupt").then(() => {
      if (this.state.type === "stopping" && this.state.driver === driver)
        this.state = { type: "dormant" };
      return undefined;
    });
  }

  private finishTools(turn: Turn, status: "completed" | "failed" | "canceled"): void {
    for (const [id, item] of turn.tools.entries()) {
      if (item.status !== "running") continue;
      const updated =
        status === "failed"
          ? { ...item, status, error: "Antigravity turn failed" }
          : { ...item, status, error: null };
      turn.tools.set(id, updated);
      this.item(updated);
    }
  }

  private persistence(): ProviderPersistence {
    if (this.conversationId === null) throw new AntigravityError("Antigravity has no conversation");
    return { version: 1, data: { conversationId: this.conversationId } };
  }

  private publishConfig(): void {
    const catalog = this.options.catalog();
    const model = catalog.models.find((entry) => entry.id === this.config.model);
    this.emit({
      type: "session.config",
      sessionId: this.options.id,
      config: {
        model: this.config.model,
        mode: this.config.mode || "full-access",
        thinkingOption: this.config.thinkingOption ?? model?.defaultThinkingOptionId,
        models: catalog.models,
        modes: catalog.modes,
        thinkingOptions: model?.thinkingOptions ?? [],
        settings: [],
      },
    });
  }
  private item(item: ProviderTimelineItem, timestamp?: string): void {
    this.emit({
      type: "timeline.item",
      sessionId: this.options.id,
      item,
      ...(timestamp ? { timestamp } : {}),
    });
  }
  private emit(event: ProviderEvent): void {
    this.options.emit(event);
  }
}

// Native results contain every denial since this driver started, including repeated actions.
function takeNewDenials(
  actions: Extract<Frame, { event: "result" }>["result"]["denied_actions"],
  reported: Map<string, number>,
) {
  const counts = new Map<string, number>();
  const fresh = actions.filter((action) => {
    const key = JSON.stringify([action.action, action.display_name]);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count > (reported.get(key) ?? 0);
  });
  for (const [key, count] of counts) reported.set(key, Math.max(count, reported.get(key) ?? 0));
  return fresh;
}

function denialNoticeTitle(
  actions: Extract<Frame, { event: "result" }>["result"]["denied_actions"],
): string {
  if (actions.length > 1) return `${actions.length} actions denied`;
  return actions[0].action === "command" ? "Shell command denied" : "Action denied";
}

function toAntigravityError(error: unknown): AntigravityError {
  if (error instanceof AntigravityError) return error;
  return new AntigravityError(error instanceof Error ? error.message : String(error));
}

function normalizeResumedConfig(
  config: ProviderSessionConfig,
  catalog: ProviderCatalog,
): ProviderSessionConfig {
  const model =
    config.model && catalog.models.some((entry) => entry.id === config.model)
      ? config.model
      : undefined;
  const mode =
    config.mode && catalog.modes.some((entry) => entry.id === config.mode)
      ? config.mode
      : (catalog.defaultMode ?? "full-access");
  const selected = catalog.models.find((entry) => entry.id === model);
  const thinkingOption = selected?.thinkingOptions?.some(
    (option) => option.id === config.thinkingOption,
  )
    ? config.thinkingOption
    : undefined;
  return {
    ...config,
    model,
    mode,
    thinkingOption,
  };
}
