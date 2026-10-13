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
  "kimi",
  "muse",
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
  // Codex keeps its composer (`› ` + placeholder or draft) on the cursor line; `› 1.` is a menu row.
  codex: [/^(?:codex\s*)?›(?:\s+(?!\d+\.\s)\S.*)?$/i],
  // Grok 4.7's composer is `❯`. `>` and `grok>` are the older prompt.
  grok: [/^(?:grok\s*)?[>❯]$/i],
  antigravity: [/^>$/],
  opencode: [/^[>❯]$/],
  pi: [/^>$/],
  copilot: [/^>$/],
  cursor: [],
  gemini: [/^>$/],
  amp: [/^>$/],
  // Kimi's composer is a bordered box, so the cursor line reads `│ > draft`; while a
  // turn runs the cursor leaves the box, which keeps this from lighting mid-turn. The
  // border is required: approval options start with "> " too ("│ >" vs "> Allow once").
  kimi: [/^│\s*>(?:\s|$)/],
  muse: [/^❯(?:\s+.*)?$/],
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

// Codex keeps its composer up while a turn runs, with a status line directly above it:
// "• Working (12s • esc to interrupt)". The header can change and a narrow pane truncates
// the hint, so match either. Only that line counts, so a reply or diff quoting it does not.
const CODEX_RUNNING_STATUS = /\(\d+[hms] [^)]*esc to interrupt\)(?:\s*·.*)?$|^• Working \(\d/;

export function isCodexBusyScreen(lines: string[]): boolean {
  const stripped = lines.map((line) => stripAnsi(line).trim());
  const composer = stripped.findLastIndex((line) => line.startsWith("›"));
  const status = stripped.slice(0, Math.max(composer, 0)).findLast((line) => line.length > 0);
  return status !== undefined && CODEX_RUNNING_STATUS.test(status);
}

// After a turn Claude prints "✻ Baked for 6s · done 12:03 PM" above its composer, and
// appends " · 1 shell still running" (shells, monitors, local agents, …) while background
// work outlives the turn, or shows "✻ Waiting for 1 background agent to finish" instead.
// Only the last line above the composer counts, or the one before a right-aligned notice
// ("✘ Auto-update failed"), so a reply or an older turn line does not.
// ponytail: a pane narrower than the line wraps it and reads as idle; join wrapped rows if that bites.
const CLAUDE_BACKGROUND_STATUS =
  /^✻ (?:.+ · \d+ [^·]+ still running|Waiting for \d+ .+ to finish)$/;

export function isClaudeBusyScreen(lines: string[]): boolean {
  return dropComposerBlock(lines.map((line) => stripAnsi(line).trim()))
    .filter((line) => line.length > 0)
    .slice(-2)
    .some((line) => CLAUDE_BACKGROUND_STATUS.test(line));
}

// Grok prints "Worked for …" when the turn ends and leaves the ❯ composer up.
// Work that is still running is the dock row above that composer. Its mark is
// the four-dot ⸬ (a braille spinner is the other running mark) and the row
// ends with a live elapsed time: `⸬ Run …  1h04m`. A reasoning block that is
// still open is a spinner frame plus `Thinking` or `Thinking…`. That frame
// cycles through `⋅` `:` `⸬` `⁙` and braille, so the mark is whatever single
// glyph is in front of the word. `Thought for` rewrites the header when the
// block ends. A `Thinking` line above that, or above `Worked for`, is an
// older block. A blank line separates the dock row from the composer box.
// The ◎ status line counts too. The window is only the lines near the composer,
// so a braille logo higher in the scrollback does not.
const GROK_RUNNING_MARK = "(?:[\\u2800-\\u28FF]|⸬)";
const GROK_RUNNING_ROW = new RegExp(
  `^${GROK_RUNNING_MARK}.*(?:\\d+h\\d+m(?:\\d+s)?|\\d+m\\d+s|\\d+[hms])$`,
);
const GROK_THINKING_ROW = /^(?:[^\s\w]\s+)?Thinking(?:\.{1,3}|…|⋯)?$/;
const GROK_REASONING_CLOSED = /^(?:[^\s\w]\s+)?(?:Thought for|Worked for)\b/;
const GROK_STILL_RUNNING = /^◎\s+(?:waiting\b|\d+\b.*\bstill running\b)/;
const GROK_DOCK_LINE_LIMIT = 12;

export function isGrokBusyScreen(lines: string[]): boolean {
  const stripped = dropComposerBlock(lines.map((line) => stripAnsi(line).trim()));
  const dock: string[] = [];
  for (
    let index = stripped.length - 1;
    index >= 0 && dock.length < GROK_DOCK_LINE_LIMIT;
    index -= 1
  ) {
    const line = stripped[index];
    if (line.length === 0) continue;
    dock.push(line);
  }
  // `dock` is nearest-to-composer first. `Thought for 12s` can wear the same
  // spinner and end in a duration, and that header is finished. A dock row or
  // ◎ still counts on either side of it; an older Thinking line does not.
  let reasoningClosed = false;
  for (const line of dock) {
    if (GROK_REASONING_CLOSED.test(line)) {
      reasoningClosed = true;
      continue;
    }
    if (GROK_RUNNING_ROW.test(line) || GROK_STILL_RUNNING.test(line)) return true;
    if (reasoningClosed) continue;
    if (GROK_THINKING_ROW.test(line)) return true;
  }
  return false;
}

// Kimi's composer comes back when the turn ends, but work that outlives the turn keeps
// a "[1 task running]" badge in the status bar. The badge shares the row with the
// model/context segments ("K3 thinking: max", "context: 29%"), so require one of them
// on the same line — a reply quoting the badge text does not keep the pane working.
const KIMI_RUNNING_TASKS = /\[\d+ tasks? running\]/;
const KIMI_STATUS_BAR_SEGMENT = /(?:\bthinking:\s*\w+|\bcontext:\s*\d{1,3}%)/;

export function isKimiBusyScreen(lines: string[]): boolean {
  const tail = lines.slice(-6).map((line) => stripAnsi(line).trim());
  return tail.some((line) => KIMI_RUNNING_TASKS.test(line) && KIMI_STATUS_BAR_SEGMENT.test(line));
}

// Muse leaves its composer on the cursor line throughout the turn. Its animated
// diamond status is the last non-empty row above the ruled composer; a completed
// response also starts with a diamond, so require an elapsed time for a filled
// diamond. Narrow panes wrap the row or truncate its interrupt hint.
const MUSE_RUNNING_STATUS =
  /^[◇◈◆]\s+(?:Thinking|Working|Double checking|Finishing up)\s+\(\d+[hms](?:\s*\d+[hms])*(?:\s*[·•]\s*(.*?))?\)?$/i;
const MUSE_STARTING_STATUS = /^[◇◈]\s+(?:Thinking|Working)$/i;
const MUSE_COMPOSER_RULE = /^[─━═]{2,}/;
const MUSE_PROFILE_FOOTER =
  /\s[·•]\s(?:Read only|Ask me|Auto-review|Unrestricted|Launch overrides)$/i;

function museComposerStart(lines: string[]): number {
  for (let index = lines.length - 1; index > 0; index -= 1) {
    if (/^❯(?:\s|$)/.test(lines[index]) && MUSE_COMPOSER_RULE.test(lines[index - 1])) {
      return index - 1;
    }
  }
  return -1;
}

export function isMuseNeedsInputScreen(lines: string[]): boolean {
  const stripped = lines.map((line) => stripAnsi(line).trim());
  const composer = museComposerStart(stripped);
  const dialog = (composer >= 0 ? stripped.slice(0, composer) : stripped).slice(-15);
  const text = dialog.join(" ");
  return (
    dialog.some((line) =>
      /^(?:Structured user input needed|Review answers before submit|Approval request(?:\s[·•]|$)|Change approval defaults in \/permissions)/i.test(
        line,
      ),
    ) ||
    (/Would you like to (?:run the following command|allow this (?:network access|file access|tool action))\?/i.test(
      text,
    ) &&
      /\bAllow (?:once|this stage once|for this session)\b|\bYes, proceed\b|\bAbort\b/i.test(
        text,
      )) ||
    /\bEnter to (?:select|toggle)\b.*\bTab for an optional note\b.*\bEsc to interrupt\b/i.test(
      text,
    ) ||
    (/\bEnter to select\b.*\bEsc to interrupt\b/i.test(text) &&
      /\bQuestion\b|\bAllow once\b|\bAllow for this session\b|\bAlways allow\b/i.test(text)) ||
    (composer < 0 && isNeedsInputScreen(dialog))
  );
}

export function isMuseBusyScreen(lines: string[]): boolean {
  const stripped = lines.map((line) => stripAnsi(line).trim());
  const composer = museComposerStart(stripped);
  if (composer < 0 || isMuseNeedsInputScreen(lines)) return false;
  const statusLines = stripped
    .slice(0, composer)
    .filter((line) => line.length > 0)
    .slice(-3);
  return statusLines.some((_, index) => {
    const status = statusLines.slice(index).join(" ");
    if (MUSE_STARTING_STATUS.test(status)) return true;
    const running = MUSE_RUNNING_STATUS.exec(status);
    if (!running) return false;
    const hint = running[1]?.replace(/[.…]+$/, "").trim();
    return hint === undefined || "esc to interrupt".startsWith(hint);
  });
}

// Agents that keep their idle-looking composer up while work still runs.
function isAgentBusyScreen(lines: string[], agent: KnownAgentName): boolean {
  if (agent === "antigravity") return isAntigravityBusyScreen(lines);
  if (agent === "codex") return isCodexBusyScreen(lines);
  if (agent === "claude") return isClaudeBusyScreen(lines);
  if (agent === "grok") return isGrokBusyScreen(lines);
  if (agent === "kimi") return isKimiBusyScreen(lines);
  if (agent === "muse") return isMuseBusyScreen(lines);
  return false;
}

export function isIdleAgentScreen(
  lines: string[],
  cursorLine: string,
  agent: KnownAgentName,
): boolean {
  if (isAgentBusyScreen(lines, agent)) {
    return false;
  }
  if (agent === "muse" && isMuseNeedsInputScreen(lines)) {
    return false;
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
  { agent: "kimi", names: ["kimi", "kimi-code"] },
  { agent: "muse", names: ["muse"] },
];

const AGENT_DISPLAY_TITLES: readonly { agent: KnownAgentName; pattern: RegExp }[] = [
  { agent: "claude", pattern: /^(?:✳\s*)?claude code(?:\s|$)/i },
  { agent: "codex", pattern: /^(?:openai\s+)?codex(?:\s|$)/i },
  { agent: "grok", pattern: /^grok build(?:\s|$)/i },
  { agent: "antigravity", pattern: /^(?:google\s+)?antigravity(?:\s|$)/i },
  { agent: "opencode", pattern: /^opencode(?:\s|$)/i },
  { agent: "cursor", pattern: /^cursor agent(?:\s|$)/i },
  { agent: "muse", pattern: /^muse code(?:\s|$)/i },
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
  return (agent === "codex" || agent === "muse") && tokens.includes("exec");
}

export function detectAgentFromCommand(command: string | undefined): KnownAgentName | null {
  if (!command) return null;
  const normalized = stripAnsi(command).trim();
  if (!normalized) return null;
  if (/^gh\s+copilot(?:\s|$)/i.test(normalized)) {
    return "copilot";
  }

  const executable = extractCommandExecutable(normalized);
  // Muse's installer launcher execs a release-named native binary.
  if (/^muse-bin-\d+\.\d+\.\d+(?:-[a-z\d.]+)?$/i.test(executable)) return "muse";
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
  // The welcome banner is not reprinted when a session resumes. The footer
  // (`Grok 4.7 (xhigh)`) stays on the screen.
  if (/\bwelcome to grok build\b/i.test(stripped) || /\bgrok\s+\d+\.\d+/i.test(stripped)) {
    return "grok";
  }
  if (/welcome to the antigravity cli/i.test(stripped) || /google antigravity/i.test(stripped)) {
    return "antigravity";
  }
  if (/\bopencode\s+v\d/i.test(stripped)) return "opencode";
  if (/\bcursor agent\s+v\d{4}\./i.test(stripped.replace(/\r?\n/g, " "))) return "cursor";
  if (/\bwelcome to kimi code\b/i.test(stripped)) return "kimi";
  // The welcome banner is not reprinted on resume/restore; the status bar's context
  // meter ("context: 29% (290k/1M)") is the stable marker on those screens.
  if (/\bcontext:\s*\d{1,3}%\s*\(\d[\d.,]*[km]?\/\d+[km]\)/i.test(stripped)) return "kimi";
  if (/^\s*muse code\s+v?\d+\.\d+/im.test(stripped)) return "muse";
  // A restored Muse screen can have scrolled its banner away. Its voice composer
  // together with the profile footer identifies it; the cwd-only title does not.
  const lines = stripped.split(/\r?\n/);
  if (
    /^\s*[─━═]{2,}.*\bVoice input\b/im.test(stripped) &&
    museComposerStart(lines.map((line) => line.trim())) >= 0 &&
    lines.some((line) => MUSE_PROFILE_FOOTER.test(line.trim()))
  ) {
    return "muse";
  }

  return null;
}

const BRAILLE_SPINNER_REGEX = /[\u2800-\u28FF]/;
const MUSE_DIAMOND_REGEX = /[◇◈◆]/;
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
  // Spinner frames the agent drew before it handled an interrupt must not restart the turn.
  // A bounded window, so a turn the agent starts on its own later still lights.
  private interruptedAt: number | null = null;
  // One look at a screen the scanner does not recognize yet. A restored Grok
  // session's next byte is often only the task clock, while the footer is already painted.
  private lookedAtScreen = false;
  private stillnessTimer: NodeJS.Timeout | null = null;
  private lastOutputAt = 0;
  private readonly options: PtyActivityScannerOptions;
  private readonly stillnessMs: number;

  constructor(options: PtyActivityScannerOptions) {
    this.options = options;
    this.stillnessMs = options.stillnessMs ?? 1200;
  }

  getActiveAgent(): KnownAgentName | null {
    return this.activeAgent;
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
    this.interruptedAt = null;
    if (!this.activeAgent) return;

    if (input === "\r" || input === "\n") {
      this.initialLaunch = false;
      this.setWorking();
    }
  }

  handleInterrupt(): void {
    this.interruptedAt = Date.now();
    this.clearStillnessTimer();
    this.currentActivity = null;
    this.unresolvedWorkingStillness = 0;
  }

  feedOutput(chunk: string): void {
    if (!this.activeAgent) {
      // A resumed session's next byte is often a clock tick. The footer that
      // names Grok is already on the screen, not in that tick.
      let detected = detectAgentFromOutput(chunk);
      if (
        !detected &&
        (!this.lookedAtScreen ||
          BRAILLE_SPINNER_REGEX.test(chunk) ||
          MUSE_DIAMOND_REGEX.test(chunk) ||
          chunk.includes("◎") ||
          chunk.includes("⸬"))
      ) {
        this.lookedAtScreen = true;
        detected = detectAgentFromOutput(this.options.readLastLines(15).join("\n"));
      }
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
      !this.isInsideInterruptWindow() &&
      ((this.activeAgent === "claude" &&
        CLAUDE_BUSY_TITLE_REGEX.test(chunk) &&
        // A busy title means no dialog is open, so it also undoes a needs-input hook that
        // landed after the user answered (Claude sends it ~6s after the dialog opens). A
        // hook's finish is left alone: the title still spins while slower Stop hooks run.
        (this.currentActivity !== "working" ||
          this.options.getActivity().attentionReason === "needs_input")) ||
        (this.currentActivity !== "working" &&
          BRAILLE_SPINNER_REGEX.test(chunk) &&
          !this.options.getActivity().attentionReason))
    ) {
      this.setWorking();
    }

    this.promoteWorkingAgentScreen();
    this.scheduleStillnessCheck();
  }

  // A continuously animating live status leaves no quiet gap for the stillness
  // check. Grok and Muse can also resume after an approval without Enter, or
  // start work on their own after a finished turn. Quota stays red.
  private promoteWorkingAgentScreen(): void {
    if (
      (this.initialLaunch && this.activeAgent !== "muse") ||
      this.isInsideInterruptWindow() ||
      (this.activeAgent !== "grok" && this.activeAgent !== "muse") ||
      this.currentActivity === "working" ||
      this.options.getActivity().attentionReason === "quota"
    ) {
      return;
    }
    const lines = this.options.readLastLines(15);
    if (isAgentBusyScreen(lines, this.activeAgent) && !isSpendLimitScreen(lines)) {
      this.initialLaunch = false;
      this.setWorking();
    }
  }

  private isInsideInterruptWindow(): boolean {
    return this.interruptedAt !== null && Date.now() - this.interruptedAt < this.stillnessMs;
  }

  private setWorking(): void {
    // Hooks write the tracker directly, so the scanner's own "working" can be stale.
    if (this.currentActivity === "working" && this.options.getActivity().state === "working") {
      return;
    }
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

    // Hooks write the tracker directly. Follow it, so a hook's working can still settle and a
    // hook's finish or approval is not cleared as a hung turn.
    if (this.options.getActivity().state === "working") {
      this.currentActivity = "working";
    } else if (this.currentActivity === "working") {
      this.currentActivity = null;
    }

    const lines = this.options.readLastLines(15);

    if (isAgentBusyScreen(lines, this.activeAgent) && !isSpendLimitScreen(lines)) {
      this.unresolvedWorkingStillness = 0;
      if (this.currentActivity !== "working") {
        // The welcome screen never looks busy. Work we can see is a turn, including
        // one already running when the scanner first recognized the CLI.
        this.initialLaunch = false;
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

    if (this.activeAgent === "muse" ? isMuseNeedsInputScreen(lines) : isNeedsInputScreen(lines)) {
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
