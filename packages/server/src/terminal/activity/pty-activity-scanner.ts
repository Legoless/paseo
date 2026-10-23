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
  getActivityOwnerSessionId?: () => string | null;
  hasHookNeedsInput?: () => boolean;
  readLastLines: (limit: number) => string[];
  readCursorLine: () => string;
  initialScreenIsHistory?: boolean;
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
  /you(?:'ve| have) hit your (?:(?:monthly|weekly|daily|session) )?(?:spend |usage )?limit\b|spend limit (?:has been )?reached|usage limit (?:has been )?reached|\bout of (?:credits|quota|extra usage)\b|\byou(?:'re| are) out of usage\b|\b(?:quota|rate limit) (?:exceeded|exhausted|reached)\b|\binsufficient quota\b|\bcredit balance is too low\b|\bexhausted your (?:(?:daily|weekly|monthly|session) )?(?:capacity|quota|credits)\b|\bsubscription limit\b/;
const SOURCE_ERROR_EXPRESSION = /\bthrow\s+new\s+[\w$]*error\s*\(/i;

export function isSpendLimitScreen(lines: string[], agent?: KnownAgentName): boolean {
  if (lines.length === 0) return false;
  return screenWithoutEditableComposer(lines.map(stripAnsi), agent).some((line) => {
    const normalized = line.toLowerCase().replace(TYPOGRAPHIC_APOSTROPHE, "'");
    return !SOURCE_ERROR_EXPRESSION.test(normalized) && SPEND_LIMIT_NOTICE.test(normalized);
  });
}

const HORIZONTAL_RULE = /^[─━═]{3,}/;
const CLAUDE_COMPOSER = /^❯(?:\s+.*)?$/;
const CODEX_COMPOSER = /^(?:codex\s*)?[›»](?:\s+(?!\d+\.\s)\S.*)?$/i;
const ANTIGRAVITY_COMPOSER = /^>(?:\s|$)/;
const GEMINI_COMPOSER_PLACEHOLDER =
  /^(?:│\s*)?>\s+Type\s+your\s+message\s+or\s+@path\/to\/file(?:\s*│)?$/;

// Claude's input box is a `❯ text` composer directly under a rule, with its status line
// below. Grok's is the same composer directly under a textless `╭─╮` cap, and the
// model footer (`Grok 4.7 · always-approve`) sits under the draft. None of it is a
// prompt from the agent: words typed into the composer ("confirm", "continue") and
// the mode name in the footer must not read as one, including on the startup screen
// where the composer has no cap. A card titled `╭─ Approve ─╮` is not a cap, so a
// real approval above the composer still counts.
const GROK_COMPOSER_CAP = /^╭[─━═╮]*$/;
const GROK_COMPOSER_PROMPT = /^[>❯](?:\s|$)/;
const GROK_MODEL_FOOTER = /\bGrok\s+\d+\.\d+\b.*\balways-approve\b/i;
const KIMI_COMPOSER_PROMPT = /^│\s*>(?:\s|$)/;
const KIMI_COMPOSER_TOP = /^╭[─━═]+╮$/;
const KIMI_COMPOSER_BOTTOM = /^╰[─━═]+╯$/;

interface KimiComposerBounds {
  top: number;
  bottom: number;
}

function grokUncappedComposerStart(lines: string[]): number {
  const footer = lines.findLastIndex((line) => GROK_MODEL_FOOTER.test(line.trim()));
  if (footer <= 0 || !GROK_COMPOSER_PROMPT.test(lines[footer - 1].trim())) return -1;
  return footer - 1;
}

function dropComposerBlock(lines: string[]): string[] {
  for (let index = lines.length - 1; index > 0; index -= 1) {
    const previous = lines[index - 1].trim();
    if (
      /^[>❯]/.test(lines[index].trim()) &&
      (HORIZONTAL_RULE.test(previous) || GROK_COMPOSER_CAP.test(previous))
    ) {
      return lines.slice(0, index - 1);
    }
  }
  const uncappedGrokComposer = grokUncappedComposerStart(lines);
  return uncappedGrokComposer >= 0 ? lines.slice(0, uncappedGrokComposer) : lines;
}

function dropCodexComposer(lines: string[]): string[] {
  const composer = lines.findLastIndex((line) => CODEX_COMPOSER.test(line.trim()));
  if (composer < 0) return lines;
  return [...lines.slice(0, composer), ...lines.slice(composer + 1)];
}

interface AntigravityComposerBounds {
  top: number;
  bottom: number;
}

function findAntigravityComposer(lines: string[]): AntigravityComposerBounds | null {
  const stripped = lines.map((line) => stripAnsi(line).trim());
  for (let index = stripped.length - 1; index > 0; index -= 1) {
    if (!ANTIGRAVITY_COMPOSER.test(stripped[index]) || !HORIZONTAL_RULE.test(stripped[index - 1])) {
      continue;
    }
    const bottomOffset = stripped.slice(index + 1).findIndex((line) => HORIZONTAL_RULE.test(line));
    if (bottomOffset >= 0) {
      return { top: index - 1, bottom: index + 1 + bottomOffset };
    }
    return null;
  }
  return null;
}

function dropAntigravityTranscriptPrompts(lines: string[]): string[] {
  const result: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const current = stripAnsi(lines[index]).trim();
    const next = index + 1 < lines.length ? stripAnsi(lines[index + 1]).trim() : "";
    if (HORIZONTAL_RULE.test(current) && ANTIGRAVITY_COMPOSER.test(next)) {
      index += 2;
      while (index < lines.length && /^  \S/.test(stripAnsi(lines[index]))) {
        index += 1;
      }
      continue;
    }
    result.push(lines[index]);
    index += 1;
  }
  return result;
}

function dropAntigravityComposer(lines: string[]): string[] {
  const boxed = findAntigravityComposer(lines);
  if (boxed) {
    return dropAntigravityTranscriptPrompts(lines.slice(0, boxed.top));
  }
  const withoutTranscriptPrompts = dropAntigravityTranscriptPrompts(lines);
  if (withoutTranscriptPrompts.length !== lines.length) {
    return withoutTranscriptPrompts;
  }
  const composer = lines.findLastIndex((line) => ANTIGRAVITY_COMPOSER.test(line.trim()));
  if (composer < 0) return lines;
  const remaining = [...lines.slice(0, composer), ...lines.slice(composer + 1)];
  return hasSelectionContext(remaining) ? lines : remaining;
}

