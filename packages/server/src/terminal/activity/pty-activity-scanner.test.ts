import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectAgentFromCommand,
  detectAgentFromOutput,
  detectAgentFromTitle,
  isAntigravityBusyScreen,
  isCodexBusyScreen,
  isIdleAgentScreen,
  isIdlePromptLine,
  isNeedsInputScreen,
  isSpendLimitScreen,
  KNOWN_AGENT_NAMES,
  PtyActivityScanner,
} from "./pty-activity-scanner.js";
import { TerminalActivityTracker } from "./terminal-activity-tracker.js";

describe("detectAgentFromCommand", () => {
  it("detects Claude Code commands", () => {
    expect(detectAgentFromCommand("claude")).toBe("claude");
    expect(detectAgentFromCommand("claude --dangerously-skip-permissions")).toBe("claude");
    expect(detectAgentFromCommand("/Users/test/.local/bin/claude")).toBe("claude");
    expect(detectAgentFromCommand("npx @anthropic-ai/claude-code")).toBe("claude");
  });

  it("detects Codex commands", () => {
    expect(detectAgentFromCommand("codex")).toBe("codex");
    expect(detectAgentFromCommand("codex exec")).toBe("codex");
    expect(detectAgentFromCommand("/usr/local/bin/codex")).toBe("codex");
  });

  it("detects Grok commands", () => {
    expect(detectAgentFromCommand("grok")).toBe("grok");
    expect(detectAgentFromCommand("grok build")).toBe("grok");
  });

  it("detects Antigravity commands", () => {
    expect(detectAgentFromCommand("agy")).toBe("antigravity");
    expect(detectAgentFromCommand("antigravity")).toBe("antigravity");
    expect(detectAgentFromCommand("/Users/test/.local/bin/agy")).toBe("antigravity");
  });

  it("detects OpenCode, Pi, Copilot, Cursor, Gemini, Amp", () => {
    expect(detectAgentFromCommand("opencode")).toBe("opencode");
    expect(detectAgentFromCommand("pi")).toBe("pi");
    expect(detectAgentFromCommand("pi /path")).toBe("pi");
    expect(detectAgentFromCommand("copilot")).toBe("copilot");
    expect(detectAgentFromCommand("cursor")).toBe("cursor");
    expect(detectAgentFromCommand("gemini")).toBe("gemini");
    expect(detectAgentFromCommand("amp")).toBe("amp");
  });

  it("returns null for non-agent commands", () => {
    expect(detectAgentFromCommand("zsh")).toBeNull();
    expect(detectAgentFromCommand("bash")).toBeNull();
    expect(detectAgentFromCommand("ls -la")).toBeNull();
    expect(detectAgentFromCommand("git status")).toBeNull();
    expect(detectAgentFromCommand("npm run dev")).toBeNull();
    expect(detectAgentFromCommand("cat file.txt")).toBeNull();
    expect(detectAgentFromCommand("cat claude-notes.md")).toBeNull();
    expect(detectAgentFromCommand("npm run opencode-tests")).toBeNull();
    expect(detectAgentFromCommand("antigravity-project")).toBeNull();
    expect(detectAgentFromCommand(undefined)).toBeNull();
  });
});

describe("detectAgentFromTitle", () => {
  it("detects agent-owned display titles", () => {
    expect(detectAgentFromTitle("✳ Claude Code")).toBe("claude");
    expect(detectAgentFromTitle("OpenAI Codex")).toBe("codex");
    expect(detectAgentFromTitle("Google Antigravity")).toBe("antigravity");
    expect(detectAgentFromTitle("Cursor Agent")).toBe("cursor");
  });

  it("ignores shell working-directory titles", () => {
    expect(detectAgentFromTitle("~/src/claude-code")).toBeNull();
    expect(detectAgentFromTitle("~/Projects/cursor")).toBeNull();
    expect(detectAgentFromTitle("/tmp/opencode")).toBeNull();
  });
});

