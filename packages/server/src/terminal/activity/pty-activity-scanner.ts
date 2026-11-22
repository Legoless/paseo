import stripAnsi from "strip-ansi";
import type {
  TerminalActivityAttentionReason,
  TerminalActivityState,
} from "@getpaseo/protocol/terminal-activity";
import {
  normalizeAntigravityClockTime,
  type AntigravityTrayTaskSummary,
  type AntigravityVisibleTrayTask,
} from "./antigravity-tasks.js";

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
  areAntigravityTrayTasksDaemonOnly?: (traySummary: AntigravityTrayTaskSummary) => boolean;
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
  /you(?:'ve| have) hit your (?:(?:monthly|weekly|daily|session) )?(?:spend |usage )?limit\b|spend limit (?:has been )?reached|usage limit (?:has been )?reached|\bout of (?:credits|quota|extra usage)\b|\byou(?:'re| are) out of usage\b|\b(?:quota|rate limit) (?:exceeded|exhausted|reached)\b|\binsufficient quota\b|\bcredit balance is too low\b|\bexhausted your (?:(?:daily|weekly|monthly|session) )?(?:capacity|quota|credits)\b|\bsubscription limit\b/i;
const SOURCE_ERROR_EXPRESSION = /\bthrow\s+new\s+[\w$]*error\s*\(/i;
const SPEND_LIMIT_LEAD_IN = /\byou(?:'re|'ve| are| have)?(?: (?:run|ran|now|currently))?\s*$/i;

// Replies talk about quota too (`│ agy │ Out of quota until 17:10 │`, "while agy waits out its
// quota"). A CLI's own notice opens its line: only a label (`API`, `[System Error]`, `Error:`) or
// "You are" comes before the phrase. A table row, a lower-case word in front of the phrase, or a
// line that starts in lower case (a wrapped sentence) is someone writing about it.
function isSpendLimitNoticeLine(line: string): boolean {
  const normalized = line.replace(TYPOGRAPHIC_APOSTROPHE, "'");
  const match = SPEND_LIMIT_NOTICE.exec(normalized);
  if (!match || SOURCE_ERROR_EXPRESSION.test(normalized)) return false;
  if ((normalized.match(/[│┃|]/g)?.length ?? 0) >= 3) return false;
  const lead = normalized.slice(0, match.index);
  const label = lead
    .replace(SPEND_LIMIT_LEAD_IN, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b[\w-]*error\b/gi, " ");
  if (/(?:^|[\s("'`[])[a-z]/.test(label)) return false;
  return /^[A-Z]/.test(match[0]) || /[\p{L}\p{N}]/u.test(lead);
}

export function isSpendLimitScreen(lines: string[], agent?: KnownAgentName): boolean {
  if (lines.length === 0) return false;
  return screenWithoutEditableComposer(lines.map(stripAnsi), agent).some(isSpendLimitNoticeLine);
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

const ANTIGRAVITY_MENU_FIRST_OPTION = /^>\s+(?:\d+\.\s+|Yes,\b)/i;
const ANTIGRAVITY_MENU_NEXT_OPTION = /^  (?:\d+\.\s+|No,\b)/i;
const ANTIGRAVITY_DIALOG_NAV_HINT = /(?:↑\/↓|up\/down).*\b(?:navigate|select)\b/i;
const ANTIGRAVITY_MODAL_ACTION_HINT =
  /(?:↑\/↓|up\/down)\s+navigate\b.*\b(?:space\s+toggle|enter\s+(?:confirm|submit)|esc\s+skip)\b|\b(?:space\s+toggle|esc\s+skip)\b.*[·•].*\benter\s+(?:submit|confirm)\b|\benter\s+(?:submit|confirm)\b.*[·•]\s*esc\b/i;
const ANTIGRAVITY_ACTIVE_TURN_FOOTER = /^esc to cancel\b.*\s[·•]\s/i;

interface AntigravityComposerBounds {
  top: number;
  bottom: number;
}

function findAntigravityComposer(lines: string[]): AntigravityComposerBounds | null {
  const raw = lines.map(stripAnsi);
  const stripped = raw.map((line) => line.trim());
  for (let index = stripped.length - 1; index > 0; index -= 1) {
    if (!ANTIGRAVITY_COMPOSER.test(stripped[index]) || !HORIZONTAL_RULE.test(stripped[index - 1])) {
      continue;
    }
    const bottomOffset = stripped.slice(index + 1).findIndex((line) => HORIZONTAL_RULE.test(line));
    if (bottomOffset < 0) return null;
    const bottom = index + 1 + bottomOffset;
    const inner = raw.slice(index + 1, bottom);
    const isWrappedDraft = inner.every((line) => line.trim().length === 0 || line.startsWith("  "));
    const isMenuOptions =
      ANTIGRAVITY_MENU_FIRST_OPTION.test(stripped[index]) &&
      inner.some((line) => ANTIGRAVITY_MENU_NEXT_OPTION.test(line));
    const hasDialogHint = stripped
      .slice(index + 1)
      .some(
        (line) =>
          ANTIGRAVITY_DIALOG_NAV_HINT.test(line) || ANTIGRAVITY_MODAL_ACTION_HINT.test(line),
      );
    const isQuestionModal =
      index >= 2 &&
      /^question$/i.test(stripped[index - 2]) &&
      stripped.slice(bottom + 1).some((line) => ANTIGRAVITY_ACTIVE_TURN_FOOTER.test(line));
    if (!isWrappedDraft || isMenuOptions || hasDialogHint || isQuestionModal) {
      return null;
    }
    return { top: index - 1, bottom };
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
  const lowerText = lines
    .join("\n")
    .toLowerCase()
    .replace(/\?\s+for shortcuts\b/g, "");
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
  return false;
}

function screenFromLastTurnEnd(lines: string[], agent?: KnownAgentName): string[] {
  const turnEnd = lines.findLastIndex((line) => isProviderTurnEnd(line, agent));
  if (turnEnd < 0) return lines;
  return INTERRUPTED_TURN_NOTICE.test(stripAnsi(lines[turnEnd]).trim())
    ? lines.slice(turnEnd + 1)
    : lines.slice(turnEnd);
}

function matchesGenericNeedsInput(lines: string[], agent?: KnownAgentName): boolean {
  if (lines.length === 0) return false;
  const currentTurn = screenFromLastTurnEnd(lines, agent);
  const tailLines = screenWithoutEditableComposer(currentTurn.map(stripAnsi), agent)
    .slice(-10)
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

  if (scannedLines.some((line) => /^\?\s+(?!for shortcuts\b)\S+/i.test(line.trim()))) {
    return true;
  }

  const hasSelectedOption = scannedLines.some((line) => /^[>❯›»]\s+\S+/.test(line.trim()));
  if (hasSelectedOption && hasSelectionContext(scannedLines)) {
    return true;
  }

  return false;
}

export function isNeedsInputScreen(lines: string[], agent?: KnownAgentName): boolean {
  if (agent === "antigravity") return isAntigravityNeedsInputScreen(lines);
  return matchesGenericNeedsInput(lines, agent);
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
  // Kimi's composer is a bordered box (`│ >`), while approvals and questions replace
  // that box (`> Allow once`). Kimi 2.4+ keeps the cursor in `│ >` during a turn so the
  // user can queue guidance; `isKimiBusyScreen` keeps active turns and background work working.
  kimi: [/^│\s*>(?:\s|$)/],
  muse: [/^❯(?:\s+.*)?$/],
} satisfies Record<KnownAgentName, readonly RegExp[]>;

export function isIdlePromptLine(line: string, agent: KnownAgentName): boolean {
  const patterns = IDLE_PROMPT_PATTERNS[agent];
  const normalized = stripAnsi(line).trim();
  return patterns.some((pattern) => pattern.test(normalized));
}

const ANTIGRAVITY_RUNNING_STATUS = /\[\d{1,2}:\d{2}:\d{2}\].*\brunning$/i;
const ANTIGRAVITY_RUNNING_TASK_ROW = /\[(\d{1,2}:\d{2}:\d{2})\]\s*(.+?)\s+running$/i;
const ANTIGRAVITY_RUNNING_SUBAGENT = /^[●○]\s+Agent\(/;
const ANTIGRAVITY_RUNNING_COMMAND = /^[●○]\s+Running\b/;
const ANTIGRAVITY_OPEN_WORK = /\b[1-9]\d*\s+(?:task|subagent)\(s\)(?=\s|$)/i;
const ANTIGRAVITY_OPEN_SUBAGENTS = /\b[1-9]\d*\s+subagent\(s\)(?=\s|$)/i;
const ANTIGRAVITY_OPEN_TASKS = /\b([1-9]\d*)\s+task\(s\)(?=\s|$)/i;
const ANTIGRAVITY_COMPOSER_FOOTER =
  /^(?:esc to cancel|\?\s+for shortcuts)\b.*\s[·•]\s|\bGemini\s+\d+(?:\.\d+)?\b.*\s[·•]\s*(?:low|medium|high|xhigh|max)\b/i;
const ANTIGRAVITY_TRAY_ALERT =
  /\bhas a question\b|\baction required(?:\s*\(\d+\s+left\))?(?:\s|$)/i;
const ANTIGRAVITY_QUESTION_HEADER =
  /^(?:the agent has a question(?:\s+for you)?[:.]|question\s+\d+\/\d+:\s+\S)/i;
const ANTIGRAVITY_CHECKBOX_OPTION = /^(?:>\s+)?\d+\.\s+\[[ xX]\]\s+\S/;
const ANTIGRAVITY_WRITE_IN_OPTION = /^(?:>\s+)?\d+\.\s+Write-in(?:\.{3}|…)$/i;
// agy prints this as it quits. A renamed tab does not deliver the shell title, so
// this line is the quit the scanner can see. Counts above it are that process.
const ANTIGRAVITY_EXIT_BANNER = /Resume with -c \(or command below\):/;

function antigravityLiveRawLines(lines: string[]): string[] {
  const exit = lines.findLastIndex((line) => ANTIGRAVITY_EXIT_BANNER.test(stripAnsi(line).trim()));
  return exit >= 0 ? lines.slice(exit + 1) : lines;
}

// A `>` or a new header under the banner is another agy session. The shell prompt is not.
function isAntigravityQuitScreen(lines: string[]): boolean {
  const exit = lines.findLastIndex((line) => ANTIGRAVITY_EXIT_BANNER.test(stripAnsi(line).trim()));
  if (exit < 0) return false;
  const rawAfterExit = lines.slice(exit + 1);
  if (findAntigravityComposer(rawAfterExit) !== null) return false;
  return !rawAfterExit.some((rawLine) => {
    const line = stripAnsi(rawLine).trim();
    return (
      isIdlePromptLine(line, "antigravity") ||
      /welcome to the antigravity cli/i.test(line) ||
      /^antigravity cli\b/i.test(line) ||
      ANTIGRAVITY_RUNNING_STATUS.test(line) ||
      ANTIGRAVITY_RUNNING_SUBAGENT.test(line) ||
      ANTIGRAVITY_OPEN_WORK.test(line) ||
      ANTIGRAVITY_MODAL_ACTION_HINT.test(line)
    );
  });
}

function antigravityTrayLines(lines: string[]): string[] | null {
  const composer = findAntigravityComposer(lines);
  if (composer !== null) {
    return lines.slice(composer.bottom + 1);
  }
  const stripped = lines.map((line) => stripAnsi(line).trim());
  const barePrompt = stripped.findLastIndex((line) => isIdlePromptLine(line, "antigravity"));
  if (barePrompt < 0) return null;
  const below = stripped.slice(barePrompt + 1).filter((line) => line.length > 0);
  const isFooterOrTray = below.every(
    (line) =>
      HORIZONTAL_RULE.test(line) ||
      ANTIGRAVITY_COMPOSER_FOOTER.test(line) ||
      ANTIGRAVITY_RUNNING_STATUS.test(line) ||
      ANTIGRAVITY_RUNNING_SUBAGENT.test(line) ||
      /\b\d+\s+(?:task|subagent)\(s\)(?=\s|$)/i.test(line) ||
      ANTIGRAVITY_TRAY_ALERT.test(line),
  );
  return isFooterOrTray ? lines.slice(barePrompt + 1) : null;
}

function isAntigravityModalNeedsInput(trimmedLines: readonly string[]): boolean {
  const recent = trimmedLines.slice(-25);
  if (
    recent.some(
      (line, index) =>
        ANTIGRAVITY_QUESTION_HEADER.test(line) ||
        ANTIGRAVITY_MODAL_ACTION_HINT.test(line) ||
        ANTIGRAVITY_WRITE_IN_OPTION.test(line) ||
        (/^question$/i.test(line) &&
          index + 1 < recent.length &&
          HORIZONTAL_RULE.test(recent[index + 1])),
    )
  ) {
    return true;
  }
  return (
    recent.some((line) => ANTIGRAVITY_CHECKBOX_OPTION.test(line)) &&
    recent.some((line) => HORIZONTAL_RULE.test(line) || ANTIGRAVITY_DIALOG_NAV_HINT.test(line))
  );
}

// Antigravity's approval, workspace-trust, and ask_question modals replace the ruled
// `>` composer box while keeping the `esc to cancel` model footer underneath, whereas
// assistant replies sit directly above the composer box with no turn-end marker. While
// the composer is on screen, only subagent/workflow alerts in the tray below it
// (`<agent> has a question`, `Action required`) require user input.
export function isAntigravityNeedsInputScreen(lines: string[]): boolean {
  if (isAntigravityQuitScreen(lines)) return false;
  const live = antigravityLiveRawLines(lines);
  const tray = antigravityTrayLines(live);
  if (tray !== null) {
    return tray
      .map((line) => stripAnsi(line).trim())
      .some((line) => !ANTIGRAVITY_RUNNING_STATUS.test(line) && ANTIGRAVITY_TRAY_ALERT.test(line));
  }
  const trimmed = live.map((line) => stripAnsi(line).trim()).filter((line) => line.length > 0);
  if (isAntigravityModalNeedsInput(trimmed)) {
    return true;
  }
  return matchesGenericNeedsInput(live, "antigravity");
}

export interface AntigravityBusyScreenOptions {
  areTrayTasksDaemonOnly?: (traySummary: AntigravityTrayTaskSummary) => boolean;
}

function isAntigravityForegroundOrSubagentBusyLine(line: string): boolean {
  return (
    ANTIGRAVITY_ACTIVE_TURN_FOOTER.test(line) ||
    ANTIGRAVITY_RUNNING_SUBAGENT.test(line) ||
    ANTIGRAVITY_OPEN_SUBAGENTS.test(line)
  );
}

function parseAntigravityTrayTaskRow(line: string): AntigravityVisibleTrayTask | null {
  const match = ANTIGRAVITY_RUNNING_TASK_ROW.exec(line);
  if (!match) {
    return null;
  }
  const rawDescription = match[2].trim();
  if (rawDescription.endsWith("…")) {
    return {
      startTime: normalizeAntigravityClockTime(match[1]),
      description: rawDescription.slice(0, -1).replace(/\s+/g, " ").trim(),
      truncated: true,
    };
  }
  if (rawDescription.endsWith("...")) {
    return {
      startTime: normalizeAntigravityClockTime(match[1]),
      description: rawDescription.slice(0, -3).replace(/\s+/g, " ").trim(),
      truncated: true,
    };
  }
  return {
    startTime: normalizeAntigravityClockTime(match[1]),
    description: rawDescription.replace(/\s+/g, " ").trim(),
    truncated: false,
  };
}

function parseAntigravityTrayTasks(lines: readonly string[]): AntigravityTrayTaskSummary | null {
  const visibleTasks: AntigravityVisibleTrayTask[] = [];
  let taskCount: number | null = null;
  for (const line of lines) {
    const row = parseAntigravityTrayTaskRow(line);
    if (row !== null) {
      visibleTasks.push(row);
    }
    const countMatch = ANTIGRAVITY_OPEN_TASKS.exec(line);
    if (countMatch) {
      taskCount = Number.parseInt(countMatch[1], 10);
    }
  }
  if (visibleTasks.length === 0 && taskCount === null) {
    return null;
  }
  return { visibleTasks, taskCount };
}

// The agy composer stays on `>` while a turn runs (`esc to cancel` in the footer) and
// while background tasks or subagents sit in the tray below it (`[HH:MM:SS] … running`,
// `● Agent(…)`, `N task(s)`, `N subagent(s)`). `run_command` backgrounds commands past
// its 10s wait and wakes the model on completion, and `[HH:MM:SS]` is the static start
// timestamp, so non-daemon tasks keep the screen working across quiet stretches while
// `IsDaemon: true` tasks let the completed turn settle. Scope to the tray when the
// composer is visible so a reply quoting a count or timestamp does not relight it.
export function isAntigravityBusyScreen(
  lines: string[],
  options?: AntigravityBusyScreenOptions,
): boolean {
  if (isAntigravityQuitScreen(lines) || isAntigravityNeedsInputScreen(lines)) return false;
  const live = antigravityLiveRawLines(lines);
  const tray = antigravityTrayLines(live);
  const rawScope = tray ?? live.slice(-20);
  const strippedScope = rawScope.map((rawLine) => stripAnsi(rawLine).trim());
  if (
    strippedScope.some((line) => isAntigravityForegroundOrSubagentBusyLine(line)) ||
    (tray === null && strippedScope.some((line) => ANTIGRAVITY_RUNNING_COMMAND.test(line)))
  ) {
    return true;
  }
  const traySummary = parseAntigravityTrayTasks(strippedScope);
  if (traySummary === null) {
    return strippedScope.some((line) => ANTIGRAVITY_RUNNING_STATUS.test(line));
  }
  if (options?.areTrayTasksDaemonOnly?.(traySummary)) {
    return false;
  }
  return true;
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

// Codex keeps its composer up while a turn runs, with a status block directly above it:
// "• Working (12s • esc to interrupt)" above optional `└ Tip: …` sublines. The header can
// change and a narrow pane wraps or truncates the hint, so match either. Only that block
// counts, so a reply or diff quoting it does not.
const CODEX_RUNNING_STATUS =
  /\(\d+[hms] [^)]*esc to interrupt(?:\s+and\s+send\s+immediately)?\)(?:\s*[·•].*)?$|^• .+ \(\d+[hms](?:\s+\d+[hms])*$|^• Working \(\d/;
const CODEX_SUBLINE = /^\s*[└⎿](?:\s|$)/;
const CODEX_INDENTED_CONTINUATION = /^\s{2,}(?![•└⎿›»])\S/;

function isCodexStatusTail(rawLines: string[]): boolean {
  if (rawLines.length === 0) return false;
  const lastLine = rawLines[rawLines.length - 1];
  const last = lastLine.trim();
  if (CODEX_RUNNING_STATUS.test(last)) {
    return true;
  }
  if (rawLines.length >= 2 && CODEX_INDENTED_CONTINUATION.test(lastLine)) {
    const joined = `${rawLines[rawLines.length - 2].trim()} ${last}`;
    return CODEX_RUNNING_STATUS.test(joined);
  }
  return false;
}

export function isCodexBusyScreen(lines: string[]): boolean {
  const stripped = lines.map((line) => stripAnsi(line).replace(/\s+$/, ""));
  const composer = stripped.findLastIndex((line) => CODEX_COMPOSER.test(line.trim()));
  if (composer < 0 || isNeedsInputScreen(lines, "codex")) return false;
  const rawAboveComposer = stripped.slice(0, composer).filter((line) => line.trim().length > 0);
  if (isCodexStatusTail(rawAboveComposer)) return true;

  for (let pass = 0; pass < 2; pass += 1) {
    let cursor = rawAboveComposer.length - 1;
    while (cursor >= 0 && CODEX_INDENTED_CONTINUATION.test(rawAboveComposer[cursor])) {
      cursor -= 1;
    }
    if (
      cursor < 0 ||
      !CODEX_SUBLINE.test(rawAboveComposer[cursor]) ||
      INTERRUPTED_TURN_NOTICE.test(rawAboveComposer[cursor].trim())
    ) {
      break;
    }
    rawAboveComposer.length = cursor;
    if (isCodexStatusTail(rawAboveComposer)) return true;
  }
  return false;
}

// Claude keeps its ruled `❯` composer on the cursor line while a turn runs (showing an
// animated `[·✢✳✶✻✽] Verb… (elapsed · …)` spinner above optional `⎿  Tip: …` and right-
// aligned `◎ /goal active` / `✘ …` rows) and after a turn whose waking background work
// still runs (`✻ Waiting for 1 background agent to finish`, or `✻ Baked for 6s · … · 1
// background agent still running`). Parked shells (e.g. a dev server waiting for the user's
// check) and monitors do not keep a finished turn working. Only the status block immediately
// above the composer counts, so an older turn or a reply quoting status prose does not.
// `running Stop hooks` is excluded so a Stop hook's finish stays idle while slower Stop
// hooks finish.
const CLAUDE_WAITING_STATUS = /^✻ Waiting for \d+ .+ to finish$/;
const CLAUDE_STILL_RUNNING_STATUS = /^✻ .+ · .+\bstill running$/;
const CLAUDE_WAKES_ON_EXIT =
  /\b\d+\s+(?:(?:background|remote|dynamic|local)\s+)?(?:agents?|subagents?|workflows?|teammates?|loops?|tasks?)\b/i;
const CLAUDE_RUNNING_STATUS =
  /^[·✢✳✶✻✽◐◑◒◓]\s+(?!.*\brunning Stop hooks\b)[^()\n]+?(?:…|\.\.\.)(?:\s*\([^)]*\)?)?$/i;
const CLAUDE_COMPOSER_NOTICE = /^(?:✘\s+|◎\s+\/goal active\b)/i;
const CLAUDE_SUBLINE = /^\s*⎿(?:\s|$)/;
const CLAUDE_INDENTED_CONTINUATION = /^\s{2,}(?![·✢✳✶✻✽◐◑◒◓⏺●⎿])\S/;
const CLAUDE_MODE_FOOTER =
  /^(?:[⏵▸⏸]+\s+)?(?:bypass permissions|accept edits|plan mode|auto mode|manual mode)\s+on\b/i;

function isClaudeBackgroundStatus(line: string): boolean {
  if (CLAUDE_WAITING_STATUS.test(line)) {
    return true;
  }
  if (!CLAUDE_STILL_RUNNING_STATUS.test(line)) {
    return false;
  }
  return line
    .split(" · ")
    .slice(1)
    .some((part) => CLAUDE_WAKES_ON_EXIT.test(part));
}

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
  if (isClaudeBackgroundStatus(last) || CLAUDE_RUNNING_STATUS.test(last)) {
    return true;
  }
  if (rawLines.length >= 2 && CLAUDE_INDENTED_CONTINUATION.test(rawLines.at(-1)!)) {
    const joined = `${rawLines.at(-2)!.trim()} ${last}`;
    return isClaudeBackgroundStatus(joined) || CLAUDE_RUNNING_STATUS.test(joined);
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
// exists. The row ends with a live elapsed time: `⸬ Run …  1h04m`. Grok
// 4.7 keeps painting past that clock: `↓159k`, a `[1]` count, and `[stop]`
// or `[send to bg]` (`Waiting for response... 1.4s … 10m10s ↓159k [stop]`).
// That tail is this turn, so it stays working even when an older `Worked for`
// is still in the dock. A clock with no tail, after "Worked for", is a
// process left up for the user. Its clock keeps painting, and that must not
// keep the pane working. "Thought for" only closes the reasoning block, so a
// dock row under it is still the turn. An open reasoning block is a spinner
// frame plus `Thinking` or `Thinking…`.
// The status row and the Thinking row share one spinner. It cycles through
// `⋅` `:` `⸬` `⁙` and braille, so the mark is that single glyph plus a space.
// A `Thinking` line above `Thought for` or `Worked for` is an older block.
// `◎ waiting` is the turn paused. `◎ … still running` stays working only when
// it names a subagent or a loop, because those can wake the model; commands
// and monitors are the parked case, and a mix stays working. The window is
// the lines near the composer, so a braille logo higher in the scrollback
// does not.
const GROK_RUNNING_MARK = "(?:[\\u2800-\\u28FF]|[⋅:⸬⁙])\\s";
const GROK_ELAPSED = String.raw`(?:\d+h\d+m(?:\d+s)?|\d+m\d+s|\d+(?:\.\d+)?[hms])`;
// Token meter, background count, and the stop / send-to-background controls
// share the status row with the clock. The buttons identify the live turn.
const GROK_LIVE_STATUS_TAIL = String.raw`(?:\s+↓\s*[\d.]+[kKmM])?(?:\s*\[\d+\])?(?:\s*\[(?:stop|send to bg)\])+`;
const GROK_RUNNING_ROW = new RegExp(
  `^${GROK_RUNNING_MARK}.*${GROK_ELAPSED}(?:${GROK_LIVE_STATUS_TAIL})?$`,
);
const GROK_LIVE_STATUS_ROW = new RegExp(
  `^${GROK_RUNNING_MARK}.*${GROK_ELAPSED}${GROK_LIVE_STATUS_TAIL}$`,
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
  // or a live status row (`↓…k [stop]`) there is a new turn. Rows above the
  // marker are an older block.
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
      if (GROK_THINKING_ROW.test(line) || GROK_LIVE_STATUS_ROW.test(line)) return true;
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

// A `↓…k [stop]` / `[send to bg]` row is a turn still in flight. A quota glow
// from a notice that has left the screen yields to it. A Thinking frame does
// not: the limit often lands while that spinner is still painted.
function isGrokLiveStatusScreen(lines: string[]): boolean {
  const dock = grokDock(lines);
  const turnClosedAt = dock.findIndex((line) => GROK_WORKED_FOR.test(line));
  return dock.some((line, index) => {
    if (turnClosedAt >= 0 && index > turnClosedAt) return false;
    return GROK_LIVE_STATUS_ROW.test(line);
  });
}

function isGrokFinishedComposerScreen(lines: string[]): boolean {
  return grokDock(lines).some((line) => GROK_WORKED_FOR.test(line));
}

// Kimi 2.4+ keeps the `│ >` composer focused throughout a turn and renders its live
// activity row above the top border: a moon-phase loader while waiting or running tools
// (`🌑`, `🌗 · Tip: …`, `🌒 Retrying …`, or inline `AgentSwarm` status rows such as
// `🌑 Orchestrating…` / `🌑 Prompting…`), a braille loader while thinking, composing,
// or compacting (`⠋ Working…`, `⠋ Compacting…`), and queued-message dock hints while a
// turn or compaction is running. Panels such as queued messages, `/btw`, and `NotifyUser`
// sit between the spinner and the composer, so scan the full above-composer dock.
// Background tasks, subagents, and active `/goal` loops show badges on the status bar
// below the composer (`[1 task running]`, `[2 agents running]`, `[goal ● active · …]`,
// which narrow split panes truncate with `…`), paired with `thinking` or `context: NN%`
// on the status rows so draft or reply text never matches.
const KIMI_MOON_SPINNER_REGEX = /[🌑🌒🌓🌔🌕🌖🌗🌘]/u;
const KIMI_MOON_SPINNER_ROW =
  /^(?:🌑|🌒|🌓|🌔|🌕|🌖|🌗|🌘)(?:$|\s+(?:[·•]\s|(?:Retrying|Working|Compacting|Thinking|Orchestrating|Prompting|Rate limited)\b))/iu;
const KIMI_BRAILLE_ACTIVITY_ROW =
  /^[\u2800-\u28FF]\s+(?:Working|Compacting|Thinking)(?:…|\.\.\.)(?:\s|$)/i;
const KIMI_QUEUE_DOCK_RULE = /^[─━]{3,}$/;
const KIMI_QUEUE_BUSY_HINT =
  /^(?:\d+\s+queued\s+[·•]\s+)?↑ to edit\s+[·•]\s+(?:ctrl-s to steer\b|will send after\b)/i;
const KIMI_FOOTER_BUSY_BADGE = /\[\d+\s+(?:tasks?|agents?)\s+running\]|\[goal\s*●\s*active\b/i;
const KIMI_FOOTER_TRUNCATED_BADGE = /\[([^\]]*)…$/;
const KIMI_TRUNCATED_TASK_LABELS = [
  "task running",
  "tasks running",
  "agent running",
  "agents running",
];
const KIMI_STATUS_BAR_SEGMENT = /\bthinking(?::\s*\w+)?\b|\bcontext:\s*\d{1,3}%/i;
const KIMI_ABOVE_COMPOSER_LINE_LIMIT = 20;

function hasTruncatedKimiBusyBadge(line: string): boolean {
  const match = KIMI_FOOTER_TRUNCATED_BADGE.exec(line);
  if (!match) return false;
  const fragment = match[1].trimStart();
  const goalPrefix = /^goal\s*●\s*(.*)$/i.exec(fragment);
  if (goalPrefix) {
    const status = goalPrefix[1].toLowerCase();
    return status.length > 0 && ("active".startsWith(status) || status.startsWith("active "));
  }
  const countMatch = /^(\d+)(.*)$/.exec(fragment);
  if (!countMatch || /^0+$/.test(countMatch[1])) return false;
  const rest = countMatch[2];
  if (rest.length === 0) return true;
  if (!/^\s/.test(rest)) return false;
  const suffix = rest.trimStart().toLowerCase();
  return (
    suffix.length === 0 || KIMI_TRUNCATED_TASK_LABELS.some((label) => label.startsWith(suffix))
  );
}

export function isKimiBusyScreen(lines: string[]): boolean {
  const stripped = lines.map((line) => stripAnsi(line).trim());
  const composer = findKimiComposer(stripped);
  if (!composer) return false;
  const aboveComposer = stripped
    .slice(0, composer.top)
    .filter(Boolean)
    .slice(-KIMI_ABOVE_COMPOSER_LINE_LIMIT);
  if (
    aboveComposer.some(
      (line, index) =>
        KIMI_MOON_SPINNER_ROW.test(line) ||
        KIMI_BRAILLE_ACTIVITY_ROW.test(line) ||
        (KIMI_QUEUE_BUSY_HINT.test(line) &&
          aboveComposer.slice(0, index).some((prev) => KIMI_QUEUE_DOCK_RULE.test(prev))),
    )
  ) {
    return true;
  }
  const footerLines = stripped.slice(composer.bottom + 1, composer.bottom + 7).filter(Boolean);
  const footer = footerLines.join(" ");
  if (!KIMI_STATUS_BAR_SEGMENT.test(footer)) return false;
  return (
    KIMI_FOOTER_BUSY_BADGE.test(footer) ||
    footerLines.some((line) => hasTruncatedKimiBusyBadge(line))
  );
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
// Narrow panes middle-truncate the hint into `esc...rupt` (or shorter), keeping the
// spinner that precedes it.
const OPENCODE_INTERRUPT_HINT =
  /\besc(?:\s+(?:again\s+to\s+)?interrupt|\s*(?:\.{2,}|…)\s*rupt)(?:\s|$)/i;
// OpenCode 2 draws the running footer's spinner from the `mini.work_spinner`
// setting: block, quadrant, shade, and octant glyphs (Symbols for Legacy
// Computing), or a bracketed fallback when animations are off. The spinner runs
// into the interrupt text without a gap, so do not require whitespace after it.
const OPENCODE_FOOTER_SPINNER =
  /^(?:[\u2580-\u259f\u25a0-\u25ff\u2800-\u28ff\u2b00-\u2bff\u{1ce00}-\u{1ceff}\u{1fb00}-\u{1fbff}·]+|\[⋯\])/u;
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
  if (
    !OPENCODE_INTERRUPT_HINT.test(text) &&
    !OPENCODE_COMMAND_HINT.test(text) &&
    !OPENCODE_FOOTER_SPINNER.test(footer[0] ?? "")
  ) {
    return null;
  }
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
  // The spinner only paints in a running footer. The adjacent hint can be
  // truncated away entirely on narrow panes, so it cannot gate this.
  return footer !== null && OPENCODE_FOOTER_SPINNER.test(footer[0] ?? "");
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
function isAgentBusyScreen(
  lines: string[],
  agent: KnownAgentName,
  antigravityOptions?: AntigravityBusyScreenOptions,
): boolean {
  if (agent === "antigravity") return isAntigravityBusyScreen(lines, antigravityOptions);
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
  if (agent === "antigravity") return isAntigravityNeedsInputScreen(lines);
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
  antigravityOptions?: AntigravityBusyScreenOptions,
): boolean {
  if (isAgentBusyScreen(lines, agent, antigravityOptions)) {
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
  "kimi",
  "muse",
  "opencode",
]);
const PROMOTED_AGENTS = new Set<KnownAgentName>([
  "antigravity",
  "claude",
  "codex",
  "cursor",
  "grok",
  "kimi",
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
  const kimiComposer = findKimiComposer(trimmed);
  if (
    kimiComposer !== null &&
    trimmed.slice(kimiComposer.bottom + 1).some((line) => /\bcontext:\s*\d{1,3}%/i.test(line))
  ) {
    return "kimi";
  }
  const antigravityComposer = findAntigravityComposer(lines);
  if (
    antigravityComposer !== null &&
    !isAntigravityQuitScreen(lines) &&
    trimmed
      .slice(antigravityComposer.bottom + 1)
      .some(
        (line) =>
          ANTIGRAVITY_COMPOSER_FOOTER.test(line) ||
          ANTIGRAVITY_RUNNING_STATUS.test(line) ||
          ANTIGRAVITY_OPEN_WORK.test(line),
      )
  ) {
    return "antigravity";
  }
  if (
    !isAntigravityQuitScreen(lines) &&
    trimmed.some((line) => ANTIGRAVITY_COMPOSER_FOOTER.test(line)) &&
    isAntigravityModalNeedsInput(trimmed.filter((line) => line.length > 0))
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

  // Claude Code 2.1.3xx places its version with a column jump (`Claude Code\x1b[26Gv2.1.316`),
  // so the stripped banner has no space before the `v`.
  if (/\bclaude code(?:\s+v?|v)\d/i.test(stripped) || /✳\s*claude\b/i.test(stripped)) {
    return "claude";
  }
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

type ProgramStatusState = "working" | "blocked" | "done" | "error" | "idle" | "clear";

interface ProgramStatusOsc {
  state: ProgramStatusState | null;
  app: string | null;
  message: string | null;
}

function isProgramStatusState(value: string): value is ProgramStatusState {
  return (
    value === "working" ||
    value === "blocked" ||
    value === "done" ||
    value === "error" ||
    value === "idle" ||
    value === "clear"
  );
}

function decodeProgramStatusMessage(encoded: string): string | null {
  if (encoded.length === 0 || !/^[A-Za-z0-9+/]+=*$/.test(encoded)) {
    return null;
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
  return decoded.length > 0 ? decoded : null;
}

function parseProgramStatusOsc(rawPayload: string): ProgramStatusOsc {
  let state: ProgramStatusState | null = null;
  let app: string | null = null;
  let message: string | null = null;
  for (const segment of rawPayload.trim().split(":")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = segment.slice(0, separator);
    const value = segment.slice(separator + 1);
    if (key === "state" && isProgramStatusState(value)) {
      state = value;
    } else if (key === "app" && value.length > 0) {
      app = value.toLowerCase();
    } else if (key === "msg") {
      message = decodeProgramStatusMessage(value);
    }
  }
  return { state, app, message };
}

export class PtyActivityScanner {
  private activeAgent: KnownAgentName | null = null;
  private currentActivity: TerminalActivityState | null = null;
  private initialLaunch = false;
  private expectsCommandTitle = false;
  private programStatusBlocked = false;
  // Focusing or marking a quota terminal read clears its red badge even while the
  // notice stays in the viewport; suppress re-flagging until a new turn or notice.
  private quotaAcknowledged = false;
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
  private readonly antigravityBusyOptions: AntigravityBusyScreenOptions;
  private readonly stillnessMs: number;

  constructor(options: PtyActivityScannerOptions) {
    this.options = options;
    this.antigravityBusyOptions = {
      areTrayTasksDaemonOnly: options.areAntigravityTrayTasksDaemonOnly,
    };
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
    this.programStatusBlocked = false;
    this.quotaAcknowledged = false;
    this.lookedAtScreen = false;
    this.canProbeScreenForAgent = false;
    this.agentDetectionOutput = "";
    this.titleGuess = false;
    this.titleChecks = 0;
    this.unresolvedWorkingStillness = 0;
    this.lastOutputAt = 0;
    this.options.clearActivity();
  }

  handleAttentionCleared(clearedReason?: TerminalActivityAttentionReason | null): void {
    if (clearedReason === "quota") {
      this.quotaAcknowledged = true;
    }
    if (this.currentActivity === "attention") {
      this.currentActivity = "idle";
    }
  }

  feedInput(input: string): void {
    this.interruptedAt = null;
    if (!this.activeAgent || this.disarmQuitAntigravity()) return;

    if (input === "\r" || input === "\n") {
      this.quotaAcknowledged = false;
      if (this.programStatusBlocked) {
        this.scheduleStillnessCheck();
        return;
      }
      this.initialLaunch = false;
      this.setWorking();
    }
  }

  handleHookActivityChange(): void {
    const observed = this.options.getActivity();
    if (!this.activeAgent) {
      return;
    }
    if (observed.attentionReason === "quota") {
      this.quotaAcknowledged = false;
      this.currentActivity = "attention";
      return;
    }
    if (observed.state !== "working") {
      return;
    }
    this.quotaAcknowledged = false;
    this.initialLaunch = false;
    // Hooks can arrive after the final PTY repaint, when no stillness check remains armed.
    this.scheduleStillnessCheck();
  }

  private adoptProgramStatusAgent(app: string | null): void {
    if (app !== "antigravity" || this.activeAgent) {
      return;
    }
    if (isAntigravityQuitScreen(this.options.readLastLines(20))) {
      return;
    }
    this.activeAgent = "antigravity";
    this.agentDetectionOutput = "";
    this.titleGuess = false;
    this.titleChecks = 0;
    this.initialLaunch = true;
  }

  private scheduleProgramStatusSettlement(): void {
    this.programStatusBlocked = false;
    const observed = this.options.getActivity();
    const hasOpenTurnOrPrompt =
      this.currentActivity === "working" ||
      observed.state === "working" ||
      this.currentActivity === "attention" ||
      observed.attentionReason === "needs_input";
    if (hasOpenTurnOrPrompt) {
      this.initialLaunch = false;
      this.scheduleStillnessCheck();
    }
  }

  handleProgramStatusOsc(rawPayload: string): void {
    const programStatus = parseProgramStatusOsc(rawPayload);
    this.adoptProgramStatusAgent(programStatus.app);
    if (!this.activeAgent || this.disarmQuitAntigravity()) {
      return;
    }

    if (programStatus.state === "working") {
      this.programStatusBlocked = false;
      if (this.isInsideInterruptWindow()) {
        return;
      }
      this.initialLaunch = false;
      this.setWorking();
      return;
    }

    if (programStatus.state === "blocked") {
      this.initialLaunch = false;
      this.unresolvedWorkingStillness = 0;
      this.clearStillnessTimer();
      const lines = this.options.readLastLines(25);
      if (isSpendLimitScreen(lines, this.activeAgent)) {
        this.programStatusBlocked = false;
        this.quotaAcknowledged = false;
        this.currentActivity = "attention";
        this.options.setActivity("attention", "quota");
        return;
      }
      this.programStatusBlocked = true;
      this.currentActivity = "attention";
      this.options.setActivity("attention");
      return;
    }

    if (
      programStatus.state === "error" &&
      programStatus.message !== null &&
      isSpendLimitNoticeLine(programStatus.message)
    ) {
      this.programStatusBlocked = false;
      this.quotaAcknowledged = false;
      this.initialLaunch = false;
      this.currentActivity = "attention";
      this.unresolvedWorkingStillness = 0;
      this.options.setActivity("attention", "quota");
      return;
    }

    if (
      programStatus.state === "done" ||
      programStatus.state === "error" ||
      programStatus.state === "idle" ||
      programStatus.state === "clear"
    ) {
      this.scheduleProgramStatusSettlement();
    }
  }

  handleInterrupt(): void {
    const dismissedNeedsInput =
      (this.activeAgent === "claude" ||
        this.activeAgent === "codex" ||
        this.activeAgent === "antigravity") &&
      this.options.getActivity().attentionReason === "needs_input";
    this.programStatusBlocked = false;
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
      KIMI_MOON_SPINNER_REGEX.test(chunk) ||
      /[■⬝⬥⬩⬪]/.test(chunk) ||
      MUSE_DIAMOND_REGEX.test(chunk) ||
      CLAUDE_SPINNER_REGEX.test(chunk) ||
      chunk.includes("●") ||
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
      (this.shouldPromoteClaudeBusyTitle(chunk) || this.shouldPromoteBrailleSpinner(chunk))
    ) {
      this.setWorking();
    }

    this.promoteWorkingAgentScreen();
    this.scheduleStillnessCheck();
  }

  private shouldPromoteClaudeBusyTitle(chunk: string): boolean {
    if (this.activeAgent !== "claude" || !CLAUDE_BUSY_TITLE_REGEX.test(chunk)) {
      return false;
    }
    // A busy title means no dialog is open, so it also undoes a needs-input hook that
    // landed after the user answered (Claude sends it ~6s after the dialog opens). A
    // hook's finish is left alone: the title still spins while slower Stop hooks run.
    return (
      this.currentActivity !== "working" ||
      this.options.getActivity().attentionReason === "needs_input"
    );
  }

  private shouldPromoteBrailleSpinner(chunk: string): boolean {
    if (
      this.currentActivity === "working" ||
      this.programStatusBlocked ||
      // A parked Grok task keeps a braille clock after Worked for. That frame
      // must not relight a closed turn. A busy Grok screen is promoted below.
      // Antigravity's logo is braille too. A frame only counts once the live
      // screen is actually busy, so a quit banner's scrollback cannot relight.
      this.activeAgent === "opencode" ||
      this.activeAgent === "grok" ||
      !BRAILLE_SPINNER_REGEX.test(chunk) ||
      Boolean(this.options.getActivity().attentionReason)
    ) {
      return false;
    }
    if (
      this.activeAgent === "kimi" &&
      findKimiComposer(this.options.readLastLines(25).map((line) => stripAnsi(line).trim())) !==
        null
    ) {
      return false;
    }
    return (
      this.activeAgent !== "antigravity" ||
      isAntigravityBusyScreen(this.options.readLastLines(20), this.antigravityBusyOptions)
    );
  }

  // A continuously animating live status leaves no quiet gap for the stillness
  // check. Antigravity, Claude, Codex, Cursor, Grok, Kimi, Muse, and OpenCode can resume
  // after an approval without Enter, or start/continue work on their own. Quota stays red
  // until the notice leaves the screen. Grok's live status row (`↓…k [stop]`) is the turn
  // still running after that, so it paints blue without waiting for a quiet gap.
  private promoteWorkingAgentScreen(): void {
    if (
      !this.activeAgent ||
      this.programStatusBlocked ||
      (this.initialLaunch && !PROMOTED_DURING_LAUNCH.has(this.activeAgent)) ||
      this.isInsideInterruptWindow() ||
      !PROMOTED_AGENTS.has(this.activeAgent) ||
      (this.currentActivity === "working" && this.options.getActivity().state === "working") ||
      this.hasOpenCodeHookNeedsInput()
    ) {
      return;
    }
    const lines = this.options.readLastLines(25);
    if (
      this.options.getActivity().attentionReason === "quota" &&
      !(this.activeAgent === "grok" && isGrokLiveStatusScreen(lines))
    ) {
      return;
    }
    if (
      isAgentBusyScreen(lines, this.activeAgent, this.antigravityBusyOptions) &&
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
    this.quotaAcknowledged = false;
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

  private reconcileProgramStatusBlocked(lines: string[]): boolean {
    if (!this.programStatusBlocked) return false;
    if (
      this.activeAgent === "antigravity" &&
      findAntigravityComposer(lines) !== null &&
      !isAntigravityNeedsInputScreen(lines)
    ) {
      this.programStatusBlocked = false;
      return false;
    }
    return true;
  }

  private settleIdleScreen(): void {
    this.unresolvedWorkingStillness = 0;
    if (this.initialLaunch) {
      this.initialLaunch = false;
      this.currentActivity = "idle";
      if (this.options.getActivity().state === null) {
        this.options.clearActivity();
      }
      return;
    }
    if (this.currentActivity === "working" || this.currentActivity === "attention") {
      this.currentActivity = "idle";
      this.options.setActivity("idle");
    }
  }

  private handleStillnessSpendLimit(): void {
    this.programStatusBlocked = false;
    this.unresolvedWorkingStillness = 0;
    if (this.quotaAcknowledged) {
      if (this.currentActivity === "working" || this.currentActivity === "attention") {
        this.currentActivity = "idle";
      }
      return;
    }
    this.currentActivity = "attention";
    this.options.setActivity("attention", "quota");
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
    const programStatusBlocked = this.reconcileProgramStatusBlocked(lines);

    if (
      !openCodeHookNeedsInput &&
      !programStatusBlocked &&
      isAgentBusyScreen(lines, this.activeAgent, this.antigravityBusyOptions) &&
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
      this.handleStillnessSpendLimit();
      return;
    }
    this.quotaAcknowledged = false;

    // OpenCode's parent composer goes idle while background sessions keep
    // running. Its plugin aggregates their status under the root session id;
    // that owned hook state ends only when the plugin reports a terminal state.
    if (openCodeHookNeedsInput || this.hasOpenCodeHookWork(lines)) {
      this.unresolvedWorkingStillness = 0;
      return;
    }

    if (
      !programStatusBlocked &&
      isIdleAgentScreen(
        lines,
        this.options.readCursorLine(),
        this.activeAgent,
        this.antigravityBusyOptions,
      )
    ) {
      this.settleIdleScreen();
      return;
    }

    if (programStatusBlocked || isAgentNeedsInputScreen(lines, this.activeAgent)) {
      this.initialLaunch = false;
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
    this.programStatusBlocked = false;
    this.quotaAcknowledged = false;
  }
}
