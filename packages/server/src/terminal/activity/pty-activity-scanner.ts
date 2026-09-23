import stripAnsi from "strip-ansi";
import type {
  TerminalActivityAttentionReason,
  TerminalActivityState,
} from "@getpaseo/protocol/terminal-activity";

interface ObservedTerminalActivity {
  state: TerminalActivityState | null;
  attentionReason: TerminalActivityAttentionReason | null;
}

export interface PtyActivityScannerOptions {
  setActivity: (
    state: TerminalActivityState,
    attentionReason?: TerminalActivityAttentionReason,
  ) => void;
  clearActivity: () => void;
  getActivity: () => ObservedTerminalActivity;
  readLastLines: (limit: number) => string[];
  readCursorLine: () => string;
  stillnessMs?: number;
}

export const KNOWN_AGENT_NAMES = [
  "claude",
  "codex",
  "grok",
  "antigravity",
  "opencode",
  "pi",
  "copilot",
  "cursor",
  "gemini",
  "amp",
] as const;

export type KnownAgentName = (typeof KNOWN_AGENT_NAMES)[number];

const TYPOGRAPHIC_APOSTROPHE = /[\u2018\u2019\u201a\u201b\u2032\u02bc]/g;

// Phrases the CLIs print when the account itself cannot continue. Kept specific
// so a source file that merely mentions "spend limit" does not light the pane.
const SPEND_LIMIT_NOTICE =
  /you(?:'ve| have) hit your (?:(?:monthly|weekly|daily|session) )?(?:spend |usage )?limit\b|spend limit (?:has been )?reached|usage limit (?:has been )?reached|\bout of (?:credits|quota|extra usage)\b|\b(?:quota|rate limit) (?:exceeded|exhausted|reached)\b|\binsufficient quota\b|\bcredit balance is too low\b|\bexhausted your (?:capacity|quota|credits)\b|\bsubscription limit\b/;

export function isSpendLimitScreen(lines: string[]): boolean {
  if (lines.length === 0) return false;
  const tail = stripAnsi(lines.join("\n")).toLowerCase().replace(TYPOGRAPHIC_APOSTROPHE, "'");
  return SPEND_LIMIT_NOTICE.test(tail);
}

const HORIZONTAL_RULE = /^[─━═]{3,}/;

// Claude's input box is a `❯ text` composer directly under a rule, with its status line
// below. None of it is a prompt from the agent: words typed into the composer
// ("confirm", "allow") and footer `?`s (git counts, tips) must not read as one.
function dropComposerBlock(lines: string[]): string[] {
  for (let index = lines.length - 1; index > 0; index -= 1) {
    if (/^[>❯]/.test(lines[index].trim()) && HORIZONTAL_RULE.test(lines[index - 1].trim())) {
      return lines.slice(0, index - 1);
    }
  }
  return lines;
}

export function isNeedsInputScreen(lines: string[]): boolean {
  if (lines.length === 0) return false;
  const tailStart = Math.max(0, lines.length - 10);
  const tailLines = dropComposerBlock(lines.map(stripAnsi)).slice(tailStart);
  const tailText = tailLines.join("\n");
  const lowerTail = tailText.toLowerCase();

  if (/[[(][yY]\/[nN][\])]/.test(tailText) || /\[(yes|no)\/(yes|no)\]/i.test(tailText)) {
    return true;
  }

  if (
    /\b(allow|approve|approval|permission|confirm)\b/.test(lowerTail) &&
    (lowerTail.includes("?") ||
      /\b(run|execute|access|proceed|continue|overwrite)\b/.test(lowerTail))
  ) {
    return true;
  }

  if (
    /enter to accept[ ·•]+esc to cancel/i.test(lowerTail) ||
    /enter to confirm/i.test(lowerTail)
  ) {
    return true;
  }

  if (tailLines.some((line) => /^\?\s+\S+/.test(line.trim()))) {
    return true;
  }

  const hasSelectedOption = tailLines.some((line) => /^[>❯]\s+\S+/.test(line.trim()));
  const hasSelectionContext =
    lowerTail.includes("?") ||
    /(?:↑\/↓|up\/down).*\b(?:navigate|select)\b/.test(lowerTail) ||
    /\benter\b.*\b(?:confirm|select|accept)\b/.test(lowerTail);
  if (hasSelectedOption && hasSelectionContext) {
    return true;
  }

  return false;
}

const IDLE_PROMPT_PATTERNS = {
  claude: [/^❯$/],
  codex: [/^(?:codex\s*)?›$/i],
  grok: [/^(?:grok\s*)?>$/i],
  antigravity: [/^>$/],
  opencode: [/^[>❯]$/],
  pi: [/^>$/],
  copilot: [/^>$/],
  cursor: [],
  gemini: [/^>$/],
  amp: [/^>$/],
} satisfies Record<KnownAgentName, readonly RegExp[]>;

export function isIdlePromptLine(line: string, agent: KnownAgentName): boolean {
  const patterns = IDLE_PROMPT_PATTERNS[agent];
  const normalized = stripAnsi(line).trim();
  return patterns.some((pattern) => pattern.test(normalized));
}

const ANTIGRAVITY_RUNNING_STATUS = /\[\d{1,2}:\d{2}:\d{2}\].*\brunning$/i;
const ANTIGRAVITY_OPEN_TASKS = /\b[1-9]\d*\s+task\(s\)\b/i;

// The agy composer stays on `>` while a command is still running. That prompt is only
// idle once the status line and the open-task count are gone.
export function isAntigravityBusyScreen(lines: string[]): boolean {
  const tail = lines.slice(-20).map((line) => stripAnsi(line).trim());
  return tail.some(
    (line) => ANTIGRAVITY_RUNNING_STATUS.test(line) || ANTIGRAVITY_OPEN_TASKS.test(line),
  );
}

export function isIdleAgentScreen(
  lines: string[],
  cursorLine: string,
  agent: KnownAgentName,
): boolean {
  if (agent === "antigravity") {
    if (isAntigravityBusyScreen(lines)) {
      return false;
    }
    return isIdlePromptLine(cursorLine, agent);
  }
  if (agent !== "cursor") {
    return isIdlePromptLine(cursorLine, agent);
  }
  if (isNeedsInputScreen(lines)) {
    return false;
  }
  const composerLines = lines
    .slice(-15)
    .map((line) => stripAnsi(line).trim())
    .filter((line) => line.startsWith("→"));
  return composerLines.at(-1) === "→ Plan, search, build anything";
}

interface AgentExecutable {
  agent: KnownAgentName;
  names: readonly string[];
}

const AGENT_EXECUTABLES: readonly AgentExecutable[] = [
  { agent: "claude", names: ["claude", "claude-code", "@anthropic-ai/claude-code"] },
  { agent: "codex", names: ["codex"] },
  { agent: "grok", names: ["grok"] },
  { agent: "antigravity", names: ["agy", "antigravity"] },
  { agent: "opencode", names: ["opencode"] },
  { agent: "pi", names: ["pi"] },
  { agent: "copilot", names: ["copilot"] },
  { agent: "cursor", names: ["cursor", "cursor-agent"] },
  { agent: "gemini", names: ["gemini"] },
  { agent: "amp", names: ["amp"] },
];

const AGENT_DISPLAY_TITLES: readonly { agent: KnownAgentName; pattern: RegExp }[] = [
  { agent: "claude", pattern: /^(?:✳\s*)?claude code(?:\s|$)/i },
  { agent: "codex", pattern: /^(?:openai\s+)?codex(?:\s|$)/i },
  { agent: "grok", pattern: /^grok build(?:\s|$)/i },
  { agent: "antigravity", pattern: /^(?:google\s+)?antigravity(?:\s|$)/i },
  { agent: "opencode", pattern: /^opencode(?:\s|$)/i },
  { agent: "cursor", pattern: /^cursor agent(?:\s|$)/i },
];

function executableBasename(token: string): string {
  const unquoted = token.replace(/^["']|["']$/g, "");
  return unquoted.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
}

function nextNonOption(tokens: string[], start: number): string {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("-")) {
      return token;
    }
  }
  return "";
}

function extractCommandExecutable(command: string): string {
  const tokens = command.trim().split(/\s+/);
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
    index += 1;
  }

  let executable = executableBasename(tokens[index] ?? "");
  if (executable === "env") {
    const nested = nextNonOption(tokens, index + 1);
    index = tokens.indexOf(nested, index + 1);
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
      index += 1;
    }
    executable = executableBasename(tokens[index] ?? "");
  }

  if (executable === "npx" || executable === "bunx") {
    return executableBasename(nextNonOption(tokens, index + 1));
  }
  if (executable === "pnpm" || executable === "yarn" || executable === "npm") {
    const subcommand = executableBasename(nextNonOption(tokens, index + 1));
    if (subcommand === "dlx" || subcommand === "exec") {
      const subcommandIndex = tokens.findIndex(
        (token, tokenIndex) => tokenIndex > index && executableBasename(token) === subcommand,
      );
      return executableBasename(nextNonOption(tokens, subcommandIndex + 1));
    }
  }

  return executable;
}