describe("detectAgentFromOutput", () => {
  it("detects startup banners from output chunks", () => {
    expect(detectAgentFromOutput("Claude Code v2.1.278")).toBe("claude");
    expect(detectAgentFromOutput("\x1b[32m✳ Claude\x1b[0m is ready")).toBe("claude");
    expect(detectAgentFromOutput("OpenAI Codex v0.155.1")).toBe("codex");
    expect(detectAgentFromOutput("Welcome to Grok Build")).toBe("grok");
    expect(detectAgentFromOutput("Welcome to the Antigravity CLI")).toBe("antigravity");
    expect(detectAgentFromOutput("OpenCode v1.18.31")).toBe("opencode");
    expect(detectAgentFromOutput("  Cursor Agent\r\n  v2026.09.18-9a7762b")).toBe("cursor");
  });

  it("returns null for ordinary output", () => {
    expect(detectAgentFromOutput("total 24\ndrwxr-xr-x 2 user staff")).toBeNull();
    expect(detectAgentFromOutput("hello world")).toBeNull();
  });
});

describe("isSpendLimitScreen", () => {
  it("detects real spend limit notices", () => {
    const screen = [
      "Ran 1 shell command",
      "  You've hit your monthly spend limit · resets 3pm",
      "/usage-credits to adjust",
    ];
    expect(isSpendLimitScreen(screen)).toBe(true);
  });

  it("detects the Claude, Codex, and other harness banners", () => {
    expect(
      isSpendLimitScreen([
        "You’ve hit your monthly spend limit · raise it at",
        "claude.ai/settings/usage?from=cc_cli_limit_message · your session limit resets",
        "7:10pm (Europe/Ljubljana)",
      ]),
    ).toBe(true);
    expect(
      isSpendLimitScreen([
        "[System Error] You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage",
      ]),
    ).toBe(true);
    expect(isSpendLimitScreen(["API rate limit reached"])).toBe(true);
    expect(isSpendLimitScreen(["Insufficient quota."])).toBe(true);
    expect(isSpendLimitScreen(["You are out of credits. Upgrade to continue."])).toBe(true);
    expect(isSpendLimitScreen(["You are out of quota. Stop."])).toBe(true);
    expect(isSpendLimitScreen(["Credit balance is too low"])).toBe(true);
  });

  it("ignores code discussing limits", () => {
    const screen = [
      "Fixed rate limiting in request router",
      'const message = "monthly spend limit";',
      "export const LIMIT = 100;",
      "Testing error handlers",
    ];
    expect(isSpendLimitScreen(screen)).toBe(false);
  });
});