function findKimiComposer(lines: string[]): KimiComposerBounds | null {
  const bottom = lines.findLastIndex((line) => KIMI_COMPOSER_BOTTOM.test(line.trim()));
  if (bottom < 0) return null;
  const top = lines.slice(0, bottom).findLastIndex((line) => KIMI_COMPOSER_TOP.test(line.trim()));
  if (top < 0) return null;
  const hasPrompt = lines
    .slice(top + 1, bottom)
    .some((line) => KIMI_COMPOSER_PROMPT.test(line.trim()));
  return hasPrompt ? { top, bottom } : null;
}

function dropKimiComposer(lines: string[]): string[] {
  const composer = findKimiComposer(lines);
  if (!composer) return lines;
  return [...lines.slice(0, composer.top), ...lines.slice(composer.bottom + 1)];
}

function screenWithoutEditableComposer(lines: string[], agent?: KnownAgentName): string[] {
  if (agent === "codex") return dropCodexComposer(lines);
  if (agent === "antigravity") return dropAntigravityComposer(lines);
  if (agent === "kimi") return dropKimiComposer(lines);
  if (agent === "opencode") return dropOpenCodeComposer(lines);
  if (agent === "muse") return dropMuseComposer(lines);
  return dropComposerBlock(lines);
}

function hasSelectionContext(lines: string[]): boolean {
  const lowerText = lines.join("\n").toLowerCase();
  return (
    lowerText.includes("?") ||
    /(?:↑\/↓|up\/down).*\b(?:navigate|select)\b/.test(lowerText) ||
    /\benter\b.*\b(?:confirm|select|accept)\b/.test(lowerText)
  );
}

// Codex draws dismissible account banners above the live composer. The hint is
// "Press a number to choose · esc to dismiss · type to continue". The `› 1.`
// action is not an approval: typing still goes to the composer. A `?` in the
// server copy, or in `? for shortcuts`, must not make that row look like one.
const CODEX_DISMISSIBLE_BANNER_HINT = /esc to dismiss\s*[·•]\s*type to continue/i;
const CODEX_BANNER_ACTION = /^(?:[›»>❯]\s*)?\d+\.\s+\S/;

function withoutCodexDismissibleBanner(lines: string[]): string[] {
  const hint = lines.findIndex((line) => CODEX_DISMISSIBLE_BANNER_HINT.test(line));
  if (hint < 0) return lines;
  const drop = new Set<number>([hint]);
  let sawAction = false;
  for (let index = hint - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (trimmed.length === 0) {
      if (sawAction) break;
      continue;
    }
    if (!CODEX_BANNER_ACTION.test(trimmed)) break;
    drop.add(index);
    sawAction = true;
  }
  return lines.filter((_, index) => !drop.has(index));
}

const INTERRUPTED_TURN_NOTICE = /^(?:[└⎿]\s+)?Interrupted\s+[·•]\s+What should .+ do instead\?$/i;

function isProviderTurnEnd(line: string, agent?: KnownAgentName): boolean {
  const normalized = stripAnsi(line).trim();
  if (INTERRUPTED_TURN_NOTICE.test(normalized)) return true;
  if (agent === "claude") return /^✻ (?!Waiting for\b).+ for \d/.test(normalized);
  if (agent === "codex" || agent === "grok") {
    return /^(?:[^\s\w]\s+)?Worked for\b/.test(normalized);
  }
  if (agent === "antigravity") return /^▸\s+Thought for\b/.test(normalized);
  return false;
}

function screenFromLastTurnEnd(lines: string[], agent?: KnownAgentName): string[] {
  const turnEnd = lines.findLastIndex((line) => isProviderTurnEnd(line, agent));
  if (turnEnd < 0) return lines;
  return INTERRUPTED_TURN_NOTICE.test(stripAnsi(lines[turnEnd]).trim())
    ? lines.slice(turnEnd + 1)
    : lines.slice(turnEnd);
}

export function isNeedsInputScreen(lines: string[], agent?: KnownAgentName): boolean {
  if (lines.length === 0) return false;
  const currentTurn = screenFromLastTurnEnd(lines, agent);
  const tailStart = Math.max(0, currentTurn.length - 10);
  const tailLines = screenWithoutEditableComposer(currentTurn.map(stripAnsi), agent)
    .slice(tailStart)
    .filter((line) => !GROK_MODEL_FOOTER.test(line));
  const scannedLines = agent === "codex" ? withoutCodexDismissibleBanner(tailLines) : tailLines;
  const tailText = scannedLines.join("\n");
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

  if (scannedLines.some((line) => /^\?\s+\S+/.test(line.trim()))) {
    return true;
  }

  const hasSelectedOption = scannedLines.some((line) => /^[>❯›»]\s+\S+/.test(line.trim()));
  if (hasSelectedOption && hasSelectionContext(scannedLines)) {
    return true;
  }

  return false;
}