function detectAgentDisplayTitle(normalized: string): KnownAgentName | null {
  if (!normalized) return null;

  for (const displayTitle of AGENT_DISPLAY_TITLES) {
    if (displayTitle.pattern.test(normalized)) {
      return displayTitle.agent;
    }
  }
  return null;
}

const LAUNCH_TURN_FLAGS = /^(?:-p|--print|--prompt|--message)(?:=|$)/;
const UNRESOLVED_WORKING_STILLNESS_LIMIT = 3;

function commandStartsTurn(command: string): boolean {
  const agent = detectAgentFromCommand(command);
  if (!agent) return false;

  const tokens = stripAnsi(command).trim().split(/\s+/);
  if (tokens.some((token) => LAUNCH_TURN_FLAGS.test(token))) {
    return true;
  }
  return agent === "codex" && tokens.includes("exec");
}

export function detectAgentFromCommand(command: string | undefined): KnownAgentName | null {
  if (!command) return null;
  const normalized = stripAnsi(command).trim();
  if (!normalized) return null;
  if (/^gh\s+copilot(?:\s|$)/i.test(normalized)) {
    return "copilot";
  }

  const executable = extractCommandExecutable(normalized);
  for (const entry of AGENT_EXECUTABLES) {
    if (entry.names.includes(executable)) {
      return entry.agent;
    }
  }
  return null;
}