describe("isNeedsInputScreen", () => {
  it("detects [y/N] confirmation prompts", () => {
    expect(isNeedsInputScreen(["Allow Claude to run `npm test`? [y/N]"])).toBe(true);
    expect(isNeedsInputScreen(["Do you want to proceed? [Y/n]"])).toBe(true);
    expect(isNeedsInputScreen(["Apply these changes? (y/n)"])).toBe(true);
    expect(isNeedsInputScreen(["Allow agy to run git status? [y/N]"])).toBe(true);
  });

  it("detects permission prompts", () => {
    expect(isNeedsInputScreen(["Permission required to run command"])).toBe(true);
    expect(isNeedsInputScreen(["Approve execution of shell command?"])).toBe(true);
  });

  it("detects interactive choice prompts", () => {
    expect(
      isNeedsInputScreen(["Allow command?", "❯ 1. Yes, run this command (y)", "  2. No"]),
    ).toBe(true);
    expect(isNeedsInputScreen(["? What would you like to do?", "❯ Continue", "  Exit"])).toBe(true);
  });

  it("ignores Claude's composer while the turn runs", () => {
    const rule = "─".repeat(60);
    expect(
      isNeedsInputScreen([
        "✻ Waiting for 1 dynamic workflow to finish",
        "                        ✘ Auto-update failed · Run claude doctor",
        `${rule} ultracode ─`,
        "❯\u00a0continue",
        rule,
        "  branch:master | !28 ?5",
        "  [OMC#5.5.0L] | Model: Opus 5.5",
        "  thinking | session:800m | ctx:[#####-----]45% | 🔧125",
        "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 2 agents",
        "",
        "  ◯ anya-codex-parity-core 1/4 agents done · 21m 53s · ↓ 844.3k",
      ]),
    ).toBe(false);
  });

  it("ignores approval words typed into Claude's composer", () => {
    const rule = "─".repeat(60);
    expect(
      isNeedsInputScreen([
        "✻ Worked for 2m 42s",
        rule,
        "❯\u00a0please confirm the build passes and allow the migration",
        rule,
        "  branch:master | !28 ?5",
        "  ⏵⏵ bypass permissions on (shift+tab to cycle)",
      ]),
    ).toBe(false);
  });

  it("ignores a queued message above Claude's composer", () => {
    const rule = "─".repeat(60);
    expect(
      isNeedsInputScreen([
        "✻ Waiting for 1 dynamic workflow to finish",
        "❯ continue once the workflow is done",
        rule,
        "❯\u00a0",
        rule,
        "  branch:master | !28 ?5",
      ]),
    ).toBe(false);
  });

  it("detects a numbered approval menu inside a ruled dialog", () => {
    const rule = "─".repeat(60);
    expect(
      isNeedsInputScreen([
        rule,
        " Bash command",
        "   rm -rf build",
        " Do you want to proceed?",
        " ❯ 1. Yes",
        "   2. No, and tell Claude what to do differently (esc)",
      ]),
    ).toBe(true);
  });

  it("detects shortcut bars", () => {
    expect(isNeedsInputScreen(["Enter to accept · Esc to cancel"])).toBe(true);
  });

  it("detects the Antigravity workspace trust screen", () => {
    expect(
      isNeedsInputScreen([
        "Accessing workspace:",
        "/Users/test/project",
        "Do you trust the contents of this project?",
        "Antigravity CLI requires permission to read, edit, and execute files here.",
        "> Yes, I trust this folder",
        "  No, exit",
        "  ↑/↓ Navigate · enter Confirm",
      ]),
    ).toBe(true);
  });

  it("does not false-positive on ordinary text", () => {
    expect(isNeedsInputScreen(["Fixed permission bug in test suite", "Passed all tests"])).toBe(
      false,
    );
    expect(isNeedsInputScreen(["The coordinates are (x,y)", "Result: 42"])).toBe(false);
  });
});

describe("isIdlePromptLine", () => {
  it("detects Claude prompt (❯)", () => {
    expect(isIdlePromptLine("❯", "claude")).toBe(true);
    expect(isIdlePromptLine("❯ ", "claude")).toBe(true);
  });

  it("detects Codex prompt (›)", () => {
    expect(isIdlePromptLine("›", "codex")).toBe(true);
    expect(isIdlePromptLine("codex ›", "codex")).toBe(true);
  });

  it("detects Codex's composer with its placeholder or a draft", () => {
    expect(isIdlePromptLine("› Ask Codex to do anything", "codex")).toBe(true);
    expect(isIdlePromptLine("› fix the flaky test", "codex")).toBe(true);
    expect(isIdlePromptLine("› 1. Yes, proceed (y)", "codex")).toBe(false);
  });

  it("detects Grok prompt (grok> or >)", () => {
    expect(isIdlePromptLine("grok>", "grok")).toBe(true);
    expect(isIdlePromptLine(">", "grok")).toBe(true);
  });

  it("detects Antigravity prompt (>)", () => {
    expect(isIdlePromptLine(">", "antigravity")).toBe(true);
  });

  it("does not match prose ending in a prompt character", () => {
    expect(isIdlePromptLine("const tag = <Widget>", "antigravity")).toBe(false);
    expect(isIdlePromptLine("still working…", "claude")).toBe(false);
  });
});