const IDLE_PROMPT_PATTERNS = {
  claude: [CLAUDE_COMPOSER],
  // Codex keeps its composer (`› ` or `» ` + placeholder or draft) on the cursor line.
  // Numbered menu rows such as `› 1.` are not composers.
  codex: [CODEX_COMPOSER],
  // Grok 4.7's composer is `❯`. `>` and `grok>` are the older prompt.
  grok: [/^(?:grok\s*)?[>❯]$/i],
  antigravity: [/^>$/],
  opencode: [/^[>❯]$/],
  pi: [/^>$/],
  copilot: [/^>$/],
  cursor: [],
  gemini: [/^>$/, GEMINI_COMPOSER_PLACEHOLDER],
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
const ANTIGRAVITY_RUNNING_SUBAGENT = /^[●○]\s+Agent\(/;
const ANTIGRAVITY_OPEN_WORK = /\b[1-9]\d*\s+(?:task|subagent)\(s\)(?=\s|$)/i;
const ANTIGRAVITY_OPEN_SUBAGENTS = /\b[1-9]\d*\s+subagent\(s\)(?=\s|$)/i;
const ANTIGRAVITY_ACTIVE_TURN_FOOTER = /^esc to cancel\b.*\s·\s/i;
const ANTIGRAVITY_COMPOSER_FOOTER =
  /^(?:esc to cancel|\?\s+for shortcuts)\b.*\s[·•]\s|\bGemini\s+\d+(?:\.\d+)?\b.*\s[·•]\s*(?:low|medium|high|xhigh|max)\b/i;
// agy prints this as it quits. A renamed tab does not deliver the shell title, so
// this line is the quit the scanner can see. Counts above it are that process.
const ANTIGRAVITY_EXIT_BANNER = /Resume with -c \(or command below\):/;

function antigravityLinesAfterExit(lines: string[]): string[] | null {
  const stripped = lines.map((line) => stripAnsi(line).trim());
  const exit = stripped.findLastIndex((line) => ANTIGRAVITY_EXIT_BANNER.test(line));
  return exit >= 0 ? stripped.slice(exit + 1) : null;
}

// A `>` or a new header under the banner is another agy session. The shell prompt is not.
function isAntigravityQuitScreen(lines: string[]): boolean {
  const live = antigravityLinesAfterExit(lines);
  if (!live || findAntigravityComposer(live) !== null) return false;
  return !live.some(
    (line) =>
      isIdlePromptLine(line, "antigravity") ||
      /welcome to the antigravity cli/i.test(line) ||
      /^antigravity cli\b/i.test(line) ||
      ANTIGRAVITY_RUNNING_STATUS.test(line) ||
      ANTIGRAVITY_RUNNING_SUBAGENT.test(line) ||
      ANTIGRAVITY_OPEN_WORK.test(line),
  );
}

// The agy composer stays on `>` while a turn runs (`esc to cancel` in the footer) and
// while background work is listed below it. Subagents wake the model when they finish,
// whereas `[HH:MM:SS] … running` and `N task(s)` are parked background commands that
// should not keep a finished turn working.
export function isAntigravityBusyScreen(lines: string[]): boolean {
  const live = antigravityLinesAfterExit(lines);
  const tail = (live ?? lines.map((line) => stripAnsi(line).trim())).slice(-20);
  return tail.some(
    (line) =>
      ANTIGRAVITY_ACTIVE_TURN_FOOTER.test(line) ||
      ANTIGRAVITY_RUNNING_SUBAGENT.test(line) ||
      ANTIGRAVITY_OPEN_SUBAGENTS.test(line),
  );
}

const GEMINI_RUNNING_STATUS = /^[\u2800-\u28FF]\s+.+\(esc to cancel,\s*\d+[hms](?:\s+\d+[hms])*\)$/;
const GEMINI_COMPOSER_BORDER = /^[╭╰][─━═]+[╮╯]$/;

export function isGeminiBusyScreen(lines: string[]): boolean {
  const stripped = lines.map((line) => stripAnsi(line).trim());
  const composer = stripped.findLastIndex((line) => isIdlePromptLine(line, "gemini"));
  if (composer < 0) return false;
  const status = stripped
    .slice(0, composer)
    .findLast((line) => line.length > 0 && !GEMINI_COMPOSER_BORDER.test(line));
  return status !== undefined && GEMINI_RUNNING_STATUS.test(status);
}

// Codex keeps its composer up while a turn runs, with a status line directly above it:
// "• Working (12s • esc to interrupt)". The header can change and a narrow pane truncates
// the hint, so match either. Only that line counts, so a reply or diff quoting it does not.
const CODEX_RUNNING_STATUS =
  /\(\d+[hms] [^)]*esc to interrupt\)(?:\s*·.*)?$|^• .+ \(\d+[hms](?:\s+\d+[hms])*$|^• Working \(\d/;

export function isCodexBusyScreen(lines: string[]): boolean {
  const stripped = lines.map((line) => stripAnsi(line).trim());
  const composer = stripped.findLastIndex((line) => CODEX_COMPOSER.test(line));
  const status = stripped.slice(0, Math.max(composer, 0)).findLast((line) => line.length > 0);
  return status !== undefined && CODEX_RUNNING_STATUS.test(status);
}

// Claude keeps its ruled `❯` composer on the cursor line while a turn runs (showing an
// animated `[·✢✳✶✻✽] Verb… (elapsed · …)` spinner above optional `⎿  Tip: …` and right-
// aligned `◎ /goal active` / `✘ …` rows) and after a turn whose background work still runs
// (`✻ Baked for 6s · … · 1 shell still running` or `✻ Waiting for 1 background agent to
// finish`). Only the status block immediately above the composer counts, so an older turn
// or a reply quoting status prose does not. `running Stop hooks` is excluded so a Stop
// hook's finish stays idle while slower Stop hooks finish.
const CLAUDE_BACKGROUND_STATUS =
  /^✻ (?:.+ · \d+ [^·]+ still running|Waiting for \d+ .+ to finish)$/;
const CLAUDE_RUNNING_STATUS =
  /^[·✢✳✶✻✽◐◑◒◓]\s+(?!.*\brunning Stop hooks\b)[^()\n]+?(?:…|\.\.\.)(?:\s*\([^)]*\)?)?$/i;
const CLAUDE_COMPOSER_NOTICE = /^(?:✘\s+|◎\s+\/goal active\b)/i;
const CLAUDE_SUBLINE = /^\s*⎿(?:\s|$)/;
const CLAUDE_INDENTED_CONTINUATION = /^\s{2,}(?![·✢✳✶✻✽◐◑◒◓⏺●⎿])\S/;
const CLAUDE_MODE_FOOTER =
  /^(?:[⏵▸⏸]+\s+)?(?:bypass permissions|accept edits|plan mode|auto mode|manual mode)\s+on\b/i;

function claudeComposerStart(lines: string[]): number {
  for (let index = lines.length - 1; index > 0; index -= 1) {
    if (
      CLAUDE_COMPOSER.test(lines[index].trim()) &&
      HORIZONTAL_RULE.test(lines[index - 1].trim())
    ) {
      return index - 1;
    }
  }
  return -1;
}

function isClaudeStatusTail(rawLines: string[]): boolean {
  if (rawLines.length === 0) return false;
  const last = rawLines.at(-1)!.trim();
  if (CLAUDE_BACKGROUND_STATUS.test(last) || CLAUDE_RUNNING_STATUS.test(last)) {
    return true;
  }
  if (rawLines.length >= 2 && CLAUDE_INDENTED_CONTINUATION.test(rawLines.at(-1)!)) {
    const joined = `${rawLines.at(-2)!.trim()} ${last}`;
    return CLAUDE_BACKGROUND_STATUS.test(joined) || CLAUDE_RUNNING_STATUS.test(joined);
  }
  return false;
}

export function isClaudeBusyScreen(lines: string[]): boolean {
  const stripped = lines.map((line) => stripAnsi(line).replace(/\s+$/, ""));
  const composer = claudeComposerStart(stripped);
  if (composer < 0 || isNeedsInputScreen(lines, "claude")) return false;
  const rawAboveComposer = stripped.slice(0, composer).filter((line) => line.trim().length > 0);
  while (
    rawAboveComposer.length > 0 &&
    CLAUDE_COMPOSER_NOTICE.test(rawAboveComposer.at(-1)!.trim())
  ) {
    rawAboveComposer.pop();
  }
  if (isClaudeStatusTail(rawAboveComposer)) return true;

  for (let pass = 0; pass < 2; pass += 1) {
    let cursor = rawAboveComposer.length - 1;
    while (cursor >= 0 && CLAUDE_INDENTED_CONTINUATION.test(rawAboveComposer[cursor])) {
      cursor -= 1;
    }
    if (
      cursor < 0 ||
      !CLAUDE_SUBLINE.test(rawAboveComposer[cursor]) ||
      INTERRUPTED_TURN_NOTICE.test(rawAboveComposer[cursor].trim())
    ) {
      break;
    }
    rawAboveComposer.length = cursor;
    while (
      rawAboveComposer.length > 0 &&
      CLAUDE_COMPOSER_NOTICE.test(rawAboveComposer.at(-1)!.trim())
    ) {
      rawAboveComposer.pop();
    }
    if (isClaudeStatusTail(rawAboveComposer)) return true;
  }
  return false;
}

// Grok prints "Worked for …" when the turn ends and leaves the ❯ composer up.
// A dock row above that composer is still this turn only until that marker
// exists. Its mark is the four-dot ⸬ (a braille spinner is the other running
// mark) and the row ends with a live elapsed time: `⸬ Run …  1h04m`. After
// "Worked for", those rows are processes left up for the user. Their clocks
// keep painting, and that must not keep the pane working. "Thought for" only
// closes the reasoning block, so a dock row under it is still the turn. An
// open reasoning block is a spinner frame plus `Thinking` or `Thinking…`.
// That frame cycles through `⋅` `:` `⸬` `⁙` and braille, so the mark is
// whatever single glyph is in front of the word. A `Thinking` line above
// `Thought for` or `Worked for` is an older block. `◎ waiting` is the turn
// paused. `◎ … still running` stays working only when it names a subagent or
// a loop, because those can wake the model; commands and monitors are the
// parked case, and a mix stays working. The window is the lines near the
// composer, so a braille logo higher in the scrollback does not.
const GROK_RUNNING_MARK = "(?:[\\u2800-\\u28FF]|⸬)";
const GROK_RUNNING_ROW = new RegExp(
  `^${GROK_RUNNING_MARK}.*(?:\\d+h\\d+m(?:\\d+s)?|\\d+m\\d+s|\\d+[hms])$`,
);
const GROK_THINKING_ROW = /^(?:[^\s\w]\s+)?Thinking(?:\.{1,3}|…|⋯)?$/;
const GROK_WORKED_FOR = /^(?:[^\s\w]\s+)?Worked for\b/;
const GROK_REASONING_CLOSED = /^(?:[^\s\w]\s+)?(?:Thought for|Worked for)\b/;
const GROK_WAITING = /^◎\s+waiting\b/;
const GROK_STILL_RUNNING = /^◎\s+\d+\b.*\bstill running\b/;
const GROK_WAKES_ON_EXIT = /\b(?:subagents?|loops?)\b/;
const GROK_DOCK_LINE_LIMIT = 12;
const GROK_DRAFT_PROMPT = /^(?:grok\s*)?[>❯]\s+\S/i;

function grokDock(lines: string[]): string[] {
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
  return dock;
}

export function isGrokBusyScreen(lines: string[]): boolean {
  // `dock` is nearest-to-composer first. The nearest `Worked for` closes this
  // turn. Task rows between it and the composer are parked. A `Thinking` row
  // there is a new turn. Rows above the marker are an older block.
  const dock = grokDock(lines);
  const turnClosedAt = dock.findIndex((line) => GROK_WORKED_FOR.test(line));
  let reasoningClosed = false;
  for (let index = 0; index < dock.length; index += 1) {
    const line = dock[index];
    const aboveClosedTurn = turnClosedAt >= 0 && index > turnClosedAt;
    const parkedUnderTurn = turnClosedAt >= 0 && index < turnClosedAt;
    if (!aboveClosedTurn && GROK_WAITING.test(line)) return true;
    if (!aboveClosedTurn && GROK_STILL_RUNNING.test(line) && GROK_WAKES_ON_EXIT.test(line)) {
      return true;
    }
    if (parkedUnderTurn) {
      if (GROK_THINKING_ROW.test(line)) return true;
      continue;
    }
    if (aboveClosedTurn || GROK_WORKED_FOR.test(line)) continue;
    if (GROK_REASONING_CLOSED.test(line)) {
      reasoningClosed = true;
      continue;
    }
    if (GROK_RUNNING_ROW.test(line)) return true;
    if (reasoningClosed) continue;
    if (GROK_THINKING_ROW.test(line)) return true;
  }
  return false;
}

function isGrokFinishedComposerScreen(lines: string[]): boolean {
  return grokDock(lines).some((line) => GROK_WORKED_FOR.test(line));
}

// Kimi's composer comes back when the turn ends, but work that outlives the turn keeps
// a "[1 task running]" badge in the status bar. The badge shares the row with the
// model/context segments ("K3 thinking: max", "context: 29%"), so require one of them
// on the same line below the composer — a reply or draft does not keep the pane working.
const KIMI_RUNNING_TASKS = /\[\d+ tasks? running\]/;
const KIMI_STATUS_BAR_SEGMENT = /(?:\bthinking:\s*\w+|\bcontext:\s*\d{1,3}%)/;

export function isKimiBusyScreen(lines: string[]): boolean {
  const stripped = lines.map((line) => stripAnsi(line).trim());
  const composer = findKimiComposer(stripped);
  if (!composer) return false;
  return stripped
    .slice(composer.bottom + 1)
    .slice(-6)
    .some((line) => KIMI_RUNNING_TASKS.test(line) && KIMI_STATUS_BAR_SEGMENT.test(line));
}

// Muse leaves its composer on the cursor line throughout the turn. Its animated
// diamond/caret status sits above the ruled composer (or above the indented
// reasoning summary and goal checklist); a completed response also starts with
// a diamond, so require an elapsed time for a filled diamond. Narrow panes wrap
// the row or truncate its interrupt hint.
const MUSE_STATUS_VERBS =
  "(?:Thinking|Working|Calling tools|Double checking|Finishing up|Compacting context(?: before your message)?|Interrupting|(?:Running|Executing) (?:command|tool)s?(?:\\s+[·•]\\s+.+?\\s+—\\s+running)?)";
const MUSE_RUNNING_STATUS = new RegExp(
  `^[◇◈◆▸▾]\\s+${MUSE_STATUS_VERBS}\\s+\\(\\d+[hms](?:\\s*\\d+[hms])*(?:\\s*[·•]\\s*(.*?))?\\)?$`,
  "i",
);
const MUSE_STARTING_STATUS = new RegExp(`^[◇◈▸▾]\\s+${MUSE_STATUS_VERBS}$`, "i");
const MUSE_GOAL_ITEM = /^\s{2,}[✓✔✗✖◇◈◆]\s/;
const MUSE_BACKGROUND_HINT = /^\s*└\s+\(ctrl\+b to send to background\)$/i;
const MUSE_COMPOSER_RULE = /^[─━═]{2,}/;
const MUSE_PROFILE_FOOTER =
  /\s[·•]\s(?:Read only|Ask me|Auto-review|Unrestricted|Launch overrides|YOLO)(?:\s[·•]\s|$)/i;

function museComposerStart(lines: string[]): number {
  for (let index = lines.length - 1; index > 0; index -= 1) {
    if (/^❯(?:\s|$)/.test(lines[index]) && MUSE_COMPOSER_RULE.test(lines[index - 1])) {
      return index - 1;
    }
  }
  return -1;
}

function dropMuseComposer(lines: string[]): string[] {
  const composer = museComposerStart(lines.map((line) => stripAnsi(line).trim()));
  return composer >= 0 ? lines.slice(0, composer) : lines;
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

function isMuseStatusTail(statusLines: string[]): boolean {
  return statusLines.some((_, index) => {
    const status = statusLines.slice(index).join(" ");
    if (MUSE_STARTING_STATUS.test(status)) return true;
    const running = MUSE_RUNNING_STATUS.exec(status);
    if (!running) return false;
    const hint = running[1]?.replace(/[.…]+$/, "").trim();
    return hint === undefined || "esc to interrupt".startsWith(hint);
  });
}

export function isMuseBusyScreen(lines: string[]): boolean {
  const stripped = lines.map((line) => stripAnsi(line).trim());
  const composer = museComposerStart(stripped);
  if (composer < 0 || isMuseNeedsInputScreen(lines)) return false;
  const rawAboveComposer = lines
    .slice(0, composer)
    .map((line) => stripAnsi(line).replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0);
  while (rawAboveComposer.length > 0 && MUSE_BACKGROUND_HINT.test(rawAboveComposer.at(-1)!)) {
    rawAboveComposer.pop();
  }
  if (isMuseStatusTail(rawAboveComposer.slice(-3).map((line) => line.trim()))) {
    return true;
  }
  while (rawAboveComposer.length > 0 && MUSE_GOAL_ITEM.test(rawAboveComposer.at(-1)!)) {
    rawAboveComposer.pop();
  }
  if (isMuseStatusTail(rawAboveComposer.slice(-3).map((line) => line.trim()))) {
    return true;
  }
  while (rawAboveComposer.length > 0 && /^\s{2,}\S/.test(rawAboveComposer.at(-1)!)) {
    rawAboveComposer.pop();
  }
  return isMuseStatusTail(rawAboveComposer.slice(-3).map((line) => line.trim()));
}

// OpenCode's textarea stays visible while busy and has no prompt marker. Its
// left border, agent/model row, and footer identify the composer. The shadow
// row disappears with transparent themes, so the last left-border row is the
// other boundary. Only the footer below it carries live interrupt status;
// elapsed assistant headers and "view subagents" belong to the transcript.
const OPENCODE_COMPOSER_BORDER = /^[┃│]/;
const OPENCODE_COMPOSER_SHADOW = /^╹▀*$/;
const OPENCODE_INTERRUPT_HINT = /(?:^|\s)esc\s+(?:again\s+to\s+)?interrupt(?:\s|$)/i;
const OPENCODE_FOOTER_SPINNER = /^(?:[■⬝·⬥◆⬩⬪\u2800-\u28ff]+|\[⋯\])(?:\s|$)/;
const OPENCODE_COMMAND_HINT = /\S+\s+commands(?:\s|$)/i;

interface OpenCodeComposer {
  start: number;
  end: number;
  footer: string[];
}

function findOpenCodeComposer(lines: string[]): OpenCodeComposer | null {
  const stripped = lines.map((line) => stripAnsi(line).trim());
  const shadow = stripped.findLastIndex((line) => OPENCODE_COMPOSER_SHADOW.test(line));
  const end =
    shadow >= 0
      ? shadow
      : stripped.findLastIndex((line) => OPENCODE_COMPOSER_BORDER.test(line)) + 1;
  if (end <= 0) return null;
  const body: string[] = [];
  for (let index = end - 1; index >= 0; index -= 1) {
    if (!OPENCODE_COMPOSER_BORDER.test(stripped[index])) break;
    body.unshift(stripped[index].slice(1).trim());
  }
  if (body.length < 2 || !/\S\s+[·•]\s+\S/.test(body.slice(-4).join(" "))) return null;
  const composerEnd = shadow >= 0 ? end + 1 : end;
  const footer = stripped.slice(composerEnd).filter(Boolean);
  const text = footer.join(" ");
  if (!OPENCODE_INTERRUPT_HINT.test(text) && !OPENCODE_COMMAND_HINT.test(text)) return null;
  return { start: end - body.length, end: composerEnd, footer };
}

function openCodeComposerFooter(lines: string[]): string[] | null {
  return findOpenCodeComposer(lines)?.footer ?? null;
}

function dropOpenCodeComposer(lines: string[]): string[] {
  const composer = findOpenCodeComposer(lines);
  if (!composer) return lines;
  return [...lines.slice(0, composer.start), ...lines.slice(composer.end)];
}

export function isOpenCodeBusyScreen(lines: string[]): boolean {
  if (isOpenCodeNeedsInputScreen(lines)) return false;
  const footer = openCodeComposerFooter(lines);
  return (
    footer !== null &&
    OPENCODE_FOOTER_SPINNER.test(footer[0] ?? "") &&
    OPENCODE_INTERRUPT_HINT.test(footer.join(" "))
  );
}

export function isOpenCodeNeedsInputScreen(lines: string[]): boolean {
  const stripped = lines.slice(-15).map((line) => stripAnsi(line).trim());
  const composerFooter = openCodeComposerFooter(lines);
  const footer = (composerFooter ?? stripped).filter(Boolean).slice(-4).join(" ");
  const permission =
    /\b(?:Permission required|Reject permission|Always allow)\b/i.test(stripped.join(" ")) &&
    /\benter\s+confirm\b/i.test(footer);
  const question = /\benter\s+(?:submit|toggle|confirm)\b.*\besc\s+dismiss\b/i.test(footer);
  if (permission || question) return true;
  return composerFooter === null && isNeedsInputScreen(lines);
}

// Agents that keep their idle-looking composer up while work still runs.
function isAgentBusyScreen(lines: string[], agent: KnownAgentName): boolean {
  if (agent === "antigravity") return isAntigravityBusyScreen(lines);
  if (agent === "gemini") return isGeminiBusyScreen(lines);
  if (agent === "codex") return isCodexBusyScreen(lines);
  if (agent === "claude") return isClaudeBusyScreen(lines);
  if (agent === "grok") return isGrokBusyScreen(lines);
  if (agent === "kimi") return isKimiBusyScreen(lines);
  if (agent === "muse") return isMuseBusyScreen(lines);
  if (agent === "opencode") return isOpenCodeBusyScreen(lines);
  if (agent === "cursor") return isCursorBusyScreen(lines);
  return false;
}

const CURSOR_IDLE_COMPOSERS = new Set([
  "→ Plan, search, build anything",
  "→ Add a follow-up",
  "→ Add a follow-up — /plan to review and build",
]);
const CURSOR_BUSY_HINT = /\bctrl\+c to stop\b/i;
const CURSOR_DECISION_STATUS = /^→\s+Waiting for decision\b/i;
const CURSOR_DECISION_OPTION = /^→\s+\d+\.\s+\S+/;
// Resume and a scrolled-away banner leave the composer and this footer. The chat
// title is not usable: Cursor names the tab after the task ("Codex Session …").
const CURSOR_FOOTER_MARKER = /\bctrl\+c to stop\b|\bRun Everything\b|\b\d+\s+files edited\b/i;
const CURSOR_MODEL_FOOTER = /·[^·\n]*\b(?:extra high|max)\b/i;

function cursorTail(lines: string[]): string[] {
  return lines.slice(-15).map((line) => stripAnsi(line).trim());
}

function isCursorComposerLine(line: string): boolean {
  if (CURSOR_IDLE_COMPOSERS.has(line) || CURSOR_DECISION_STATUS.test(line)) return true;
  for (const composer of CURSOR_IDLE_COMPOSERS) {
    if (line.startsWith(`${composer} `)) return true;
  }
  return false;
}

function chunkHasCursorChrome(chunk: string): boolean {
  return (
    chunk.includes("→") ||
    /ctrl\+c to stop/i.test(chunk) ||
    chunk.includes("Run Everything") ||
    /\bfiles edited\b/i.test(chunk) ||
    /cursor agent/i.test(chunk)
  );
}

// `ctrl+c to stop` sits on or under the live composer while a turn runs. A reply
// that quotes the hint above the composer is not that row.
export function isCursorBusyScreen(lines: string[]): boolean {
  const tail = cursorTail(lines);
  const composer = tail.findLastIndex((line) => line.startsWith("→"));
  if (composer < 0) return false;
  return tail.slice(composer).some((line) => CURSOR_BUSY_HINT.test(line));
}

function isCursorAgentScreen(lines: string[]): boolean {
  const tail = cursorTail(lines).filter((line) => line.length > 0);
  if (tail.some((line) => CURSOR_DECISION_STATUS.test(line))) return true;
  const composer = tail.findLastIndex((line) => isCursorComposerLine(line));
  if (composer < 0) return false;
  const footer = tail.slice(composer).join(" ");
  return CURSOR_FOOTER_MARKER.test(footer) || CURSOR_MODEL_FOOTER.test(footer);
}

export function isCursorNeedsInputScreen(lines: string[]): boolean {
  const stripped = lines.slice(-15).map((line) => stripAnsi(line).trim());
  const hasDecision = stripped.some((line) => CURSOR_DECISION_STATUS.test(line));
  const hasQuestion = stripped.some((line) => /\?\s*$/.test(line));
  const hasOption = stripped.some((line) => CURSOR_DECISION_OPTION.test(line));
  return hasDecision && hasQuestion && hasOption;
}

function isAgentNeedsInputScreen(lines: string[], agent: KnownAgentName): boolean {
  if (agent === "muse") return isMuseNeedsInputScreen(lines);
  if (agent === "opencode") return isOpenCodeNeedsInputScreen(lines);
  if (agent === "cursor") {
    return isCursorNeedsInputScreen(lines) || isNeedsInputScreen(lines, agent);
  }
  return isNeedsInputScreen(lines, agent);
}

const NEEDS_INPUT_GATED_IDLE_AGENTS = new Set<KnownAgentName>([
  "claude",
  "codex",
  "grok",
  "antigravity",
]);

function isAntigravityIdleComposerScreen(lines: string[], cursorLine: string): boolean {
  if (isIdlePromptLine(cursorLine, "antigravity")) return true;
  const composer = findAntigravityComposer(lines);
  if (!composer) return false;
  const trimmedCursor = stripAnsi(cursorLine).trim();
  if (ANTIGRAVITY_COMPOSER.test(trimmedCursor)) return true;
  return (
    trimmedCursor.length > 0 &&
    lines
      .slice(composer.top + 1, composer.bottom)
      .some((line) => stripAnsi(line).trim() === trimmedCursor)
  );
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
  if (agent === "opencode") {
    if (isOpenCodeNeedsInputScreen(lines)) return false;
    return openCodeComposerFooter(lines) !== null || isIdlePromptLine(cursorLine, agent);
  }
  if (NEEDS_INPUT_GATED_IDLE_AGENTS.has(agent) && isAgentNeedsInputScreen(lines, agent)) {
    return false;
  }
  if (agent === "antigravity") {
    return isAntigravityIdleComposerScreen(lines, cursorLine);
  }
  if (agent === "grok") {
    if (isIdlePromptLine(cursorLine, agent)) return true;
    return (
      GROK_DRAFT_PROMPT.test(stripAnsi(cursorLine).trim()) && isGrokFinishedComposerScreen(lines)
    );
  }
  if (agent !== "cursor") {
    return isIdlePromptLine(cursorLine, agent);
  }
  if (isAgentNeedsInputScreen(lines, agent)) {
    return false;
  }
  const cursorLines = lines.slice(-15).map((line) => stripAnsi(line).trim());
  const composer = cursorLines.findLastIndex((line) => line.startsWith("→"));
  const liveFooter = cursorLines.slice(Math.max(composer, 0));
  if (liveFooter.some((line) => CURSOR_BUSY_HINT.test(line))) {
    return false;
  }
  const composerLines = cursorLines.filter((line) => line.startsWith("→"));
  return CURSOR_IDLE_COMPOSERS.has(composerLines.at(-1) ?? "");
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
  // `agent` is the current Cursor CLI. `cursor` and `cursor-agent` are the older names.
  { agent: "cursor", names: ["cursor", "cursor-agent", "agent"] },
  { agent: "gemini", names: ["gemini"] },
  { agent: "amp", names: ["amp"] },
  { agent: "kimi", names: ["kimi", "kimi-code"] },
  { agent: "muse", names: ["muse"] },
];

const AGENT_DISPLAY_TITLES: readonly { agent: KnownAgentName; pattern: RegExp }[] = [
  { agent: "claude", pattern: /^(?:✳\s*)?claude code(?:\s|$)/i },
  // A trailing word is a chat title ("Codex Session …"), which Cursor also uses.
  { agent: "codex", pattern: /^(?:openai\s+)?codex(?:\s+v?\d[\w.]*)?$/i },
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
const AGENT_DETECTION_OUTPUT_LIMIT = 8192;
const UNRESOLVED_WORKING_STILLNESS_LIMIT = 3;
// The title arrives before the TUI paints, and feedOutput runs before the chunk is
// on the screen, so a chat-titled Cursor session needs more than one look.
const TITLE_GUESS_CHECKS = 8;
// These CLIs keep a composer on screen during a turn, so a busy screen is the
// signal. The launch set also accepts that screen before the first Enter.
const PROMOTED_DURING_LAUNCH = new Set<KnownAgentName>([
  "antigravity",
  "claude",
  "cursor",
  "muse",
  "opencode",
]);
const PROMOTED_AGENTS = new Set<KnownAgentName>([
  "antigravity",
  "claude",
  "codex",
  "cursor",
  "grok",
  "muse",
  "opencode",
]);

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

function detectRestoredAgentFromScreen(stripped: string, lines: string[]): KnownAgentName | null {
  if (openCodeComposerFooter(lines) !== null) return "opencode";
  const trimmed = lines.map((line) => line.trim());
  // A restored Muse screen can have scrolled its banner away. Its voice composer
  // together with the profile footer identifies it; the cwd-only title does not.
  if (
    /^\s*[─━═]{2,}.*\bVoice input\b/im.test(stripped) &&
    museComposerStart(trimmed) >= 0 &&
    trimmed.some((line) => MUSE_PROFILE_FOOTER.test(line))
  ) {
    return "muse";
  }
  if (claudeComposerStart(trimmed) >= 0 && trimmed.some((line) => CLAUDE_MODE_FOOTER.test(line))) {
    return "claude";
  }
  const antigravityComposer = findAntigravityComposer(trimmed);
  if (
    antigravityComposer !== null &&
    !isAntigravityQuitScreen(trimmed) &&
    trimmed
      .slice(antigravityComposer.bottom + 1)
      .some((line) => ANTIGRAVITY_COMPOSER_FOOTER.test(line) || ANTIGRAVITY_OPEN_WORK.test(line))
  ) {
    return "antigravity";
  }
  return null;
}

export function detectAgentFromOutput(chunk: string): KnownAgentName | null {
  if (!chunk) return null;
  const stripped = stripAnsi(chunk);
  const lines = stripped.split(/\r?\n/);
  // Before the banner checks. A visible transcript can name another product
  // ("OpenAI Codex") while the live chrome is still Cursor.
  if (isCursorAgentScreen(lines)) return "cursor";

  if (/\bclaude code\s+v?\d/i.test(stripped) || /✳\s*claude\b/i.test(stripped)) return "claude";
  if (/\bopenai codex\b/i.test(stripped) || /\bcodex\s+v\d/i.test(stripped)) return "codex";
  // The welcome banner is not reprinted when a session resumes. The footer
  // (`Grok 4.7 (xhigh)`) stays on the screen.
  if (/\bwelcome to grok build\b/i.test(stripped) || /\bgrok\s+\d+\.\d+/i.test(stripped)) {
    return "grok";
  }
  if (
    /welcome to the antigravity cli/i.test(stripped) ||
    /google antigravity/i.test(stripped) ||
    /\bantigravity cli\s+v?\d+\.\d+/i.test(stripped)
  ) {
    return "antigravity";
  }
  if (/\bopencode\s+v\d/i.test(stripped)) return "opencode";
  if (/\bcursor agent\s+v\d{4}\./i.test(stripped.replace(/\r?\n/g, " "))) return "cursor";
  if (/\bwelcome to kimi code\b/i.test(stripped)) return "kimi";
  // The welcome banner is not reprinted on resume/restore; the status bar's context
  // meter ("context: 29% (290k/1M)") is the stable marker on those screens.
  if (/\bcontext:\s*\d{1,3}%\s*\(\d[\d.,]*[km]?\/\d+[km]\)/i.test(stripped)) return "kimi";
  if (/^\s*muse code\s+v?\d+\.\d+/im.test(stripped)) return "muse";

  return detectRestoredAgentFromScreen(stripped, lines);
}

const BRAILLE_SPINNER_REGEX = /[\u2800-\u28FF]/;
const MUSE_DIAMOND_REGEX = /[◇◈◆▸▾]/;
const CLAUDE_SPINNER_REGEX = /[·✢✳✶✻✽◐◑◒◓]/;
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
  // Once the shell returns, existing screen content belongs to a previous command.
  // A new agent must identify itself through fresh output, its command, or its title.
  private canProbeScreenForAgent: boolean;
  private agentDetectionOutput = "";
  // A window title can name the chat ("Codex Session …") before the screen does.
  // The guess stays provisional for a few frames so a later paint can replace it.
  private titleGuess = false;
  private titleChecks = 0;
  private stillnessTimer: NodeJS.Timeout | null = null;
  private lastOutputAt = 0;
  private readonly options: PtyActivityScannerOptions;
  private readonly stillnessMs: number;

  constructor(options: PtyActivityScannerOptions) {
    this.options = options;
    this.canProbeScreenForAgent = !options.initialScreenIsHistory;
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
    this.agentDetectionOutput = "";
    this.titleGuess = false;
    this.titleChecks = 0;
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
      this.agentDetectionOutput = "";
      this.titleGuess = true;
      this.titleChecks = 0;
      this.initialLaunch = true;
    }
  }

  handleCommandFinished(): void {
    this.clearStillnessTimer();
    this.activeAgent = null;
    this.currentActivity = null;
    this.initialLaunch = false;
    this.expectsCommandTitle = false;
    this.lookedAtScreen = false;
    this.canProbeScreenForAgent = false;
    this.agentDetectionOutput = "";
    this.titleGuess = false;
    this.titleChecks = 0;
    this.unresolvedWorkingStillness = 0;
    this.lastOutputAt = 0;
    this.options.clearActivity();
  }

  feedInput(input: string): void {
    this.interruptedAt = null;
    if (!this.activeAgent || this.disarmQuitAntigravity()) return;

    if (input === "\r" || input === "\n") {
      this.initialLaunch = false;
      this.setWorking();
    }
  }

  handleHookActivityChange(): void {
    if (!this.activeAgent || this.options.getActivity().state !== "working") {
      return;
    }
    this.initialLaunch = false;
    // Hooks can arrive after the final PTY repaint, when no stillness check remains armed.
    this.scheduleStillnessCheck();
  }

  handleInterrupt(): void {
    const dismissedNeedsInput =
      (this.activeAgent === "claude" || this.activeAgent === "codex") &&
      this.options.getActivity().attentionReason === "needs_input";
    this.interruptedAt = Date.now();
    this.clearStillnessTimer();
    this.currentActivity = dismissedNeedsInput ? "attention" : null;
    this.unresolvedWorkingStillness = 0;
  }

  private shouldProbeUnknownAgentScreen(chunk: string): boolean {
    if (!this.canProbeScreenForAgent) return false;
    return (
      !this.lookedAtScreen ||
      BRAILLE_SPINNER_REGEX.test(chunk) ||
      /[■⬝⬥⬩⬪]/.test(chunk) ||
      MUSE_DIAMOND_REGEX.test(chunk) ||
      CLAUDE_SPINNER_REGEX.test(chunk) ||
      chunk.includes("…") ||
      chunk.includes("⋯") ||
      chunk.includes("◎") ||
      chunk.includes("⸬") ||
      chunkHasCursorChrome(chunk)
    );
  }

  // Title detection runs before the TUI paints, and Cursor's title is the chat name.
  // feedOutput runs before the chunk is on the screen, so look at this chunk and the
  // screen already painted. A transcript that names another CLI does not confirm it.
  private reconcileTitleGuess(chunk: string): void {
    if (!this.titleGuess || !this.activeAgent) return;
    const screenIsCursor =
      detectAgentFromOutput(chunk) === "cursor" ||
      detectAgentFromOutput(this.options.readLastLines(25).join("\n")) === "cursor";
    if (screenIsCursor) {
      this.activeAgent = "cursor";
      this.titleGuess = false;
      return;
    }
    this.titleChecks += 1;
    if (this.titleChecks >= TITLE_GUESS_CHECKS) this.titleGuess = false;
  }

  feedOutput(chunk: string): void {
    if (!this.activeAgent) {
      // PTY chunks can split an identifying banner. Keep only fresh output since the last
      // shell boundary so assembling those bytes cannot rediscover an exited agent.
      const freshOutput = this.agentDetectionOutput + chunk;
      this.agentDetectionOutput = freshOutput.slice(-AGENT_DETECTION_OUTPUT_LIMIT);
      let detected = detectAgentFromOutput(freshOutput);
      // A resumed session's next byte is often a clock tick. The footer that
      // names Grok is already on the screen, not in that tick.
      if (!detected && this.shouldProbeUnknownAgentScreen(chunk)) {
        this.lookedAtScreen = true;
        detected = detectAgentFromOutput(this.options.readLastLines(25).join("\n"));
      }
      if (detected) {
        this.activeAgent = detected;
        this.agentDetectionOutput = "";
        this.initialLaunch = true;
      } else {
        return;
      }
    } else if (this.titleGuess) {
      this.reconcileTitleGuess(chunk);
    }

    // The banner is in this chunk. The headless screen does not have it yet:
    // feedOutput runs before the PTY chunk is parsed. A later chunk sees it there.
    if (this.disarmQuitAntigravity(chunk)) return;

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
          // A parked Grok task keeps a braille clock after Worked for. That frame
          // must not relight a closed turn. A busy Grok screen is promoted below.
          // Antigravity's logo is braille too. A frame only counts once the live
          // screen is actually busy, so a quit banner's scrollback cannot relight.
          this.activeAgent !== "opencode" &&
          this.activeAgent !== "grok" &&
          (this.activeAgent !== "antigravity" ||
            isAntigravityBusyScreen(this.options.readLastLines(20))) &&
          BRAILLE_SPINNER_REGEX.test(chunk) &&
          !this.options.getActivity().attentionReason))
    ) {
      this.setWorking();
    }

    this.promoteWorkingAgentScreen();
    this.scheduleStillnessCheck();
  }

  // A continuously animating live status leaves no quiet gap for the stillness
  // check. Antigravity, Claude, Codex, Cursor, Grok, Muse, and OpenCode can resume
  // after an approval without Enter, or start/continue work on their own. Quota stays red.
  private promoteWorkingAgentScreen(): void {
    if (
      !this.activeAgent ||
      (this.initialLaunch && !PROMOTED_DURING_LAUNCH.has(this.activeAgent)) ||
      this.isInsideInterruptWindow() ||
      !PROMOTED_AGENTS.has(this.activeAgent) ||
      (this.currentActivity === "working" && this.options.getActivity().state === "working") ||
      this.hasOpenCodeHookNeedsInput() ||
      this.options.getActivity().attentionReason === "quota"
    ) {
      return;
    }
    const lines = this.options.readLastLines(25);
    if (
      isAgentBusyScreen(lines, this.activeAgent) &&
      !isSpendLimitScreen(lines, this.activeAgent)
    ) {
      this.initialLaunch = false;
      this.setWorking();
    }
  }

  private isInsideInterruptWindow(): boolean {
    return this.interruptedAt !== null && Date.now() - this.interruptedAt < this.stillnessMs;
  }

  // agy quits by printing the banner, then the shell prompt. Drop the agent before
  // a braille frame or the next Enter can mark that shell as a turn.
  private disarmQuitAntigravity(chunk?: string): boolean {
    if (this.activeAgent !== "antigravity") return false;
    const quit =
      (chunk !== undefined && ANTIGRAVITY_EXIT_BANNER.test(stripAnsi(chunk))) ||
      isAntigravityQuitScreen(this.options.readLastLines(20));
    if (!quit) return false;
    this.handleCommandFinished();
    return true;
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

  private hasOpenCodeHookWork(lines: string[]): boolean {
    return (
      this.activeAgent === "opencode" &&
      this.options.getActivity().state === "working" &&
      Boolean(this.options.getActivityOwnerSessionId?.()) &&
      !isOpenCodeNeedsInputScreen(lines)
    );
  }

  private hasOpenCodeHookNeedsInput(): boolean {
    // Ownership also survives questions seen only by the scanner. A child
    // hook's wait is what can outrank the parent's live interrupt footer.
    return (
      this.activeAgent === "opencode" &&
      this.options.getActivity().attentionReason === "needs_input" &&
      Boolean(this.options.hasHookNeedsInput?.())
    );
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

    const lines = this.options.readLastLines(25);
    const openCodeHookNeedsInput = this.hasOpenCodeHookNeedsInput();

    if (
      !openCodeHookNeedsInput &&
      isAgentBusyScreen(lines, this.activeAgent) &&
      !isSpendLimitScreen(lines, this.activeAgent)
    ) {
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

    if (isSpendLimitScreen(lines, this.activeAgent)) {
      this.currentActivity = "attention";
      this.unresolvedWorkingStillness = 0;
      this.options.setActivity("attention", "quota");
      return;
    }

    // OpenCode's parent composer goes idle while background sessions keep
    // running. Its plugin aggregates their status under the root session id;
    // that owned hook state ends only when the plugin reports a terminal state.
    if (openCodeHookNeedsInput || this.hasOpenCodeHookWork(lines)) {
      this.unresolvedWorkingStillness = 0;
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

    if (isAgentNeedsInputScreen(lines, this.activeAgent)) {
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