export function detectAgentFromTitle(title: string | undefined): KnownAgentName | null {
  if (!title) return null;
  return detectAgentDisplayTitle(stripAnsi(title).trim());
}

function isShellOwnedTitle(title: string | undefined): boolean {
  if (!title) return false;
  const normalized = stripAnsi(title).trim();
  return (
    /^(?:~(?:[\\/]|$)|\/|[A-Za-z]:[\\/])/.test(normalized) ||
    /^(?:bash|zsh|fish|sh|cmd|powershell|pwsh)(?:\s|$)/i.test(normalized) ||
    /^[^\s@]+@[^\s:]+:\s*(?:~|\/|[A-Za-z]:[\\/])/.test(normalized)
  );
}

export function detectAgentFromOutput(chunk: string): KnownAgentName | null {
  if (!chunk) return null;
  const stripped = stripAnsi(chunk);

  if (/\bclaude code\s+v?\d/i.test(stripped) || /✳\s*claude\b/i.test(stripped)) return "claude";
  if (/\bopenai codex\b/i.test(stripped) || /\bcodex\s+v\d/i.test(stripped)) return "codex";
  if (/\bwelcome to grok build\b/i.test(stripped)) return "grok";
  if (/welcome to the antigravity cli/i.test(stripped) || /google antigravity/i.test(stripped)) {
    return "antigravity";
  }
  if (/\bopencode\s+v\d/i.test(stripped)) return "opencode";
  if (/\bcursor agent\s+v\d{4}\./i.test(stripped.replace(/\r?\n/g, " "))) return "cursor";

  return null;
}

const BRAILLE_SPINNER_REGEX = /[\u2800-\u28FF]/;
// Claude Code titles the tab "◐ …"/"◑ …" only while a turn runs, and "✳ …" when idle or a
// dialog waits. Its spinner is not braille and it repaints too often for a stillness check,
// so this title is the one output signal that a turn resumed after a needs-input stop, such
// as a numbered permission menu answered with "1" and no Enter.
const CLAUDE_BUSY_TITLE_REGEX = /\][02];[\u25D0\u25D1] /;

export class PtyActivityScanner {
  private activeAgent: KnownAgentName | null = null;
  private currentActivity: TerminalActivityState | null = null;
  private initialLaunch = false;
  private expectsCommandTitle = false;
  private unresolvedWorkingStillness = 0;
  private stillnessTimer: NodeJS.Timeout | null = null;
  private lastOutputAt = 0;
  private readonly options: PtyActivityScannerOptions;
  private readonly stillnessMs: number;

  constructor(options: PtyActivityScannerOptions) {
    this.options = options;
    this.stillnessMs = options.stillnessMs ?? 1200;
  }

  handleInitialCommand(command: string | undefined): void {
    if (!command) return;
    const detected = detectAgentFromCommand(command);
    if (!detected) return;
    this.activeAgent = detected;
    if (commandStartsTurn(command)) {
      this.initialLaunch = false;
      this.setWorking();
      return;
    }
    this.initialLaunch = true;
  }

  handleCommandStarted(): void {
    if (!this.activeAgent) {
      this.expectsCommandTitle = true;
    }
  }

  handleTitleChange(title: string | undefined): void {
    const isCommandTitle = this.expectsCommandTitle;
    this.expectsCommandTitle = false;
    if (this.activeAgent && !isCommandTitle && isShellOwnedTitle(title)) {
      this.handleCommandFinished();
      return;
    }

    const detected = isCommandTitle
      ? (detectAgentFromCommand(title) ?? detectAgentFromTitle(title))
      : detectAgentFromTitle(title);
    if (detected && !this.activeAgent) {
      this.activeAgent = detected;
      this.initialLaunch = true;
    }
  }