describe("isIdleAgentScreen", () => {
  it("detects Cursor's empty composer with its hidden cursor", () => {
    expect(
      isIdleAgentScreen(
        [
          "▄▄▄▄▄▄▄▄",
          "  → Plan, search, build anything",
          "▀▀▀▀▀▀▀▀",
          "  GPT-5.6 Sol 1M Extra High · MAX",
        ],
        "",
        "cursor",
      ),
    ).toBe(true);
  });

  it("does not treat Cursor's submitted composer as idle", () => {
    expect(
      isIdleAgentScreen(
        ["  → Plan, search, build anything", "▄▄▄▄▄▄▄▄", "  → Reply with OK only.", "▀▀▀▀▀▀▀▀"],
        "",
        "cursor",
      ),
    ).toBe(false);
  });

  it("does not treat Codex's composer as idle while its status line shows a running turn", () => {
    const busy = [
      "• Working (12s • esc to interrupt)",
      " ",
      "› Ask Codex to do anything",
      "  GPT-6-Sol low · weekly 69% left",
    ];
    const finished = [
      "─ Worked for 48m 54s ─",
      "• Press esc to interrupt a running turn.",
      "› Ask Codex to do anything",
      "  GPT-6-Sol low · weekly 69% left",
    ];

    expect(isCodexBusyScreen(busy)).toBe(true);
    expect(isIdleAgentScreen(busy, "› Ask Codex to do anything", "codex")).toBe(false);
    expect(isCodexBusyScreen(finished)).toBe(false);
    expect(isIdleAgentScreen(finished, "› Ask Codex to do anything", "codex")).toBe(true);
  });

  it("reads only the status line above Codex's composer", () => {
    expect(
      isCodexBusyScreen([
        "• Planning the fix (1m 02s • esc to interrupt) · Running hooks",
        "› queued follow-up",
      ]),
    ).toBe(true);
    // A finished reply that quotes the status line, higher up or inline, is not a running turn.
    expect(
      isCodexBusyScreen([
        '+      "• Working (12s • esc to interrupt)",',
        "• Added the check. It matches `• Working (12s • esc to interrupt)` lines.",
        "› Ask Codex to do anything",
      ]),
    ).toBe(false);
    expect(isCodexBusyScreen(["• Working (12s • esc to interrupt)"])).toBe(false);
  });

  it("prefers Cursor's approval prompt over a stale empty composer", () => {
    expect(
      isIdleAgentScreen(
        ["  → Plan, search, build anything", "Allow Cursor to run this command? [y/N]"],
        "",
        "cursor",
      ),
    ).toBe(false);
  });
});

describe("PtyActivityScanner — full lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks Claude Code lifecycle from launch to finished turn", () => {
    const tracker = new TerminalActivityTracker();
    let screenLines: string[] = [];
    let cursorLine = "";

    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => cursorLine,
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    expect(tracker.getSnapshot().state).toBeNull();

    screenLines = ["Claude Code v2.1", "❯"];
    cursorLine = "❯";
    scanner.feedOutput("Claude Code v2.1\n❯ ");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot().state).toBeNull();

    scanner.feedInput("refactor parser");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");
    expect(tracker.getSnapshot().attentionReason).toBeNull();

    scanner.feedOutput("⠋ Thinking...\n");
    vi.advanceTimersByTime(300);
    expect(tracker.getSnapshot().state).toBe("working");

    screenLines = ["I need to run tests.", "Allow Claude to run `npm test`? [y/N]"];
    cursorLine = "Allow Claude to run `npm test`? [y/N]";
    scanner.feedOutput("Allow Claude to run `npm test`? [y/N]\n");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "needs_input",
    });

    scanner.feedInput("y");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");
    expect(tracker.getSnapshot().attentionReason).toBeNull();

    screenLines = ["Please confirm the project builds.", "Tests passed!", "❯"];
    cursorLine = "❯";
    scanner.feedOutput("Tests passed!\n❯ ");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });

    expect(tracker.clearAttention()).toBe(true);
    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: null,
    });

    scanner.handleCommandFinished();
    expect(tracker.getSnapshot().state).toBeNull();
  });

  it("returns Claude to working when its title shows a running turn after a needs-input stop", () => {
    const tracker = new TerminalActivityTracker();
    let screenLines: string[] = [];
    let cursorLine = "";
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => cursorLine,
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    scanner.feedInput("\r");
    screenLines = [
      "Bash command",
      "  npm test",
      "Do you want to proceed?",
      "❯ 1. Yes",
      "  2. No",
      "Esc to cancel",
    ];
    cursorLine = "❯ 1. Yes";
    scanner.feedOutput("\x1b]0;✳ Claude Code\x07Do you want to proceed?");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });

    // Claude's numbered menu takes "1" without Enter, so no lone "\r" reaches feedInput.
    scanner.feedInput("1");
    scanner.feedOutput("\x1b]0;◐ Claude Code\x07✻ Levitating… (1s)");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("keeps a Claude approval orange while its title stays idle", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["Do you want to proceed?", "❯ 1. Yes", "  2. No"],
      readCursorLine: () => "❯ 1. Yes",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    scanner.feedInput("\r");
    scanner.feedOutput("Do you want to proceed?");
    vi.advanceTimersByTime(500);
    scanner.feedOutput("\x1b]0;✳ Claude Code\x07");

    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
  });

  it("tracks Codex approval and completion", () => {
    const tracker = new TerminalActivityTracker();
    let screenLines: string[] = [];
    let cursorLine = "";

    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => cursorLine,
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex");

    scanner.feedInput("implement feature");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    screenLines = ["Proposed changes:", "Do you want to proceed? [Y/n]"];
    scanner.feedOutput("Do you want to proceed? [Y/n]\n");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "needs_input",
    });

    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    screenLines = ["All done.", "›"];
    cursorLine = "›";
    scanner.feedOutput("› ");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });
  });

  it("finishes a Codex turn at its placeholder composer", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => [
        "• DONE",
        "› Ask Codex to do anything",
        "  GPT-6-Sol low · weekly 69% left",
      ],
      readCursorLine: () => "› Ask Codex to do anything",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex");
    scanner.feedInput("\r");
    scanner.feedOutput("• DONE");
    vi.advanceTimersByTime(1500);

    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("keeps a Codex turn working while its status line shows above the composer", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => [
        "• Working (12s • esc to interrupt)",
        " ",
        "› Ask Codex to do anything",
        "  GPT-6-Sol low · weekly 69% left",
      ],
      readCursorLine: () => "› Ask Codex to do anything",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex");
    scanner.feedInput("\r");
    scanner.feedOutput("• Working (12s • esc to interrupt)");
    vi.advanceTimersByTime(2500);

    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("does not finish an interrupted Codex turn on a late spinner frame", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => [
        "■ Conversation interrupted - tell the model what to do differently.",
        "› Ask Codex to do anything",
      ],
      readCursorLine: () => "› Ask Codex to do anything",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex");
    scanner.feedInput("\r");
    tracker.interrupt();
    scanner.handleInterrupt();
    // Codex keeps animating its title until it processes the Esc.
    scanner.feedOutput("\x1b]0;⠹ Run ls\x07");
    vi.advanceTimersByTime(1500);

    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });

    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("ignores Claude's late busy title after an interrupt but lights a later turn", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["⎿ Interrupted · What should Claude do instead?", "❯"],
      readCursorLine: () => "❯",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    scanner.feedInput("\r");
    tracker.interrupt();
    scanner.handleInterrupt();
    scanner.feedOutput("\x1b]0;◐ Fixing the test\x07");
    vi.advanceTimersByTime(1500);

    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });

    // A background task finishing later starts a turn with no keystroke.
    vi.advanceTimersByTime(5000);
    scanner.feedOutput("\x1b]0;◑ Checking the render\x07");
    expect(tracker.getSnapshot().state).toBe("working");
    scanner.feedOutput("\x1b]0;✳ Claude Code\x07");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("keeps a hook-reported approval when the screen settles without a prompt", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["$ rm -rf build"],
      readCursorLine: () => "$ rm -rf build",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex");
    scanner.feedInput("\r");
    tracker.set("attention");
    scanner.feedOutput("$ rm -rf build");
    vi.advanceTimersByTime(2000);

    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
  });

  it("keeps a hook-reported finish when the screen settles without a prompt", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["─ Worked for 48m 54s ─"],
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex");
    scanner.feedInput("\r");
    tracker.set("idle");
    scanner.feedOutput("─ Worked for 48m 54s ─");
    vi.advanceTimersByTime(1500);

    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("settles working that a hook reports after the turn ended", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["• Completed `/root/sleep_then_ls`", "› Ask Codex to do anything"],
      readCursorLine: () => "› Ask Codex to do anything",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex");
    scanner.feedInput("\r");
    scanner.feedOutput("• DONE");
    vi.advanceTimersByTime(500);
    expect(tracker.clearAttention()).toBe(true);

    // A subagent that outlived the turn runs tool hooks, and Codex sends no Stop for it.
    tracker.set("working");
    scanner.feedOutput("• Completed `/root/sleep_then_ls`");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("clears hook-reported working that never reaches a prompt", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["still going"],
      readCursorLine: () => "still going",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex");
    tracker.set("working");
    scanner.feedOutput("still going");
    vi.advanceTimersByTime(1000);
    expect(tracker.getSnapshot().state).toBe("working");

    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBeNull();
  });

  it("uses shell command boundaries without treating a working directory as an agent", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => [],
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.handleTitleChange("~/src/claude-code");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBeNull();

    scanner.handleCommandStarted();
    scanner.handleTitleChange("/Users/test/.local/bin/agy");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");
  });

  it.each(["~/project", "user@host: ~/project", "user@host: /home/user/project"])(
    "disarms a banner-detected agent when shell title %s returns",
    (shellTitle) => {
      const tracker = new TerminalActivityTracker();
      const scanner = new PtyActivityScanner({
        setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
        clearActivity: () => tracker.clear(),
        getActivity: () => tracker.getSnapshot(),
        readLastLines: () => [],
        readCursorLine: () => "",
        stillnessMs: 500,
      });

      scanner.feedOutput("Welcome to the Antigravity CLI");
      scanner.handleTitleChange(shellTitle);
      scanner.feedInput("\r");

      expect(tracker.getSnapshot().state).toBeNull();
    },
  );

  it("starts working when the spawn command already includes a prompt", () => {
    const tracker = new TerminalActivityTracker();
    let cursorLine = "Refactoring parser";
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["Refactoring parser"],
      readCursorLine: () => cursorLine,
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude -p refactor the parser");
    expect(tracker.getSnapshot().state).toBe("working");

    cursorLine = "❯";
    scanner.feedOutput("done\n❯ ");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });
  });

  it("starts working for Codex exec without waiting for Enter", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => [],
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex exec implement feature");

    expect(tracker.getSnapshot().state).toBe("working");
  });

  it("does not start working for an interactive agent launch", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => [],
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude --dangerously-skip-permissions");
    scanner.handleInitialCommand("pnpm exec claude");

    expect(tracker.getSnapshot().state).toBeNull();
  });

  it("clears a working turn that never reaches a prompt", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["running long task", "still going"],
      readCursorLine: () => "still going",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    scanner.feedOutput("running long task\n");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBe("working");

    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBe("working");

    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBeNull();
  });

  it("clears a working turn that produces no further output", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["Welcome to the Antigravity CLI"],
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("agy");
    scanner.feedOutput("Welcome to the Antigravity CLI\n");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBeNull();

    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBe("working");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBe("working");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBeNull();
  });

  it("does not treat multiline pasted input as prompt submission", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => [],
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    scanner.feedInput("first line\nsecond line");

    expect(tracker.getSnapshot().state).toBeNull();
  });

  it("preserves hook-reported finished attention while the initial prompt settles", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["Done", "❯"],
      readCursorLine: () => "❯",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    tracker.set("working");
    tracker.set("idle");
    scanner.feedOutput("Done\n❯ ");
    vi.advanceTimersByTime(500);
    scanner.feedOutput("⠋");

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });
  });

  it("tracks Cursor Agent through its boxed composer states", () => {
    const tracker = new TerminalActivityTracker();
    let screenLines = ["Cursor Agent", "v2026.09.18-9a7762b", "  → Plan, search, build anything"];
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.handleTitleChange("Cursor Agent");
    scanner.feedOutput("  Cursor Agent\r\n  v2026.09.18-9a7762b");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBeNull();

    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    screenLines = ["Cursor Agent", "  → Reply with OK only."];
    scanner.feedOutput("Working");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBe("working");

    screenLines = ["Allow Cursor to run this command? [y/N]"];
    scanner.feedOutput("Allow Cursor to run this command? [y/N]");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "needs_input",
    });

    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    screenLines = ["OK", "  → Plan, search, build anything"];
    scanner.feedOutput("OK");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });
  });

  it("detects Grok Build and Antigravity CLIs", () => {
    const tracker = new TerminalActivityTracker();
    let screenLines: string[] = [];
    let cursorLine = "";

    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => cursorLine,
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("grok");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    screenLines = ["Response from Grok", "grok>"];
    cursorLine = "grok>";
    scanner.feedOutput("grok> ");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });

    scanner.handleCommandFinished();

    scanner.handleInitialCommand("agy");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    screenLines = ["Antigravity completed.", ">"];
    cursorLine = ">";
    scanner.feedOutput("> ");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });
  });

  it("keeps Antigravity working while its status line still shows a running task", () => {
    const tracker = new TerminalActivityTracker();
    let screenLines = [
      "Investigating storage.",
      ">",
      "[16:31:22] du -sh /Users/legoless/Library/Developer/Xcode/DerivedData  running",
      "Gemini 3.8 Flash · high · 1 task(s) · /tasks",
    ];
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => ">",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("agy");
    scanner.feedInput("\r");
    scanner.feedOutput("running");
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(500);

    expect(isAntigravityBusyScreen(screenLines)).toBe(true);
    expect(isIdleAgentScreen(screenLines, ">", "antigravity")).toBe(false);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    screenLines = ["Done.", ">"];
    scanner.feedOutput(">");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });
  });

  it("handles Ctrl-C interrupt immediately", () => {
    const tracker = new TerminalActivityTracker();
    let screenLines: string[] = [];

    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    tracker.interrupt();
    scanner.handleInterrupt();

    expect(tracker.getSnapshot().state).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(tracker.getSnapshot().state).toBeNull();
  });

  it("detects spend limit banner and alerts", () => {
    const tracker = new TerminalActivityTracker();
    let screenLines: string[] = [];

    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    screenLines = ["Ran 1 shell command", "You've hit your monthly spend limit · resets 3pm"];
    scanner.feedOutput("limit hit\n");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "quota",
    });
  });

  it.each(KNOWN_AGENT_NAMES)(
    "keeps a %s spend limit red after the turn settles at the prompt",
    (agent) => {
      const tracker = new TerminalActivityTracker();
      let screenLines: string[] = [];
      const scanner = new PtyActivityScanner({
        setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
        clearActivity: () => tracker.clear(),
        getActivity: () => tracker.getSnapshot(),
        readLastLines: () => screenLines,
        readCursorLine: () => (agent === "codex" ? "›" : ">"),
        stillnessMs: 500,
      });

      let command: string = agent;
      if (agent === "antigravity") command = "agy";
      if (agent === "cursor") command = "cursor-agent";
      scanner.handleInitialCommand(command);
      scanner.feedInput("\r");
      expect(tracker.getSnapshot().state).toBe("working");

      screenLines = [
        "You've hit your monthly spend limit · resets 7:10pm",
        agent === "codex" ? "›" : ">",
      ];
      scanner.feedOutput("limit\n");
      vi.advanceTimersByTime(500);

      expect(tracker.getSnapshot()).toMatchObject({
        state: "idle",
        attentionReason: "quota",
      });

      // A Stop hook reporting idle must not repaint the pane green.
      tracker.set("idle");
      expect(tracker.getSnapshot().attentionReason).toBe("quota");
    },
  );
});