  handleCommandFinished(): void {
    this.clearStillnessTimer();
    this.activeAgent = null;
    this.currentActivity = null;
    this.initialLaunch = false;
    this.expectsCommandTitle = false;
    this.unresolvedWorkingStillness = 0;
    this.lastOutputAt = 0;
    this.options.clearActivity();
  }

  feedInput(input: string): void {
    if (!this.activeAgent) return;

    if (input === "\r" || input === "\n") {
      this.initialLaunch = false;
      this.setWorking();
    }
  }

  handleInterrupt(): void {
    this.clearStillnessTimer();
    this.currentActivity = null;
    this.unresolvedWorkingStillness = 0;
  }

  feedOutput(chunk: string): void {
    if (!this.activeAgent) {
      const detected = detectAgentFromOutput(chunk);
      if (detected) {
        this.activeAgent = detected;
        this.initialLaunch = true;
      } else {
        return;
      }
    }

    this.unresolvedWorkingStillness = 0;

    if (
      !this.initialLaunch &&
      this.currentActivity !== "working" &&
      ((this.activeAgent === "claude" && CLAUDE_BUSY_TITLE_REGEX.test(chunk)) ||
        (BRAILLE_SPINNER_REGEX.test(chunk) && !this.options.getActivity().attentionReason))
    ) {
      this.setWorking();
    }

    this.scheduleStillnessCheck();
  }

  private setWorking(): void {
    if (this.currentActivity === "working") return;
    this.currentActivity = "working";
    this.unresolvedWorkingStillness = 0;
    this.options.setActivity("working");
    this.scheduleStillnessCheck();
  }

  private scheduleStillnessCheck(): void {
    this.lastOutputAt = Date.now();
    if (this.stillnessTimer) {
      return;
    }
    this.stillnessTimer = setTimeout(() => {
      this.checkStillness();
    }, this.stillnessMs);
  }

  private checkStillness(): void {
    const remainingMs = this.stillnessMs - (Date.now() - this.lastOutputAt);
    if (remainingMs > 0) {
      this.stillnessTimer = setTimeout(() => {
        this.checkStillness();
      }, remainingMs);
      return;
    }
    this.stillnessTimer = null;
    this.onStillness();
  }

  private clearStillnessTimer(): void {
    if (this.stillnessTimer) {
      clearTimeout(this.stillnessTimer);
      this.stillnessTimer = null;
    }
    this.lastOutputAt = 0;
  }

  private onStillness(): void {
    if (!this.activeAgent) return;

    const lines = this.options.readLastLines(15);

    if (
      this.activeAgent === "antigravity" &&
      isAntigravityBusyScreen(lines) &&
      !isSpendLimitScreen(lines)
    ) {
      this.unresolvedWorkingStillness = 0;
      if (this.currentActivity !== "working") {
        this.currentActivity = "working";
        this.options.setActivity("working");
      }
      this.scheduleStillnessCheck();
      return;
    }

    if (isSpendLimitScreen(lines)) {
      this.currentActivity = "attention";
      this.unresolvedWorkingStillness = 0;
      this.options.setActivity("attention", "quota");
      return;
    }

    if (isIdleAgentScreen(lines, this.options.readCursorLine(), this.activeAgent)) {
      this.unresolvedWorkingStillness = 0;
      if (this.initialLaunch) {
        this.initialLaunch = false;
        this.currentActivity = "idle";
        if (this.options.getActivity().state === null) {
          this.options.clearActivity();
        }
      } else if (this.currentActivity === "working") {
        this.currentActivity = "idle";
        this.options.setActivity("idle");
      } else if (this.currentActivity === "attention") {
        this.currentActivity = "idle";
        this.options.setActivity("idle");
      }
      return;
    }

    if (isNeedsInputScreen(lines)) {
      this.currentActivity = "attention";
      this.unresolvedWorkingStillness = 0;
      this.options.setActivity("attention");
      return;
    }

    if (this.currentActivity !== "working") {
      return;
    }

    this.unresolvedWorkingStillness += 1;
    if (this.unresolvedWorkingStillness < UNRESOLVED_WORKING_STILLNESS_LIMIT) {
      this.scheduleStillnessCheck();
      return;
    }

    this.currentActivity = null;
    this.unresolvedWorkingStillness = 0;
    this.options.clearActivity();
  }

  dispose(): void {
    this.clearStillnessTimer();
    this.activeAgent = null;
    this.currentActivity = null;
    this.expectsCommandTitle = false;
  }
}
