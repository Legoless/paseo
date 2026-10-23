import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectAgentFromCommand,
  detectAgentFromOutput,
  detectAgentFromTitle,
  isAntigravityBusyScreen,
  isClaudeBusyScreen,
  isCodexBusyScreen,
  isCursorBusyScreen,
  isCursorNeedsInputScreen,
  isGeminiBusyScreen,
  isGrokBusyScreen,
  isIdleAgentScreen,
  isIdlePromptLine,
  isKimiBusyScreen,
  isMuseBusyScreen,
  isMuseNeedsInputScreen,
  isOpenCodeBusyScreen,
  isOpenCodeNeedsInputScreen,
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
    expect(detectAgentFromCommand("cursor-agent")).toBe("cursor");
    expect(detectAgentFromCommand("agent")).toBe("cursor");
    expect(detectAgentFromCommand("agent --resume")).toBe("cursor");
    expect(detectAgentFromCommand("gemini")).toBe("gemini");
    expect(detectAgentFromCommand("amp")).toBe("amp");
  });

  it("detects Kimi commands", () => {
    expect(detectAgentFromCommand("kimi")).toBe("kimi");
    expect(detectAgentFromCommand("kimi --yolo")).toBe("kimi");
    expect(detectAgentFromCommand("/Users/test/.kimi-code/bin/kimi")).toBe("kimi");
    expect(detectAgentFromCommand("kimi-code")).toBe("kimi");
  });

  it("detects Muse's launcher and release-named native binary", () => {
    expect(detectAgentFromCommand("muse")).toBe("muse");
    expect(detectAgentFromCommand("muse exec 'inspect this repository'")).toBe("muse");
    expect(detectAgentFromCommand("/Users/test/.local/bin/muse --resume latest")).toBe("muse");
    expect(detectAgentFromCommand("env MUSE_HOME=/tmp/muse muse")).toBe("muse");
    expect(detectAgentFromCommand("/tmp/muse/muse-bin-1.4.6-R6000.1")).toBe("muse");
    expect(detectAgentFromCommand("cat muse-notes.md")).toBeNull();
    expect(detectAgentFromCommand("muse-bin-notes")).toBeNull();
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
    expect(detectAgentFromTitle("codex")).toBe("codex");
    expect(detectAgentFromTitle("OpenAI Codex v0.155.1")).toBe("codex");
    expect(detectAgentFromTitle("Codex Session")).toBeNull();
    expect(detectAgentFromTitle("Codex Session Audit")).toBeNull();
    expect(detectAgentFromTitle("Google Antigravity")).toBe("antigravity");
    expect(detectAgentFromTitle("Cursor Agent")).toBe("cursor");
    expect(detectAgentFromTitle("Muse Code 1.4.6")).toBe("muse");
  });

  it("ignores shell working-directory titles", () => {
    expect(detectAgentFromTitle("~/src/claude-code")).toBeNull();
    expect(detectAgentFromTitle("~/Projects/cursor")).toBeNull();
    expect(detectAgentFromTitle("/tmp/opencode")).toBeNull();
    expect(detectAgentFromTitle("~/Projects/muse")).toBeNull();
    expect(detectAgentFromTitle("⠋ muse-project")).toBeNull();
  });
});

describe("detectAgentFromOutput", () => {
  it("detects startup banners from output chunks", () => {
    expect(detectAgentFromOutput("Claude Code v2.1.278")).toBe("claude");
    expect(detectAgentFromOutput("\x1b[32m✳ Claude\x1b[0m is ready")).toBe("claude");
    expect(detectAgentFromOutput("OpenAI Codex v0.155.1")).toBe("codex");
    expect(detectAgentFromOutput("Welcome to Grok Build")).toBe("grok");
    expect(detectAgentFromOutput("Grok 4.7 (xhigh) · always-approve")).toBe("grok");
    expect(detectAgentFromOutput("Welcome to the Antigravity CLI")).toBe("antigravity");
    expect(detectAgentFromOutput("OpenCode v1.18.31")).toBe("opencode");
    expect(detectAgentFromOutput("  Cursor Agent\r\n  v2026.09.18-9a7762b")).toBe("cursor");
    expect(
      detectAgentFromOutput(
        [
          "OpenAI Codex v0.155.1",
          "Editing merge.py",
          "→ Add a follow-up",
          "ctrl+c to stop",
          "Claude Opus 5.5 1M Extra High · MAX · 60% · 60 files edited",
          "Run Everything",
        ].join("\n"),
      ),
    ).toBe("cursor");
    expect(
      detectAgentFromOutput(
        ["→ Plan, search, build anything", "GPT-5.6 Sol 1M Extra High · MAX"].join("\n"),
      ),
    ).toBe("cursor");
    expect(detectAgentFromOutput("→ Add a follow-up")).toBeNull();
    expect(detectAgentFromOutput("ctrl+c to stop")).toBeNull();
    expect(detectAgentFromOutput("Run Everything")).toBeNull();
    expect(detectAgentFromOutput("▐█▛█▛█▌  Welcome to Kimi Code!")).toBe("kimi");
    expect(detectAgentFromOutput("\x1b[1mMuse Code 1.4.6\x1b[0m")).toBe("muse");
    expect(
      detectAgentFromOutput(
        "Ask When Needed  K3 thinking: max  ~/proj  main  context: 29% (290k/1M)",
      ),
    ).toBe("kimi");
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

  it("recognizes Cursor's account usage notice without matching source errors", () => {
    expect(isSpendLimitScreen(["You're out of usage. Switch to Auto."])).toBe(true);
    expect(isSpendLimitScreen(["You’re out of usage. Switch to Auto."])).toBe(true);
    expect(isSpendLimitScreen(["You are out of usage. Switch to Auto."])).toBe(true);
    expect(isSpendLimitScreen(['throw new Error("You\'re out of usage")'])).toBe(false);
    expect(isSpendLimitScreen(["Error: Increase limits for faster responses"])).toBe(false);
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

  it("ignores a Grok draft under the always-approve footer", () => {
    const screen = [
      "Can you commit and push everything codex did?",
      "I did not re-run the test suites.",
      "Worked for 4m4s",
      "╭────────────────────╮",
      "❯ So lets continue one the",
      "Grok 4.7 (xhigh) · always-approve",
      "Enter:send  Shift+Tab: mode",
    ];
    expect(isNeedsInputScreen(screen)).toBe(false);
    expect(isIdleAgentScreen(screen, "❯ So lets continue one the", "grok")).toBe(true);
  });

  it("ignores Grok's startup tip and always-approve footer", () => {
    const screen = [
      "Grok Build 1.0.60",
      "",
      "New worktree",
      "Resume session",
      "Changelog",
      "Quit",
      "",
      "Tip: Run /compact [context] when chat gets long.",
      "",
      "> ",
      "╰────────────────────── Grok 4.7 (xhigh) · always-approve ─╯",
      "[stable]",
    ];
    expect(isNeedsInputScreen(screen)).toBe(false);
    expect(isIdleAgentScreen(screen, ">", "grok")).toBe(true);
  });

  it("keeps a Grok approval card above the composer", () => {
    expect(
      isNeedsInputScreen([
        "Do you want to proceed?",
        "❯ Allow once",
        "  Always allow this command",
        "  Reject",
        "╭────────────────────╮",
        "❯ So lets continue one the",
        "Grok 4.7 (xhigh) · always-approve",
      ]),
    ).toBe(true);
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

  it("detects Grok prompt (grok>, >, or ❯)", () => {
    expect(isIdlePromptLine("grok>", "grok")).toBe(true);
    expect(isIdlePromptLine(">", "grok")).toBe(true);
    expect(isIdlePromptLine("❯", "grok")).toBe(true);
    expect(isIdlePromptLine("❯ ", "grok")).toBe(true);
  });

  it("detects Antigravity prompt (>)", () => {
    expect(isIdlePromptLine(">", "antigravity")).toBe(true);
  });

  it("detects Kimi's boxed composer (│ > …)", () => {
    expect(isIdlePromptLine("│ >", "kimi")).toBe(true);
    expect(isIdlePromptLine("│ > draft text", "kimi")).toBe(true);
    expect(isIdlePromptLine("│ >", "kimi")).toBe(true);
    // Approval options and bare prompts are not the composer.
    expect(isIdlePromptLine("> Allow once", "kimi")).toBe(false);
    expect(isIdlePromptLine(">", "kimi")).toBe(false);
    expect(isIdlePromptLine("", "kimi")).toBe(false);
    expect(isIdlePromptLine("still working…", "kimi")).toBe(false);
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

  it("keeps Kimi working while its status bar shows a running background task", () => {
    const composer = ["╭──────╮", "│ >", "╰──────╯"];
    const running = [
      ...composer,
      "Ask When Needed  K3 thinking: max  [1 task running]  ~/proj  main",
    ];
    const runningWrapped = [
      ...composer,
      "Ask When Needed  K3 thinking: max  [2 tasks running]",
      "context: 29% (290k/1M)",
    ];
    const settled = [...composer, "Ask When Needed  K3 thinking: max  ~/proj  main"];

    expect(isKimiBusyScreen(running)).toBe(true);
    expect(isKimiBusyScreen(runningWrapped)).toBe(true);
    expect(isIdleAgentScreen(running, "│ > ", "kimi")).toBe(false);
    expect(isKimiBusyScreen(settled)).toBe(false);
    expect(isIdleAgentScreen(settled, "│ > ", "kimi")).toBe(true);
  });

  it("ignores a Kimi reply quoting the task badge outside the status bar", () => {
    expect(
      isKimiBusyScreen([
        "● The status bar showed [1 task running] while it worked.",
        "╭──────╮",
        "│ >",
        "╰──────╯",
        "Ask When Needed  K3 thinking: max  ~/proj  main",
      ]),
    ).toBe(false);
  });

  it("keeps Cursor working while ctrl+c to stop sits under the composer", () => {
    const busy = ["→ Add a follow-up", "ctrl+c to stop", "60 files edited", "Run Everything"];
    const sameLine = ["→ Add a follow-up    ctrl+c to stop"];
    const quoted = ["The server is running; ctrl+c to stop it.", "→ Add a follow-up"];
    expect(isCursorBusyScreen(busy)).toBe(true);
    expect(isCursorBusyScreen(sameLine)).toBe(true);
    expect(isIdleAgentScreen(busy, "", "cursor")).toBe(false);
    expect(isCursorBusyScreen(quoted)).toBe(false);
    expect(isIdleAgentScreen(quoted, "", "cursor")).toBe(true);
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

  it("does not treat Claude's composer as idle while its background work still runs", () => {
    const composer = ["─".repeat(40), "❯ ", "─".repeat(40), "  ⏸ manual mode on · 1 shell"];
    const shell = ["⏺ STARTED", "", "✻ Baked for 6s · done 12:03 PM · 1 shell still running", ""];
    const agents = ["⏺ Launched both.", "", "✻ Waiting for 2 background agents to finish", ""];
    const finished = ["⏺ Done.", "", "✻ Cogitated for 2s · done 12:04 PM", ""];

    expect(isClaudeBusyScreen([...shell, ...composer])).toBe(true);
    expect(isClaudeBusyScreen([...agents, ...composer])).toBe(true);
    expect(
      isClaudeBusyScreen([
        ...shell,
        "                        ✘ Auto-update failed · Run claude doctor",
        ...composer,
      ]),
    ).toBe(true);
    expect(isIdleAgentScreen([...shell, ...composer], "❯ ", "claude")).toBe(false);
    expect(isClaudeBusyScreen([...finished, ...composer])).toBe(false);
    expect(isIdleAgentScreen([...finished, ...composer], "❯ ", "claude")).toBe(true);
  });

  it("reads only Claude's turn line above the composer", () => {
    const composer = ["─".repeat(40), "❯ ", "─".repeat(40)];
    // A reply that mentions the status in prose is not a running background task.
    expect(
      isClaudeBusyScreen([
        "⏺ The dev server is started; 1 shell still running",
        "  in the background · 1 shell still running",
        ...composer,
      ]),
    ).toBe(false);
    // An older turn's line is stale once a later turn finished below it.
    expect(
      isClaudeBusyScreen([
        "✻ Baked for 6s · done 12:03 PM · 1 shell still running",
        "⏺ Done.",
        "✻ Cogitated for 2s · done 12:04 PM",
        ...composer,
      ]),
    ).toBe(false);
    // The composer's own draft is not Claude's output.
    expect(
      isClaudeBusyScreen([
        "✻ Cogitated for 2s · done 12:04 PM",
        "─".repeat(40),
        "❯ ✻ Baked for 6s · done 12:03 PM · 1 shell still running",
        "─".repeat(40),
      ]),
    ).toBe(false);
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

  it("returns Claude to working when a late needs-input hook lands after the answer", () => {
    const tracker = new TerminalActivityTracker();
    let screenLines = ["Do you want to proceed?", "❯ 1. Yes", "  2. No"];
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => screenLines.at(-1) ?? "",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    scanner.feedInput("\r");
    scanner.feedOutput("\x1b]0;✳ Claude Code\x07Do you want to proceed?");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });

    scanner.feedInput("1");
    scanner.feedOutput("\x1b]0;◐ Claude Code\x07✻ Levitating… (1s)");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    // Claude's permission_prompt Notification fires ~6s after the dialog opened.
    tracker.set("attention");
    scanner.feedOutput("\x1b]0;◑ Claude Code\x07✻ Levitating… (2s)");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    screenLines = ["⏺ Done.", "❯"];
    scanner.feedOutput("\x1b]0;✳ Claude Code\x07❯ ");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("keeps a Stop hook's finish while Claude's title still spins for slower Stop hooks", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["⏺ Done.", "❯"],
      readCursorLine: () => "❯",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    scanner.feedInput("\r");
    scanner.feedOutput("\x1b]0;◐ Claude Code\x07✻ Ebbing… (running Stop hooks… 1/7)");
    tracker.set("idle");
    scanner.feedOutput("\x1b]0;◑ Claude Code\x07✻ Ebbing… (running Stop hooks… 2/7)");

    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("keeps Claude working while background work outlives the turn", () => {
    const tracker = new TerminalActivityTracker();
    const composer = ["─".repeat(40), "❯ ", "─".repeat(40), "  ⏸ manual mode on · 1 shell"];
    let screenLines = [
      "⏺ STARTED",
      "",
      "✻ Baked for 6s · done 12:03 PM · 1 shell still running",
      "",
      ...composer,
    ];
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => "❯ ",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("claude");
    scanner.feedInput("\r");
    scanner.feedOutput(
      "\x1b]0;✳ Claude Code\x07✻ Baked for 6s · done 12:03 PM · 1 shell still running",
    );
    vi.advanceTimersByTime(5000);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    // The shell's completion notification runs a short turn that ends on a plain turn line.
    screenLines = [
      "⏺ The sleep finished.",
      "",
      "✻ Cogitated for 2s · done 12:04 PM",
      "",
      ...composer,
    ];
    scanner.feedOutput("✻ Cogitated for 2s · done 12:04 PM");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("keeps Claude working on its live turn spinner across stillness and re-promotes without a title change", () => {
    const rule = "─── ultracode " + "─".repeat(50);
    const activeTurnScreen = [
      "⏺ Update(src/game_app_input.cpp)",
      "  ⎿  Added 4 lines, removed 2 lines",
      "",
      "· Mulling… (5m 46s · ↓ 23.9k tokens)",
      "  ⎿  Tip: Use /feedback to help us improve!",
      "",
      "◎ /goal active (5m)",
      rule,
      "❯",
      rule,
      "  Opus 4.7 (1M context) │ 📁 OpenAOE2 │ 🌿 main (26 files) │ 🧠 23% │ $25.67 │ 5h 9% (4h30m) │ wk 42%",
      "  ▸▸ bypass permissions on (shift+tab to cycle) · esc to interrupt",
    ];
    const wrappedTipScreen = [
      "✻ Improvising… (22m 8s · ↓ 68.5k tokens)",
      "  ⎿  Tip: Did you know you can drag and drop image files into your terminal?",
      "     Give it a try!",
      "",
      "◎ /goal active (22m)",
      rule,
      "❯",
      rule,
      "  Opus 4.7 (1M context) │ 📁 OpenDiablo2R │ 🌿 main",
      "  ▸▸ bypass permissions on (shift+tab to cycle)",
    ];

    expect(isClaudeBusyScreen(activeTurnScreen)).toBe(true);
    expect(isClaudeBusyScreen(wrappedTipScreen)).toBe(true);
    expect(isIdleAgentScreen(activeTurnScreen, "❯", "claude")).toBe(false);
    expect(isIdleAgentScreen(wrappedTipScreen, "❯", "claude")).toBe(false);

    const tracker = new TerminalActivityTracker();
    let screenLines = activeTurnScreen;
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => "❯",
      stillnessMs: 500,
    });

    // Restored Claude screen without the welcome banner is recognized from composer + mode footer.
    scanner.feedOutput("· Mulling… (5m 46s · ↓ 23.9k tokens)");
    expect(scanner.getActiveAgent()).toBe("claude");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    // A stillness gap between tool execution and the next streamed chunk must not mark the turn idle.
    vi.advanceTimersByTime(1500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    // Even if a Stop hook briefly set the tracker idle before a /goal hook resumed the turn,
    // subsequent spinner frames without a title escape re-promote the terminal to working.
    tracker.set("idle");
    tracker.clearAttention();
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: null });

    screenLines = wrappedTipScreen;
    scanner.feedOutput("✻ Improvising… (22m 8s · ↓ 68.5k tokens)");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
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

  it("tracks Kimi Code lifecycle from launch to finished turn", () => {
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

    scanner.handleInitialCommand("kimi");
    expect(tracker.getSnapshot().state).toBeNull();

    screenLines = [
      "▐█▛█▛█▌  Welcome to Kimi Code!",
      "╭──────╮",
      "│ >",
      "╰──────╯",
      "Ask When Needed  K3 thinking: max  ~/proj  main  context: 0% (0/1M)",
    ];
    cursorLine = "│ > ";
    scanner.feedOutput("Welcome to Kimi Code!\n");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBeNull();

    scanner.feedInput("run sleep 25");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    // The turn's braille spinner repaints while the cursor is outside the composer.
    cursorLine = "";
    screenLines = ["✨ run sleep 25", "⠹ thinking…", ""];
    scanner.feedOutput("⠹ thinking…\n");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot().state).toBe("working");

    // An approval dialog waits on the user.
    screenLines = [
      "Allow Kimi Code to run Bash: rm -rf /tmp/probe",
      "> Allow once",
      "  Always allow",
      "  Deny",
    ];
    cursorLine = "> Allow once";
    scanner.feedOutput("Allow Kimi Code to run Bash\n");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });

    scanner.feedInput("\r");
    expect(tracker.getSnapshot().state).toBe("working");

    // The turn ends but a background task keeps the status-bar badge: still working.
    screenLines = [
      "● Command ran.",
      "╭──────╮",
      "│ >",
      "╰──────╯",
      "Ask When Needed  K3 thinking: max  [1 task running]  ~/proj  main",
    ];
    cursorLine = "│ > ";
    scanner.feedOutput("● Command ran.\n");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    // The task finishes, the badge goes away, and the settled composer finishes green.
    screenLines = [
      "● Command ran.",
      "╭──────╮",
      "│ >",
      "╰──────╯",
      "Ask When Needed  K3 thinking: max  ~/proj  main  context: 3% (31k/1M)",
    ];
    scanner.feedOutput(" ");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });

    scanner.handleCommandFinished();
    expect(tracker.getSnapshot().state).toBeNull();
  });

  it("paints a Kimi quota screen red", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => [
        "● Model request failed",
        "  Model rate limit reached",
        "  https://www.kimi.com/membership/subscription?tab=quota",
        "│ >",
      ],
      readCursorLine: () => "│ > ",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("kimi");
    scanner.feedInput("\r");
    scanner.feedOutput("Model rate limit reached\n");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });
  });

  it("starts working for kimi -p without waiting for Enter", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => [],
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("kimi -p summarize this repo");

    expect(tracker.getSnapshot().state).toBe("working");
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

  it("keeps Codex's double-chevron composer working until its turn finishes", () => {
    const tracker = new TerminalActivityTracker();
    let screenLines = [
      "• Working (12s • esc to interrupt)",
      "» Ask Codex to do anything",
      "  GPT-6-Astra ultra · Context 91% left",
    ];
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => "» Ask Codex to do anything",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex");
    scanner.feedInput("\r");
    scanner.feedOutput("• Working (12s • esc to interrupt)");
    vi.advanceTimersByTime(2500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    screenLines = [
      "Worked for 1m 12s • 14:21",
      "» Ask Codex to do anything",
      "  GPT-6-Astra ultra · Context 91% left",
    ];
    scanner.feedOutput("Worked for 1m 12s • 14:21");
    vi.advanceTimersByTime(500);
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

  it("settles the first working hook without a local Enter or another PTY repaint", () => {
    const tracker = new TerminalActivityTracker();
    const composer = "» Ask Codex to do anything";
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["Worked for 1m 12s • 14:21", composer],
      readCursorLine: () => composer,
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex");
    tracker.set("working", undefined, "hook-session");
    scanner.handleHookActivityChange();
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it.each(["›", "»"])(
    "settles a late working hook at Codex's %s composer without more PTY output",
    (prompt) => {
      const tracker = new TerminalActivityTracker();
      const composer = `${prompt} Ask Codex to do anything`;
      const scanner = new PtyActivityScanner({
        setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
        clearActivity: () => tracker.clear(),
        getActivity: () => tracker.getSnapshot(),
        readLastLines: () => ["Worked for 1m 12s • 14:21", composer],
        readCursorLine: () => composer,
        stillnessMs: 500,
      });

      scanner.handleInitialCommand("codex");
      scanner.feedInput("\r");
      scanner.feedOutput("Worked for 1m 12s • 14:21");
      vi.advanceTimersByTime(500);
      expect(tracker.clearAttention()).toBe(true);

      // A tool hook can arrive after the final repaint with no subsequent terminal output.
      tracker.set("working", undefined, "late-subagent-session");
      scanner.handleHookActivityChange();
      expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
      vi.advanceTimersByTime(500);

      expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
    },
  );

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

  it("keeps an idle shell clear when the previous agent remains in scrollback", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["OpenAI Codex", "› Ask Codex to do anything", "$ "],
      readCursorLine: () => "$ ",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("codex");
    scanner.feedInput("\r");
    scanner.handleCommandFinished();
    scanner.feedOutput("\x1b[?2004h$ ");
    scanner.feedInput("\r");

    expect(scanner.getActiveAgent()).toBeNull();
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });

    scanner.handleCommandStarted();
    scanner.handleTitleChange("ls");
    scanner.feedOutput("file.txt\r\n");
    expect(scanner.getActiveAgent()).toBeNull();

    scanner.handleCommandStarted();
    scanner.feedOutput("OpenAI Codex\r\n› Ask Codex to do anything");
    scanner.feedInput("\r");
    expect(scanner.getActiveAgent()).toBe("codex");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("recognizes a fresh agent banner split across chunks after a shell command finishes", () => {
    const tracker = new TerminalActivityTracker();
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => ["Claude Code v2.1.284", "$ "],
      readCursorLine: () => "$ ",
      stillnessMs: 500,
    });

    scanner.handleCommandFinished();
    scanner.feedOutput("OpenAI ");
    scanner.handleCommandFinished();
    scanner.feedOutput("Codex\r\n$ ");
    scanner.feedInput("\r");
    expect(scanner.getActiveAgent()).toBeNull();
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });

    scanner.feedOutput("OpenAI ");
    expect(scanner.getActiveAgent()).toBeNull();
    scanner.feedOutput("Codex\r\n› Ask Codex to do anything");
    scanner.feedInput("\r");

    expect(scanner.getActiveAgent()).toBe("codex");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

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

  it("treats a Cursor screen titled like Codex as Cursor and keeps the turn working", () => {
    const tracker = new TerminalActivityTracker();
    const screen = [
      "OpenAI Codex v0.155.1",
      "Editing merge.py",
      "Tip: Use /run-everything to skip all approvals.",
      "→ Add a follow-up",
      "ctrl+c to stop",
      "2 tasks",
      "Claude Opus 5.5 1M Extra High · MAX · 60% · 60 files edited",
      "Run Everything",
    ];
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screen,
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.handleCommandStarted();
    scanner.handleTitleChange("Codex Session Audit");
    expect(scanner.getActiveAgent()).toBe("codex");

    scanner.feedOutput("ctrl+c to stop");
    expect(scanner.getActiveAgent()).toBe("cursor");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    vi.advanceTimersByTime(2000);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("recognizes a resumed Cursor screen that never reprints its banner", () => {
    const tracker = new TerminalActivityTracker();
    const screen = [
      "→ Add a follow-up",
      "ctrl+c to stop",
      "Claude Opus 5.5 1M Extra High · MAX · 60% · 60 files edited",
    ];
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screen,
      readCursorLine: () => "",
      stillnessMs: 500,
    });

    scanner.feedOutput("tick");
    expect(scanner.getActiveAgent()).toBe("cursor");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    vi.advanceTimersByTime(2000);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
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

  it("finishes a closed Grok turn while parked task rows keep their clocks", () => {
    // The painted row matches the Belle terminal: ⸬, then the verb, then the
    // clock, with a blank line between the dock and the composer box.
    const open = [
      "▼ Tasks 1",
      "⸬ Run Start the Stormcloud supervisor for a live run  1h04m",
      "",
      "╭────────────────────╮",
      "❯",
      "Grok 4.7 (xhigh) · always-approve",
      "Shift+Tab: mode",
    ];
    const parked = [
      "Worked for 59m16s",
      "",
      "▼ Tasks 1",
      "⸬ Run Start the Stormcloud supervisor for a live run  1h04m",
      "",
      "╭────────────────────╮",
      "❯",
      "Grok 4.7 (xhigh) · always-approve",
      "Shift+Tab: mode",
    ];
    const finished = [
      "Worked for 59m16s",
      "",
      "╭────────────────────╮",
      "❯",
      "Grok 4.7 (xhigh) · always-approve",
    ];
    expect(isGrokBusyScreen(open)).toBe(true);
    expect(isIdleAgentScreen(open, "❯", "grok")).toBe(false);
    expect(isGrokBusyScreen(parked)).toBe(false);
    expect(isIdleAgentScreen(parked, "❯", "grok")).toBe(true);
    expect(
      isIdleAgentScreen(
        parked.map((line) => (line === "❯" ? "❯ Anything barely works" : line)),
        "❯ Anything barely works",
        "grok",
      ),
    ).toBe(true);
    expect(isGrokBusyScreen(finished)).toBe(false);
    expect(isIdleAgentScreen(finished, "❯", "grok")).toBe(true);
    expect(
      isGrokBusyScreen(["⠋ Run Start the Stormcloud supervisor for a live run  1h04m", "", "❯"]),
    ).toBe(true);
    // A braille logo, or the turn marker alone, is not a running task.
    expect(isGrokBusyScreen(["⠋⠋⠋", "", "Worked for 59m16s", "❯"])).toBe(false);
    expect(isGrokBusyScreen(["⠋⠋⠋ Grok", "❯"])).toBe(false);
    expect(isGrokBusyScreen(["⸬ Run Start the supervisor", "❯"])).toBe(false);
    expect(
      isGrokBusyScreen(["◎ 1 command · 2 monitors · 1 loop · 1 subagent still running", "❯"]),
    ).toBe(true);
    expect(isGrokBusyScreen(["◎ 2 commands · 1 monitor still running", "❯"])).toBe(false);
    expect(isGrokBusyScreen(["◎ waiting · send a message to interrupt", "❯"])).toBe(true);
    expect(isGrokBusyScreen(["see ◎ 1 command still running in the docs", "❯"])).toBe(false);
    expect(isGrokBusyScreen(["Worked for 51s", "◎ 1 subagent still running", "", "❯"])).toBe(true);
    expect(
      isGrokBusyScreen(["Worked for 51s", "◎ 1 command · 1 monitor still running", "", "❯"]),
    ).toBe(false);
    expect(
      isGrokBusyScreen(["Worked for 51s", "◎ waiting · send a message to interrupt", "❯"]),
    ).toBe(true);
    expect(isGrokBusyScreen(["⠋ Thinking", "", "╭", "❯"])).toBe(true);
    expect(isGrokBusyScreen(["⸬ Thinking...", "", "❯"])).toBe(true);
    expect(isGrokBusyScreen(["⋅ Thinking…", "", "❯"])).toBe(true);
    expect(isGrokBusyScreen([": Thinking", "", "❯"])).toBe(true);
    expect(isGrokBusyScreen(["⁙ Thinking⋯", "", "❯"])).toBe(true);
    expect(isGrokBusyScreen(["Thinking", "", "❯"])).toBe(true);
    expect(isGrokBusyScreen(["Thought for 12s", "", "❯"])).toBe(false);
    expect(isGrokBusyScreen(["⠋ Thought for 12s", "", "❯"])).toBe(false);
    expect(isGrokBusyScreen(["The model is Thinking about the tests", "❯"])).toBe(false);
    // An older Thinking header sits above the turn marker. A dock row under
    // Thought for is still the turn. The same row under Worked for is parked.
    expect(isGrokBusyScreen(["⠋ Thinking", "Search files", "Thought for 12s", "", "❯"])).toBe(
      false,
    );
    expect(isGrokBusyScreen(["⠋ Thinking", "Search files", "Worked for 2s", "", "❯"])).toBe(false);
    expect(isGrokBusyScreen(["Worked for 2s", "⋅ Thinking…", "", "❯"])).toBe(true);
    expect(
      isGrokBusyScreen(["Thought for 12s", "⸬ Run Start the supervisor  1m04s", "", "❯"]),
    ).toBe(true);
    expect(isGrokBusyScreen(["Worked for 12s", "⸬ Run Start the supervisor  1m04s", "", "❯"])).toBe(
      false,
    );

    const tracker = new TerminalActivityTracker();
    let screenLines = open;
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => "❯",
      stillnessMs: 500,
    });

    // The profile command is not the grok binary, and the resumed screen does
    // not reprint the welcome banner. The next byte is the task clock.
    scanner.handleInitialCommand("grokyolo");
    scanner.feedOutput("1h05m");
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(500);

    expect(scanner.getActiveAgent()).toBe("grok");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    screenLines = parked;
    scanner.feedOutput("Worked for 59m16s");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });

    // The parked clock keeps painting a braille frame. That is not a new turn.
    scanner.feedOutput("⠋");
    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });
  });

  it("stays finished while a Grok draft contains continue under always-approve", () => {
    const tracker = new TerminalActivityTracker();
    let screenLines = [
      "Worked for 4m4s",
      "╭────────────────────╮",
      "❯",
      "Grok 4.7 (xhigh) · always-approve",
    ];
    let cursorLine = "❯";
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
    scanner.feedOutput("reply");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });

    screenLines = [
      "Can you commit and push everything codex did?",
      "I did not re-run the test suites.",
      "Worked for 4m4s",
      "╭────────────────────╮",
      "❯ So lets continue one the",
      "Grok 4.7 (xhigh) · always-approve",
    ];
    cursorLine = "❯ So lets continue one the";
    scanner.feedOutput("e");
    vi.advanceTimersByTime(500);

    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });
  });

  it("keeps Grok blue while a Thinking row is still on screen", () => {
    const thinking = [
      "⋅ Thinking…",
      "Search maskActionRail|actionCenter|actionSize",
      "Read /Users/legoless/Projects/legoless/Matisse/app/MatisseTests/ChatTool.swift",
      "⸬ Thinking",
      "3/3 tasks",
      "",
      "╭────────────────────╮",
      "❯",
      "Grok 4.7 (xhigh) · Extra high",
    ];
    const answered = ["Thought for 12s", "Done.", "", "╭────────────────────╮", "❯"];
    expect(isGrokBusyScreen(thinking)).toBe(true);
    expect(isIdleAgentScreen(thinking, "❯", "grok")).toBe(false);

    const tracker = new TerminalActivityTracker();
    let screenLines = answered;
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => "❯",
      stillnessMs: 500,
    });

    scanner.handleInitialCommand("grok");
    scanner.feedInput("\r");
    scanner.feedOutput("reply");
    screenLines = answered;
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });

    // The spinner keeps repainting, so this has to clear the green without
    // waiting for a quiet gap. The tick is one frame (`⋅`), not the word.
    screenLines = thinking;
    scanner.feedOutput("⋅");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    screenLines = answered;
    scanner.feedOutput("Thought for 12s");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "finished",
    });

    // A quota stop stays red while the Thinking row is still painted.
    screenLines = ["You've hit your monthly spend limit", "⋅ Thinking…", "", "❯"];
    scanner.feedOutput("limit");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({
      state: "idle",
      attentionReason: "quota",
    });
    screenLines = thinking;
    scanner.feedOutput("⋅");
    expect(tracker.getSnapshot().attentionReason).toBe("quota");
  });

  it("finishes an Antigravity turn when a background task stays running in the tray", () => {
    const tracker = new TerminalActivityTracker();
    const screenLines = [
      "▸ Thought for 8s, 63 tokens",
      "The local preview server (serve.mjs) is now running in the background.",
      "TL;DR: Started the corpus:preview server at http://127.0.0.1:4173/index.html.",
      "─".repeat(40),
      ">",
      "─".repeat(40),
      "  ● [09:34:08] npm run corpus:preview running",
      "─".repeat(40),
      "? for shortcuts                            Gemini 4 Argon · high · 1 task(s) · /tasks",
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

    expect(isAntigravityBusyScreen(screenLines)).toBe(false);
    expect(isIdleAgentScreen(screenLines, ">", "antigravity")).toBe(true);
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

describe("OpenCode terminal activity", () => {
  const composer = (draft = "") => [
    "┃",
    `┃   ${draft}`,
    "┃",
    "┃   Sisyphus - Ultraworker · DeepSeek V4.1 Flash OpenRouter · max",
    "╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  ];
  const idleFooter = [" /tmp/project   177.9K (17%) · $0.22   ctrl+p commands"];
  const busyFooter = [" ⬝⬝■⬝⬝⬝⬝⬝ esc interrupt 177.9K (17%) · $0.22 ctrl+p commands"];

  function terminal(initialLines: string[] = []) {
    const tracker = new TerminalActivityTracker();
    let lines = initialLines;
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      getActivityOwnerSessionId: () => tracker.getOwnerSessionId(),
      hasHookNeedsInput: () => tracker.hasHookNeedsInput(),
      readLastLines: (limit) => lines.slice(-limit),
      readCursorLine: () => "┃",
      stillnessMs: 500,
    });
    return {
      tracker,
      scanner,
      paint(next: string[], output = next.join("\n")) {
        lines = next;
        scanner.feedOutput(output);
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the screenshot's blank composer working while the interrupt footer is visible", () => {
    const screen = [
      "Confirmed DEFEAT dialog. Clicking RESTART and verifying the level resets:",
      "▪ Sisyphus - Ultraworker · DeepSeek V4.1 Flash",
      ...composer(),
      ...busyFooter,
    ];
    expect(isOpenCodeBusyScreen(screen)).toBe(true);
    expect(isIdleAgentScreen(screen, "┃", "opencode")).toBe(false);
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    paint(screen);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    vi.advanceTimersByTime(2000);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it.each(
    [
      [" [⋯] esc interrupt"],
      [" ■⬝⬝⬝⬝⬝⬝⬝ esc again to interrupt"],
      [" ⬝⬝■⬝⬝⬝⬝⬝", "esc again to", "interrupt 177.9K (17%)", "ctrl+p commands"],
      [" ⬝⬝■⬝⬝⬝⬝⬝ rate limited [retrying in 2s attempt #1] esc interrupt"],
    ].map((footer) => ({ footer })),
  )("recognizes wrapped, retry, and animation-disabled busy footers $footer", ({ footer }) => {
    const screen = [
      "┃",
      "┃   queued follow-up",
      "┃",
      "┃   Sisyphus -",
      "┃   Ultraworker · DeepSeek V4.1 Flash",
      "┃   OpenRouter · max",
      "╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
      ...footer,
    ];
    expect(isOpenCodeBusyScreen(screen)).toBe(true);
    expect(isIdleAgentScreen(screen, "┃ queued follow-up", "opencode")).toBe(false);
  });

  it("recognizes a restored OpenCode screen without a banner", () => {
    const screen = [...composer(), ...busyFooter];
    expect(detectAgentFromOutput(screen.join("\n"))).toBe("opencode");
    const { scanner, tracker, paint } = terminal(screen);
    paint(screen, "177.9K");
    expect(scanner.getActiveAgent()).toBe("opencode");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("rechecks a restored OpenCode screen after a partial repaint", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.feedOutput("partial repaint");
    expect(scanner.getActiveAgent()).toBeNull();
    paint([...composer(), ...busyFooter], "⬝⬝■⬝⬝⬝⬝⬝");
    expect(scanner.getActiveAgent()).toBe("opencode");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("rechecks a restored OpenCode screen after an animation-disabled repaint", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.feedOutput("partial repaint");
    expect(scanner.getActiveAgent()).toBeNull();
    paint([...composer(), " [⋯] esc interrupt 177.9K (17%) · $0.22 ctrl+p commands"], "[⋯]");
    expect(scanner.getActiveAgent()).toBe("opencode");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("keeps a restored idle composer clear and recognizes a draft as the next turn's prompt", () => {
    const screen = [...composer("next task"), ...idleFooter];
    const { scanner, tracker, paint } = terminal(screen);
    paint(screen);
    vi.advanceTimersByTime(500);
    expect(scanner.getActiveAgent()).toBe("opencode");
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });
    scanner.feedInput("\r");
    paint([...composer(), ...busyFooter]);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    paint(screen);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("finishes at a narrow idle composer and ignores transcript status and approval prose", () => {
    const screen = [
      "✓ Explore Task - Find reusable sprite-matching prior art",
      "  ↳ 35 toolcalls · 0ms",
      "ctrl+x down view subagents",
      "Four investigations are running in parallel:",
      "I'll synthesize them into a scoped plan when they report back.",
      "Press esc interrupt to stop. Allow the command to continue?",
      "▪ Sisyphus - Ultraworker · DeepSeek V4.1 Flash · 2m 12s",
      ...composer("please approve this and confirm? ⠋ esc interrupt"),
      " /Users/legoless/Projects/legoless/   173.0K (17%) · ctrl+p",
      " Belle/.worktrees/docs-diablo2-game-   commands",
      " state-research",
    ];
    expect(isOpenCodeBusyScreen(screen)).toBe(false);
    expect(isOpenCodeNeedsInputScreen(screen)).toBe(false);
    expect(isIdleAgentScreen(screen, "┃ draft", "opencode")).toBe(true);
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    scanner.feedInput("\r");
    paint(screen);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
    tracker.clearAttention();
    paint(screen, "⠋");
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: null });
  });

  it("supports a transparent composer without its shadow row", () => {
    const screen = [
      ...composer("Permission required: enter confirm, esc dismiss").slice(0, -1),
      "",
      ...idleFooter,
    ];
    expect(detectAgentFromOutput(screen.join("\n"))).toBe("opencode");
    expect(isIdleAgentScreen(screen, "┃", "opencode")).toBe(true);
    expect(isOpenCodeNeedsInputScreen(screen)).toBe(false);
    expect(isOpenCodeBusyScreen([...composer().slice(0, -1), "", ...busyFooter])).toBe(true);
  });

  it("does not identify OpenCode from transcript snippets without the complete composer", () => {
    expect(
      detectAgentFromOutput("Sisyphus - Ultraworker · DeepSeek V4.1 Flash · 2m 12s"),
    ).toBeNull();
    expect(detectAgentFromOutput("ctrl+x down view subagents")).toBeNull();
    expect(detectAgentFromOutput("177.9K (17%) · $0.22 ctrl+p commands")).toBeNull();
    expect(isOpenCodeBusyScreen(["⬝⬝■⬝⬝⬝⬝⬝ esc interrupt", "plain shell"])).toBe(false);
    expect(
      isOpenCodeBusyScreen([...composer(), ...idleFooter, "The footer used esc interrupt."]),
    ).toBe(false);
  });

  it("returns immediately to blue when the busy footer follows premature hook completion", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    scanner.feedInput("\r");
    paint([...composer(), ...busyFooter]);
    tracker.set("idle", undefined, "root");
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
    paint([...composer(), ...busyFooter], "⬝■⬝⬝⬝⬝⬝⬝");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it.each(
    [
      [
        "Permission required",
        "Run git status",
        "Allow once   Allow always   Reject",
        "⇆ select   enter confirm",
      ],
      [
        "△ Always allow",
        "This will allow edit until OpenCode is restarted.",
        "Confirm   Cancel",
        "⇆ select   enter confirm",
      ],
      [
        "Which implementation?",
        "1. Small patch",
        "2. Full rewrite",
        "↑↓ select   enter submit   esc dismiss",
      ],
      [
        "Select all targets",
        "1. Desktop",
        "2. Mobile",
        "⇆ tab   ↑↓ select   enter toggle   esc dismiss",
      ],
      ["Confirm", "Desktop: Small patch", "⇆ tab   enter submit   esc dismiss"],
      ["Reject permission", "Tell OpenCode why", "enter confirm   esc cancel"],
    ].map((dialog) => ({ dialog })),
  )(
    "shows orange for the current OpenCode dialog $dialog and resumes without Enter",
    ({ dialog }) => {
      expect(isOpenCodeNeedsInputScreen(dialog)).toBe(true);
      expect(isIdleAgentScreen(dialog, "", "opencode")).toBe(false);
      const { scanner, tracker, paint } = terminal();
      scanner.handleInitialCommand("opencode");
      scanner.feedInput("\r");
      paint(dialog);
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({
        state: "idle",
        attentionReason: "needs_input",
      });
      scanner.feedInput("1");
      paint([...composer(), ...busyFooter]);
      expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    },
  );

  it("holds background hook work at the parent's idle composer until the aggregate finishes", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    scanner.feedInput("\r");
    tracker.set("working", undefined, "root");
    paint([
      "Four investigations are running in parallel:",
      "▪ Sisyphus - Ultraworker · DeepSeek V4.1 Flash · 2m 12s",
      ...composer(),
      ...idleFooter,
    ]);
    vi.advanceTimersByTime(2500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    tracker.set("idle", undefined, "root");
    paint([...composer(), ...idleFooter]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("holds hook work through an unresolved screen and lets hook approval remain orange", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    tracker.set("working", undefined, "root");
    paint(["incomplete screen"]);
    vi.advanceTimersByTime(2500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    tracker.set("attention", undefined, "root");
    paint([...composer(), ...idleFooter]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
  });

  it("keeps owned hook approval orange after a visible dialog returns to the parent's composer", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    tracker.set("working", undefined, "root");
    paint([
      "Permission required",
      "Allow once   Allow always   Reject",
      "⇆ select   enter confirm",
    ]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
    tracker.set("attention", undefined, "root");
    paint([...composer(), ...idleFooter]);
    vi.advanceTimersByTime(1500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });

    tracker.set("working", undefined, "root");
    paint([...composer(), ...idleFooter]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    tracker.set("idle", undefined, "root");
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("keeps a waiting background child's hook orange while the parent footer remains busy", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    tracker.set("working", undefined, "root");
    paint([...composer(), ...busyFooter]);
    tracker.set("attention", undefined, "root");
    paint([...composer(), ...busyFooter], "⬝■⬝⬝⬝⬝⬝⬝");
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
    vi.advanceTimersByTime(1500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });

    tracker.set("working", undefined, "root");
    paint([...composer(), ...busyFooter]);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("resumes a scanned question under an owned root without requiring a new running hook", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    tracker.set("working", undefined, "root");
    paint(["Which implementation?", "1. Small patch", "↑↓ select   enter submit   esc dismiss"]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
    expect(tracker.getOwnerSessionId()).toBe("root");
    scanner.feedInput("1");
    paint([...composer(), ...busyFooter]);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("gives a quota banner priority over owned child approval and a busy parent", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    tracker.set("working", undefined, "root");
    tracker.set("attention", undefined, "root");
    paint(["Quota exhausted", ...composer(), ...busyFooter]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });
  });

  it("prefers a visible permission dialog over owned background hook work", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    tracker.set("working", undefined, "root");
    paint([
      "Permission required",
      "Allow once   Allow always   Reject",
      "⇆ select   enter confirm",
    ]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
  });

  it("prefers a dialog footer over a stale composer and interrupt footer", () => {
    const screen = [
      ...composer(),
      ...busyFooter,
      "Permission required",
      "Allow once   Allow always   Reject",
      "⇆ select   enter confirm",
    ];
    expect(isOpenCodeNeedsInputScreen(screen)).toBe(true);
    expect(isOpenCodeBusyScreen(screen)).toBe(false);
    expect(isIdleAgentScreen(screen, "┃", "opencode")).toBe(false);
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    tracker.set("working", undefined, "root");
    paint(screen);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
  });

  it("prefers Always allow over a stale composer and interrupt footer", () => {
    const screen = [
      ...composer(),
      ...busyFooter,
      "△ Always allow",
      "This will allow edit until OpenCode is restarted.",
      "Confirm   Cancel",
      "⇆ select   enter confirm",
    ];
    expect(isOpenCodeNeedsInputScreen(screen)).toBe(true);
    expect(isOpenCodeBusyScreen(screen)).toBe(false);
    expect(isIdleAgentScreen(screen, "┃", "opencode")).toBe(false);
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    tracker.set("working", undefined, "root");
    paint(screen);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
  });

  it("ignores quota wording in an OpenCode draft and keeps a real banner red", () => {
    const draft = "Explain insufficient quota errors";
    const screen = [...composer(draft), ...idleFooter];
    expect(isSpendLimitScreen(screen, "opencode")).toBe(false);
    const quotaScreen = ["Quota exhausted", ...composer("next task"), ...idleFooter];
    expect(isSpendLimitScreen(quotaScreen, "opencode")).toBe(true);

    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    scanner.feedInput("\r");
    paint(screen);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });

    paint(quotaScreen);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });
  });

  it("keeps a quota failure red ahead of busy footer or hook idle", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    tracker.set("working", undefined, "root");
    paint(["Quota exhausted", ...composer(), ...busyFooter]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });
    tracker.set("idle", undefined, "root");
    paint(["Quota exhausted", ...composer(), ...idleFooter]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });
  });

  it("clears interrupted hook work without finished attention at the restored draft", () => {
    const { scanner, tracker, paint } = terminal();
    scanner.handleInitialCommand("opencode");
    tracker.set("working", undefined, "root");
    paint([...composer(), ...busyFooter]);
    tracker.interrupt();
    scanner.handleInterrupt();
    paint([...composer(), ...busyFooter]);
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });
    paint([...composer("original task"), ...idleFooter]);
    vi.advanceTimersByTime(1500);
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });
    scanner.feedInput("\r");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    scanner.handleCommandFinished();
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });
  });
});

describe("Muse Code terminal activity", () => {
  const composer = (draft = "") => [
    "── Voice input (⌥ + v to start) ─────────────────────────",
    `❯ ${draft}`,
    "────────────────────────────────────────────────────────",
    "echo · /private/tmp/muse-project · Auto-review",
  ];

  function terminal(initialLines: string[] = [], cursorLine = "❯ ") {
    const tracker = new TerminalActivityTracker();
    let lines = initialLines;
    let cursor = cursorLine;
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: (limit) => lines.slice(-limit),
      readCursorLine: () => cursor,
      stillnessMs: 500,
    });
    return {
      tracker,
      scanner,
      paint(next: string[], nextCursor = "❯ ", output = next.join("\n")) {
        lines = next;
        cursor = nextCursor;
        scanner.feedOutput(output);
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recognizes a restored working screen after the startup banner scrolled away", () => {
    const screen = ["◇ Thinking (1s · esc to interrupt)", "", ...composer()];
    expect(detectAgentFromOutput(screen.join("\n"))).toBe("muse");
    const { tracker, scanner, paint } = terminal(screen);
    paint(screen);
    expect(scanner.getActiveAgent()).toBe("muse");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("rechecks a restored screen when a later Muse diamond frame arrives", () => {
    const { tracker, scanner, paint } = terminal();
    scanner.feedOutput("partial repaint");
    expect(scanner.getActiveAgent()).toBeNull();
    paint(["◇ Thinking (2s · esc to interrupt)", "", ...composer()], "❯ ", "◈");
    expect(scanner.getActiveAgent()).toBe("muse");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("recognizes a restored idle screen before the next prompt is submitted", () => {
    const screen = composer();
    expect(detectAgentFromOutput(screen.join("\n"))).toBe("muse");
    const { tracker, scanner, paint } = terminal(screen);
    paint(screen);
    vi.advanceTimersByTime(500);
    expect(scanner.getActiveAgent()).toBe("muse");
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });
    scanner.feedInput("\r");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it.each(["Read only", "Ask me", "Auto-review", "Unrestricted", "Launch overrides", "YOLO"])(
    "recognizes a restored composer with the %s profile",
    (profile) => {
      const screen = [...composer().slice(0, -1), `echo · /private/tmp/project · ${profile}`];
      expect(detectAgentFromOutput(screen.join("\n"))).toBe("muse");
    },
  );

  it("requires Muse's composer and profile footer instead of recognizing quoted prose", () => {
    expect(detectAgentFromOutput("The transcript says Muse Code 1.4.6.")).toBeNull();
    expect(detectAgentFromOutput("◇ Thinking (1s · esc to interrupt)")).toBeNull();
    expect(detectAgentFromOutput(composer().slice(0, -1).join("\n"))).toBeNull();
    expect(detectAgentFromOutput("echo · /tmp/project · Auto-review")).toBeNull();
    expect(isMuseBusyScreen(["◇ Thinking (1s · esc to interrupt)", "plain shell"])).toBe(false);
  });

  it.each([
    "◇ Thinking",
    "◈ Working",
    "▸ Thinking",
    "▸ Calling tools",
    "▾ Compacting context",
    "◆ Double checking",
    "◇ Finishing up",
  ])("keeps a persistent composer working for %s", (status) => {
    const screen = [`${status} (12s · esc to interrupt)`, "", ...composer("next task")];
    expect(isMuseBusyScreen(screen)).toBe(true);
    expect(isIdleAgentScreen(screen, "❯ next task", "muse")).toBe(false);
    const { tracker, scanner, paint } = terminal();
    scanner.handleInitialCommand("muse");
    paint(screen, "❯ next task");
    vi.advanceTimersByTime(2500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("keeps Muse working when a reasoning summary and goal checklist sit below Thinking or Calling tools", () => {
    const thinkingWithGoals = [
      "▸ Thinking (4m 25s · esc to interrupt)",
      "  Analyzing a build failure to determine if it is pre-existing at the commit tip",
      "  ✓ Set aside staged stage4 cleanup for the merge",
      "  ✓ Merge docs/diablo2-game-state-research tip into main",
      "  ✓ Resolve README.md conflict and complete merge",
      "  ◆ Restore cleanup, install deps and verify tests + corpus build",
      "  ◇ Confirm Diablo worktree untouched",
      "",
      "── Voice input (⌥ + v to start) ─────────────────────────",
      "❯ ",
      "────────────────────────────────────────────────────────",
      "muse-wonder-full-1.0 · max · ~/Projects/legoless/Belle · YOLO",
    ];
    expect(detectAgentFromOutput(thinkingWithGoals.join("\n"))).toBe("muse");
    expect(isMuseBusyScreen(thinkingWithGoals)).toBe(true);
    expect(isIdleAgentScreen(thinkingWithGoals, "❯ ", "muse")).toBe(false);

    const callingToolsWithGoals = [
      "▸ Calling tools (10m 15s · esc to interrupt)",
      "  ✓ Set aside staged stage4 cleanup for the merge",
      "  ✓ Merge docs/diablo2-game-state-research tip into main",
      "  ✓ Resolve README.md conflict and complete merge",
      "  ◆ Restore cleanup, install deps and verify tests + corpus build",
      "  ◇ Confirm Diablo worktree untouched",
      "",
      "── Voice input (⌥ + v to start) ─────────────────────────",
      "❯ ",
      "────────────────────────────────────────────────────────",
      "muse-wonder-full-1.0 · max · ~/Projects/legoless/Belle · YOLO",
    ];
    expect(isMuseBusyScreen(callingToolsWithGoals)).toBe(true);
    expect(isIdleAgentScreen(callingToolsWithGoals, "❯ ", "muse")).toBe(false);

    const { tracker, scanner, paint } = terminal();
    scanner.handleInitialCommand("muse-bin-1.4.10-R6427.1 --yolo");
    scanner.feedInput("\r");
    paint(thinkingWithGoals);
    vi.advanceTimersByTime(2500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    paint(callingToolsWithGoals);
    vi.advanceTimersByTime(2500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("recognizes Muse's unadorned initial Thinking frame", () => {
    expect(isMuseBusyScreen(["◇ Thinking", "", ...composer()])).toBe(true);
  });

  it.each([
    { status: ["◆ Thinking (12s · esc to inter"] },
    { status: ["◇ Working (2s)"] },
    { status: ["◈ Double checking (3s ·", "esc to interrupt)"] },
    { status: ["◇ Finishing up", "(1m2s · esc to interrupt)"] },
    {
      status: [
        "◈ Running command · Attach lldb for all-thread… — running (29s · esc to interrupt)",
        "  └ (ctrl+b to send to background)",
      ],
    },
  ])("keeps Muse working when its narrow-pane status reads $status", ({ status }) => {
    const screen = [...status, "", ...composer()];
    expect(isMuseBusyScreen(screen)).toBe(true);
    const { tracker, scanner, paint } = terminal();
    scanner.handleInitialCommand("muse");
    scanner.feedInput("\r");
    paint(screen);
    vi.advanceTimersByTime(2500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it.each(["Thinking", "Working", "Double checking", "Finishing up"])(
    "finishes a reply whose entire text is %s",
    (response) => {
      const screen = [`◆ ${response}`, "", ...composer()];
      expect(isMuseBusyScreen(screen)).toBe(false);
      expect(isIdleAgentScreen(screen, "❯ ", "muse")).toBe(true);
      const { tracker, scanner, paint } = terminal();
      scanner.handleInitialCommand("muse");
      scanner.feedInput("\r");
      paint(screen);
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
    },
  );

  it("treats a draft as idle and ignores status and approval text inside a finished response", () => {
    const screen = [
      "◆ The old transcript had ◇ Thinking (12s · esc to interrupt).",
      "Allow the command to run? Confirm the change before continuing.",
      "The panel said Approval request · keys active in a moment.",
      "Done.",
      "",
      ...composer("approve and run this?"),
    ];
    expect(isMuseBusyScreen(screen)).toBe(false);
    expect(isMuseNeedsInputScreen(screen)).toBe(false);
    expect(isIdleAgentScreen(screen, "❯ approve and run this?", "muse")).toBe(true);
    const { tracker, scanner, paint } = terminal();
    scanner.handleInitialCommand("muse");
    scanner.feedInput("\r");
    paint(screen, "❯ approve and run this?");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("tracks launch, prompt, approval, resumed work, completion, focus and exit", () => {
    const { tracker, scanner, paint } = terminal();
    scanner.handleCommandStarted();
    scanner.handleTitleChange("muse");
    paint(["Muse Code 1.4.6", "", ...composer()]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });

    scanner.feedInput("inspect the repository");
    scanner.feedInput("\r");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    paint(
      [
        "Would you like to run the following command?",
        "git status",
        "Approval request · keys active in a moment",
        "❯ Allow once",
        "  Allow for this session",
        "  Abort",
        "Enter to select · ↑/↓ to move · Esc to interrupt",
      ],
      "❯ Allow once",
    );
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });

    // Muse's menu can resume without sending a standalone Enter to the scanner.
    scanner.feedInput("1");
    paint(["◇ Working (2s · esc to interrupt)", "", ...composer()]);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    paint(["◆ Done.", "", ...composer()]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });

    expect(tracker.clearAttention()).toBe(true);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: null });
    scanner.handleCommandFinished();
    expect(scanner.getActiveAgent()).toBeNull();
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });
  });

  it("prefers user questions over a stale composer and running status", () => {
    const screen = [
      "◇ Working (2s · esc to interrupt)",
      "Structured user input needed",
      "Question 1: Which option?",
      "❯ First option",
      "  Second option",
      "Enter to select · ↑/↓ to move · Tab for an optional note · Esc to interrupt",
      ...composer(),
    ];
    expect(isMuseNeedsInputScreen(screen)).toBe(true);
    expect(isMuseBusyScreen(screen)).toBe(false);
    expect(isIdleAgentScreen(screen, "❯ ", "muse")).toBe(false);
    const { tracker, scanner, paint } = terminal();
    scanner.handleInitialCommand("muse");
    scanner.feedInput("\r");
    paint(screen);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
  });

  it("recognizes staged approvals and multi-select questions", () => {
    const approval = [
      "Would you like to run the following command?",
      "npm install",
      "❯ Allow this stage once",
      "  Abort the entire command",
    ];
    expect(isMuseNeedsInputScreen(approval)).toBe(true);
    expect(isIdleAgentScreen(approval, "❯ Allow this stage once", "muse")).toBe(false);
    const question = [
      "❯ First option",
      "  Second option",
      "  Submit",
      "Enter to toggle · Submit row to continue · ↑/↓ to move ·",
      "←/→ to switch question · Tab for an optional note · Esc to interrupt",
    ];
    expect(isMuseNeedsInputScreen(question)).toBe(true);
    expect(isIdleAgentScreen(question, "❯ First option", "muse")).toBe(false);
  });

  it("ignores quota wording in a Muse draft and keeps a real banner red", () => {
    const draft = "Explain insufficient quota errors";
    const screen = ["◆ Done.", "", ...composer(draft)];
    expect(isSpendLimitScreen(screen, "muse")).toBe(false);
    const quotaScreen = ["Usage limit reached", "", ...composer("next task")];
    expect(isSpendLimitScreen(quotaScreen, "muse")).toBe(true);

    const { tracker, scanner, paint } = terminal();
    scanner.handleInitialCommand("muse");
    scanner.feedInput("\r");
    paint(screen, `❯ ${draft}`);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });

    paint(quotaScreen, "❯ next task");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });
  });

  it("keeps quota red at the composer, clears it on focus and starts the next turn", () => {
    const { tracker, scanner, paint } = terminal();
    scanner.handleInitialCommand("muse");
    scanner.feedInput("\r");
    paint(["Usage limit reached", "", ...composer()]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });

    paint(["Usage limit reached", "", ...composer()]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });
    expect(tracker.clearAttention()).toBe(true);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: null });

    scanner.feedInput("\r");
    paint(["◇ Working (0s · esc to interrupt)", "", ...composer()]);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("starts Muse exec working before output and clears it when the command exits", () => {
    const { tracker, scanner } = terminal();
    scanner.handleInitialCommand("muse exec --model echo 'hello'");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    scanner.handleCommandFinished();
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });
  });

  it("preserves Muse activity through its basename and spinning cwd titles", () => {
    const { tracker, scanner, paint } = terminal();
    scanner.handleInitialCommand("muse");
    scanner.handleTitleChange("muse-project");
    scanner.feedInput("\r");
    scanner.handleTitleChange("⠋ muse-project");
    expect(scanner.getActiveAgent()).toBe("muse");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    scanner.handleTitleChange("muse-project");
    paint(["◆ Done.", "", ...composer()]);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("ignores interrupt residue and does not turn the returned composer green", () => {
    const { tracker, scanner, paint } = terminal();
    scanner.handleInitialCommand("muse");
    scanner.feedInput("\r");
    paint(["◇ Working (1s · esc to interrupt)", "", ...composer()]);
    tracker.interrupt();
    scanner.handleInterrupt();
    paint(["◇ Working (1s · esc to interrupt)", "", ...composer()]);
    // Esc restores the submitted prompt as a composer draft, without a turn-end row.
    paint(composer("Harmless fixture prompt."), "❯ Harmless fixture prompt.");
    scanner.feedOutput("\x1b]0;⠋ muse-project\x07");
    vi.advanceTimersByTime(1500);
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });

    scanner.feedInput("\r");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });
});

describe("Claude and Codex composer activity", () => {
  type ComposerAgent = "claude" | "codex";

  const claudeRule = "─".repeat(40);

  function composer(agent: ComposerAgent, draft: string): string[] {
    if (agent === "claude") {
      return [claudeRule, `❯ ${draft}`, claudeRule];
    }
    return [`› ${draft}`];
  }

  function composerCursor(agent: ComposerAgent, draft: string): string {
    return agent === "claude" ? `❯ ${draft}` : `› ${draft}`;
  }

  function finishedScreen(agent: ComposerAgent, draft: string): string[] {
    return [agent === "claude" ? "✻ Worked for 2s" : "Worked for 2s", ...composer(agent, draft)];
  }

  function terminal(agent: ComposerAgent) {
    const tracker = new TerminalActivityTracker();
    let lines: string[] = [];
    let cursorLine = "";
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: (limit) => lines.slice(-limit),
      readCursorLine: () => cursorLine,
      stillnessMs: 500,
    });
    scanner.handleInitialCommand(agent);
    return {
      tracker,
      scanner,
      paint(next: string[], cursor: string, output = next.join("\n")) {
        lines = next;
        cursorLine = cursor;
        scanner.feedOutput(output);
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores a source error containing quota wording without weakening real notices", () => {
    expect(isSpendLimitScreen(['throw new Error("quota exceeded")'])).toBe(false);
    expect(isSpendLimitScreen(["Quota exceeded"])).toBe(true);
    expect(isSpendLimitScreen(["API rate limit reached"])).toBe(true);
  });

  it.each<ComposerAgent>(["claude", "codex"])(
    "excludes %s composer drafts from quota and approval checks but preserves real notices",
    (agent) => {
      const draft = composerCursor(agent, "quota exceeded; please confirm and continue?");
      expect(isSpendLimitScreen(finishedScreen(agent, "quota exceeded"), agent)).toBe(false);
      expect(isNeedsInputScreen(finishedScreen(agent, "please confirm and continue?"), agent)).toBe(
        false,
      );

      expect(
        isSpendLimitScreen(
          ["You've hit your monthly spend limit · resets 3pm", ...composer(agent, "next task")],
          agent,
        ),
      ).toBe(true);

      const selection = agent === "claude" ? "❯ Continue" : "› 1. Yes, proceed (y)";
      const dialog = ["Do you want to proceed?", selection, ...composer(agent, "next task")];
      expect(isNeedsInputScreen(dialog, agent)).toBe(true);
      expect(isIdleAgentScreen(dialog, composerCursor(agent, "next task"), agent)).toBe(false);
      expect(isIdlePromptLine(draft, agent)).toBe(true);
    },
  );

  it("accepts a Claude draft composer without admitting an unnumbered approval option", () => {
    const screen = finishedScreen("claude", "next task");
    expect(isIdlePromptLine("❯ next task", "claude")).toBe(true);
    expect(isIdleAgentScreen(screen, "❯ next task", "claude")).toBe(true);

    const approval = ["Do you want to proceed?", "❯ Continue", "  No"];
    expect(isNeedsInputScreen(approval, "claude")).toBe(true);
    expect(isIdleAgentScreen(approval, "❯ Continue", "claude")).toBe(false);
  });

  it.each(["›", "»"])(
    "recognizes Codex's %s numbered approval without accepting a numbered draft",
    (prompt) => {
      const selection = `${prompt} 1. Yes, proceed (y)`;
      const dialog = ["Would you like to proceed?", selection, "  2. No"];
      expect(isNeedsInputScreen(dialog, "codex")).toBe(true);
      expect(isIdleAgentScreen(dialog, selection, "codex")).toBe(false);
      expect(isIdlePromptLine(`${prompt} 1. Fix the parser`, "codex")).toBe(false);
    },
  );

  it("leaves Codex's dismissible security banner on a finished turn", () => {
    const composerLine = "› Ask Codex to do anything";
    const screen = [
      "Worked for 3m 56s",
      "Set up security for Daybreak mode",
      "Set up Advanced Account security with a hardware security key. Verify each new",
      "hardware security key with Persona. Already Persona-verified? You can keep using",
      "Codex while you finish setup.",
      "",
      "› 1. Set up security",
      "  2. Not now",
      "",
      "Press a number to choose · esc to dismiss · type to continue",
      composerLine,
      "  GPT-6.1-Sol ultra · main · Context 93% left · weekly 0% left",
      "  ← for agents · ? for shortcuts",
    ];
    expect(isNeedsInputScreen(screen, "codex")).toBe(false);
    expect(isIdleAgentScreen(screen, composerLine, "codex")).toBe(true);

    const approval = [
      "Would you like to proceed?",
      "› 1. Yes, proceed (y)",
      "  2. No",
      composerLine,
      "  ← for agents · ? for shortcuts",
    ];
    expect(isNeedsInputScreen(approval, "codex")).toBe(true);
    expect(isIdleAgentScreen(approval, "› 1. Yes, proceed (y)", "codex")).toBe(false);

    const { tracker, scanner, paint } = terminal("codex");
    scanner.feedInput("\r");
    paint(screen, composerLine);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("keeps Codex working on a truncated dynamic header nearest its composer", () => {
    const busy = ["• Planning the fix (1m 02s", "› Ask Codex to do anything"];
    expect(isCodexBusyScreen(busy)).toBe(true);
    expect(isIdleAgentScreen(busy, "› Ask Codex to do anything", "codex")).toBe(false);
    expect(
      isCodexBusyScreen([
        "• Planning the fix (1m 02s",
        "Worked for 1m 03s",
        "› Ask Codex to do anything",
      ]),
    ).toBe(false);
  });

  it.each<ComposerAgent>(["claude", "codex"])(
    "finishes at a %s draft containing quota wording and keeps a real banner red",
    (agent) => {
      const { tracker, scanner, paint } = terminal(agent);
      scanner.feedInput("\r");
      paint(finishedScreen(agent, "quota exceeded"), composerCursor(agent, "quota exceeded"));
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });

      paint(
        ["You've hit your monthly spend limit · resets 3pm", ...composer(agent, "next task")],
        composerCursor(agent, "next task"),
        "quota notice",
      );
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });
    },
  );

  it("finishes Claude at a draft and gives a later unnumbered dialog priority", () => {
    const { tracker, scanner, paint } = terminal("claude");
    scanner.feedInput("\r");
    paint(finishedScreen("claude", "next task"), "❯ next task");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });

    paint(["Do you want to proceed?", "❯ Continue", "  No"], "❯ Continue");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
  });

  it("resumes Codex after a y approval and finishes after continuous busy repaints", () => {
    const { tracker, scanner, paint } = terminal("codex");
    const composerLine = "› Ask Codex to do anything";
    scanner.feedInput("\r");
    paint(
      ["Would you like to proceed?", "› 1. Yes, proceed (y)", "  2. No"],
      "› 1. Yes, proceed (y)",
    );
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });

    scanner.feedInput("y");
    paint(["Worked for 2s", composerLine], composerLine, "⠋");
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });

    paint(["• Planning the fix (1m 02s", composerLine], composerLine, "02s");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    vi.advanceTimersByTime(400);
    paint(["• Planning the fix (1m 03s", composerLine], composerLine, "03s");
    vi.advanceTimersByTime(400);
    paint(["• Planning the fix (1m 04s", composerLine], composerLine, "04s");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    vi.advanceTimersByTime(400);

    paint(["Worked for 1m 05s", composerLine], composerLine);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it.each<ComposerAgent>(["claude", "codex"])(
    "clears dismissed %s needs-input at the returned composer without finished attention",
    (agent) => {
      const { tracker, scanner, paint } = terminal(agent);
      const selection = agent === "claude" ? "❯ Continue" : "› 1. Yes, proceed (y)";
      const dialog = ["Do you want to proceed?", selection, "  No"];
      scanner.feedInput("\r");
      paint(dialog, selection);
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({
        state: "idle",
        attentionReason: "needs_input",
      });

      tracker.interrupt();
      scanner.handleInterrupt();
      paint([...dialog, ...finishedScreen(agent, "next task")], composerCursor(agent, "next task"));
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: null });
    },
  );
});

describe("Grok and Kimi composer activity", () => {
  type GrokKimiAgent = "grok" | "kimi";

  function grokComposer(draft: string): string[] {
    return ["╭────────────────────╮", `❯ ${draft}`.trimEnd(), "Grok 4.7 (xhigh) · always-approve"];
  }

  function grokFinishedScreen(draft: string): string[] {
    return ["Worked for 4m4s", ...grokComposer(draft)];
  }

  function kimiComposer(draft: string): string[] {
    return ["╭──────╮", `│ > ${draft}`.trimEnd(), "╰──────╯"];
  }

  function kimiStatus(badge = ""): string {
    return `Ask When Needed  K3 thinking: max${badge}  ~/proj  main  context: 29% (290k/1M)`;
  }

  function kimiScreen(draft: string, badge = ""): string[] {
    return [...kimiComposer(draft), kimiStatus(badge)];
  }

  function screenWithDraft(agent: GrokKimiAgent, draft: string): string[] {
    return agent === "grok" ? grokFinishedScreen(draft) : kimiScreen(draft);
  }

  function draftCursor(agent: GrokKimiAgent, draft: string): string {
    return agent === "grok" ? `❯ ${draft}` : `│ > ${draft}`;
  }

  function terminal(agent?: GrokKimiAgent) {
    const tracker = new TerminalActivityTracker();
    let lines: string[] = [];
    let cursorLine = "";
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: (limit) => lines.slice(-limit),
      readCursorLine: () => cursorLine,
      stillnessMs: 500,
    });
    if (agent) scanner.handleInitialCommand(agent);
    return {
      tracker,
      scanner,
      paint(next: string[], cursor: string, output = next.join("\n")) {
        lines = next;
        cursorLine = cursor;
        scanner.feedOutput(output);
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("strips Grok's uncapped startup draft without hiding a real approval", () => {
    const startup = [
      "Grok Build 1.0.60",
      "Tip: Run /compact [context] when chat gets long.",
      "> please confirm?",
      "╰────────────────────── Grok 4.7 (xhigh) · always-approve ─╯",
      "[stable]",
    ];
    expect(isNeedsInputScreen(startup, "grok")).toBe(false);

    const approval = ["Do you want to proceed?", "❯ Allow once", "  Reject", ...grokComposer("")];
    expect(isNeedsInputScreen(approval, "grok")).toBe(true);
    expect(isIdleAgentScreen(approval, "❯", "grok")).toBe(false);

    const { tracker, scanner, paint } = terminal("grok");
    paint(startup, "> please confirm?");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });

    scanner.feedInput("\r");
    paint(approval, "❯");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
  });

  it("finishes Grok's first type-ahead paint after busy and approval checks", () => {
    const draft = "So lets continue one the";
    const finished = grokFinishedScreen(draft);
    expect(isGrokBusyScreen(finished)).toBe(false);
    expect(isNeedsInputScreen(finished, "grok")).toBe(false);
    expect(isIdleAgentScreen(finished, `❯ ${draft}`, "grok")).toBe(true);

    const parked = ["Worked for 4m4s", "⸬ Run tests  1m04s", ...grokComposer(draft)];
    expect(isGrokBusyScreen(parked)).toBe(false);
    expect(isIdleAgentScreen(parked, `❯ ${draft}`, "grok")).toBe(true);

    const { tracker, scanner, paint } = terminal("grok");
    scanner.feedInput("\r");
    paint(finished, `❯ ${draft}`);
    vi.advanceTimersByTime(1500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("reads Kimi running badges only on status rows below the composer", () => {
    const draft = "explain K3 thinking: max [1 task running]";
    const draftScreen = kimiScreen(draft);
    expect(isKimiBusyScreen(draftScreen)).toBe(false);
    expect(isIdleAgentScreen(draftScreen, `│ > ${draft}`, "kimi")).toBe(true);

    const quoted = [kimiStatus(" [1 task running]"), ...kimiScreen("")];
    expect(isKimiBusyScreen(quoted)).toBe(false);
    expect(isKimiBusyScreen(kimiScreen("", " [1 task running]"))).toBe(true);

    const { tracker, scanner, paint } = terminal("kimi");
    scanner.feedInput("\r");
    paint(draftScreen, `│ > ${draft}`);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });

    paint(kimiScreen("", " [1 task running]"), "│ >", "1 task running");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    paint(kimiScreen(""), "│ >");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it.each<GrokKimiAgent>(["grok", "kimi"])(
    "ignores quota wording in a %s draft and keeps a real banner red",
    (agent) => {
      const draft = "why am I out of quota?";
      const screen = screenWithDraft(agent, draft);
      const cursor = draftCursor(agent, draft);
      expect(isSpendLimitScreen(screen, agent)).toBe(false);

      const banner =
        agent === "grok" ? "You've hit your monthly spend limit" : "Model rate limit reached";
      const quotaScreen = [banner, ...screenWithDraft(agent, "next task")];
      expect(isSpendLimitScreen(quotaScreen, agent)).toBe(true);

      const { tracker, scanner, paint } = terminal(agent);
      scanner.feedInput("\r");
      paint(screen, cursor);
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });

      paint(quotaScreen, draftCursor(agent, "next task"), "quota notice");
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });
    },
  );

  it.each<GrokKimiAgent>(["grok", "kimi"])(
    "recognizes a fresh %s screen after an earlier command finishes",
    (agent) => {
      const restored =
        agent === "grok"
          ? ["⸬ Run tests  1m04s", ...grokComposer("")]
          : kimiScreen("", " [1 task running]");
      const { tracker, scanner, paint } = terminal();
      paint(["ordinary shell output"], "");
      expect(scanner.getActiveAgent()).toBeNull();
      scanner.handleCommandFinished();

      paint(restored, agent === "grok" ? "❯" : "│ >");
      expect(scanner.getActiveAgent()).toBe(agent);
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    },
  );
});

describe("Antigravity, Gemini, and Cursor terminal activity", () => {
  type RemainingAgent = "antigravity" | "gemini" | "cursor";

  function terminal(agent: RemainingAgent) {
    const tracker = new TerminalActivityTracker();
    let lines: string[] = [];
    let cursorLine = "";
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: (limit) => lines.slice(-limit),
      readCursorLine: () => cursorLine,
      stillnessMs: 500,
    });
    const command = { antigravity: "agy", cursor: "cursor-agent", gemini: "gemini" }[agent];
    scanner.handleInitialCommand(command);
    return {
      tracker,
      scanner,
      paint(next: string[], cursor: string, output = next.join("\n")) {
        lines = next;
        cursorLine = cursor;
        scanner.feedOutput(output);
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sanitizes Antigravity's bare draft without hiding selections or quota notices", () => {
    const draft = "please confirm and run the tests";
    const screen = ["Antigravity ready.", `> ${draft}`];
    expect(isNeedsInputScreen(screen, "antigravity")).toBe(false);
    expect(isSpendLimitScreen(["> explain insufficient quota errors"], "antigravity")).toBe(false);
    expect(isSpendLimitScreen(["You are out of quota. Stop.", ...screen], "antigravity")).toBe(
      true,
    );
    expect(isIdleAgentScreen(screen, `> ${draft}`, "antigravity")).toBe(false);
    expect(isIdleAgentScreen(["Done.", ">"], ">", "antigravity")).toBe(true);

    const trust = [
      "Accessing workspace:",
      "/Users/test/project",
      "Do you trust the contents of this project?",
      "Antigravity CLI requires permission to read, edit, and execute files here.",
      "> Yes, I trust this folder",
      "  No, exit",
      "  ↑/↓ Navigate · enter Confirm",
    ];
    expect(isNeedsInputScreen(trust, "antigravity")).toBe(true);

    const { tracker, scanner, paint } = terminal("antigravity");
    paint(screen, `> ${draft}`);
    vi.advanceTimersByTime(1500);
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });

    scanner.feedInput("\r");
    paint(trust, "> Yes, I trust this folder");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
  });

  it("keeps Antigravity's ruled composer idle while drafting after an interrupted turn", () => {
    expect(detectAgentFromOutput("Antigravity CLI 1.4.2\n")).toBe("antigravity");

    const draft = "> Can you add openaoe2 to paseo neo under app";
    const interruptedWithDraft = [
      "─".repeat(40),
      "> Can you add open AOE2 and OpenD2R to paseo apps workspace as a project?",
      "▸ Thought for 3.6s",
      "● Bash(ls -la)",
      "  └ Interrupted · What should Antigravity CLI do instead?",
      "─".repeat(40),
      draft,
      "─".repeat(40),
      "                                                             Gemini 4 Argon · high",
    ];
    expect(isNeedsInputScreen(interruptedWithDraft, "antigravity")).toBe(false);
    expect(isIdleAgentScreen(interruptedWithDraft, draft, "antigravity")).toBe(true);

    const wrappedDraft = [
      "  └ Interrupted · What should Antigravity CLI do instead?",
      "─".repeat(40),
      "> Can you add open AOE2 and OpenD2R to paseo",
      "  apps workspace as a project?",
      "─".repeat(40),
      "? for shortcuts                                              Gemini 4 Argon · high",
    ];
    expect(isNeedsInputScreen(wrappedDraft, "antigravity")).toBe(false);
    expect(isIdleAgentScreen(wrappedDraft, "  apps workspace as a project?", "antigravity")).toBe(
      true,
    );

    const { tracker, scanner, paint } = terminal("antigravity");
    scanner.feedInput("\r");
    tracker.interrupt();
    scanner.handleInterrupt();
    paint(interruptedWithDraft, draft, "app");
    vi.advanceTimersByTime(1500);
    expect(tracker.getSnapshot()).toMatchObject({ state: null, attentionReason: null });
  });

  it("keeps Antigravity working while a subagent is still running", () => {
    const running = [
      "The main analysis is complete; awaiting the engine revision.",
      ">",
      "  ● Agent(self: McLaren Engine Revision Engineer)  Run installed checks · 28m5s",
      "? for shortcuts                         Gemini 4 Argon · high · 1 subagent(s)",
    ];
    expect(isAntigravityBusyScreen(running)).toBe(true);
    expect(
      isAntigravityBusyScreen([
        ">",
        "? for shortcuts        Gemini 4 Argon · high · 1 task(s) · /tasks · 1 subagent(s)",
      ]),
    ).toBe(true);
    expect(
      isAntigravityBusyScreen([
        "─".repeat(40),
        ">",
        "─".repeat(40),
        "esc to cancel                                               Gemini 4 Argon · high",
      ]),
    ).toBe(true);
    expect(isAntigravityBusyScreen([">", "Gemini 4 Argon · high · 1 task(s) · /tasks"])).toBe(
      false,
    );
    expect(isIdleAgentScreen(running, ">", "antigravity")).toBe(false);
    expect(isAntigravityBusyScreen(["The main analysis is complete.", ">", "0 subagent(s)"])).toBe(
      false,
    );

    const { tracker, scanner, paint } = terminal("antigravity");
    scanner.feedInput("\r");
    paint(["The main analysis is complete.", ">"], ">");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });

    paint(running, ">");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
  });

  it("detects and promotes a compacted Antigravity session in a renamed tab when its startup banner scrolled away", () => {
    const compactedRunning = [
      "──────────────────────────── Conversation compacted ────────────────────────────",
      "○ Thought for 4m 55s (The `sound_compare` script might provide clues about ar...)",
      "● Ran 12 commands (10 failed)",
      "● Explored 2 files (RacelineEngineSoundWave.cpp, sound_com...) (ctrl+o to expand)",
      "⠇ Reading file...",
      "└ Tip: Use /cs to search in your codebase.",
      "─".repeat(60),
      "> ",
      "─".repeat(60),
      "esc to cancel                                              Gemini 4 Argon · high",
    ];
    expect(detectAgentFromOutput(compactedRunning.join("\n"))).toBe("antigravity");
    expect(isAntigravityBusyScreen(compactedRunning)).toBe(true);
    expect(isIdleAgentScreen(compactedRunning, "> ", "antigravity")).toBe(false);

    const tracker = new TerminalActivityTracker();
    let screenLines = compactedRunning;
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: () => screenLines,
      readCursorLine: () => "> ",
      stillnessMs: 500,
    });

    // Renamed tab: no initial command or title detection, only live spinner output after compaction.
    scanner.feedOutput("⠇ Reading file...");
    expect(scanner.getActiveAgent()).toBe("antigravity");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    screenLines = [
      ...compactedRunning.slice(0, 4),
      "▸ Thought for 5m 10s",
      "  Finished the comparison.",
      "─".repeat(60),
      "> ",
      "─".repeat(60),
      "? for shortcuts                                            Gemini 4 Argon · high",
    ];
    scanner.feedOutput("Finished the comparison.");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("clears Antigravity when it quits back to the shell", () => {
    const shellPrompt = "Legoless at LegoBrain in ~/Projects/unifiedsense/raceline (main)";
    const exited = [
      "Resume with -c (or command below):",
      "agy --conversation=4ce22698-2d9e-4a68-bdd3-b9c46615f29a",
      "Welcome to the Antigravity CLI",
      "Antigravity CLI 1.4.0",
      "Gemini 4 Argon · high · 1 subagent(s)",
      ">",
      "  ● Agent(self: McLaren Engine Revision Engineer)  Run installed checks · 28m5s",
      "Resume with -c (or command below):",
      "agy --conversation=4ce22698-2d9e-4a68-bdd3-b9c46615f29a",
      shellPrompt,
    ];
    expect(isAntigravityBusyScreen(exited)).toBe(false);
    expect(isIdleAgentScreen(exited, shellPrompt, "antigravity")).toBe(false);
    expect(
      isAntigravityBusyScreen([
        "Resume with -c (or command below):",
        "Welcome to the Antigravity CLI",
        ">",
        "Gemini 4 Argon · high · 1 subagent(s)",
      ]),
    ).toBe(true);

    const { tracker, scanner, paint } = terminal("antigravity");
    scanner.feedInput("\r");
    paint(
      [
        "Investigating.",
        ">",
        "  ● Agent(self: McLaren Engine Revision Engineer)  Run installed checks · 28m5s",
        "Gemini 4 Argon · high · 1 subagent(s)",
      ],
      ">",
    );
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    // The banner is in the chunk before the headless screen includes it.
    scanner.feedOutput("Resume with -c (or command below):\n");
    expect(tracker.getSnapshot().state).toBeNull();
    expect(scanner.getActiveAgent()).toBeNull();

    paint(exited, shellPrompt, "⣷");
    vi.advanceTimersByTime(2000);
    expect(tracker.getSnapshot().state).toBeNull();
    expect(scanner.getActiveAgent()).toBeNull();
  });

  it("keeps Gemini working on its elapsed status and finishes at the placeholder", () => {
    const placeholder = "│ >   Type your message or @path/to/file";
    expect(isIdlePromptLine(placeholder, "gemini")).toBe(true);
    expect(isIdlePromptLine("> Type your message or @path/to/file", "gemini")).toBe(true);
    expect(isIdlePromptLine("│   > Type your message or @path/to/file │", "gemini")).toBe(true);
    expect(isIdlePromptLine("│ > explain something", "gemini")).toBe(false);

    const busy = ["⠇ Addressing User's Inquiry (esc to cancel, 15s)", placeholder];
    expect(isGeminiBusyScreen(busy)).toBe(true);
    expect(isIdleAgentScreen(busy, placeholder, "gemini")).toBe(false);
    const finished = ["✓ Done.", placeholder];
    expect(isGeminiBusyScreen(finished)).toBe(false);
    expect(isIdleAgentScreen(finished, placeholder, "gemini")).toBe(true);

    const { tracker, scanner, paint } = terminal("gemini");
    scanner.feedInput("\r");
    paint(busy, placeholder, "15s");
    vi.advanceTimersByTime(2500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    paint(finished, placeholder);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("recognizes Gemini's daily quota notice without matching source text", () => {
    const notice = "✕ [API Error: You have exhausted your daily quota on this model.]";
    expect(isSpendLimitScreen([notice], "gemini")).toBe(true);
    expect(isSpendLimitScreen(['throw new Error("exhausted your daily quota")'])).toBe(false);

    const placeholder = "│ >   Type your message or @path/to/file";
    const { tracker, scanner, paint } = terminal("gemini");
    scanner.feedInput("\r");
    paint([notice, placeholder], placeholder);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });
  });

  it("finishes Cursor at follow-up placeholders without admitting drafts or busy rows", () => {
    const placeholders = ["→ Add a follow-up", "→ Add a follow-up — /plan to review and build"];
    for (const placeholder of placeholders) {
      expect(isIdleAgentScreen(["OK", `  ${placeholder}`], "", "cursor")).toBe(true);
    }
    expect(isIdleAgentScreen(["OK", "  → Add a follow-up now"], "", "cursor")).toBe(false);
    expect(isIdleAgentScreen(["  → Add a follow-up", "ctrl+c to stop"], "", "cursor")).toBe(false);

    const { tracker, scanner, paint } = terminal("cursor");
    for (const placeholder of placeholders) {
      scanner.feedInput("\r");
      paint(["OK", `  ${placeholder}`], "");
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
      tracker.clearAttention();
    }
  });

  it("marks Cursor's out-of-usage error below its footer as quota instead of finished", () => {
    const { tracker, scanner, paint } = terminal("cursor");
    const composer = "→ Add a follow-up";
    const screen = [
      "Edit sim_effects.gd Interrupted",
      "Edit map_loader.gd Interrupted",
      "Edit sim_world.gd Interrupted",
      "Goal active (10h 54m 1s)",
      composer,
      "Grok 4.7 500K Extra High Fast · MAX · 79.2% · 116 files edited Run Everything",
      "~/Projects/legoless/OpenAOE2 · main",
      "",
      "\x1b[31mError: Increase limits for faster responses\x1b[0m",
      "You're out of usage. Switch to Auto, or ask your admin to increase your limit",
      "to continue.",
    ];

    scanner.feedInput("\r");
    paint(screen, composer);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "quota" });

    tracker.clearAttention();
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: null });

    scanner.feedInput("\r");
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });
    paint(["Done", composer], composer);
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });

  it("keeps Cursor pending decisions orange instead of clearing them", () => {
    const decision = [
      "Ready to proceed?",
      "→ 1. Proceed (enter)",
      "  2. Mark as fixed (f)",
      "→ Waiting for decision (y/n/p)...",
    ];
    expect(isCursorNeedsInputScreen(decision)).toBe(true);
    expect(isIdleAgentScreen(decision, "", "cursor")).toBe(false);
    expect(
      isIdleAgentScreen(
        ["  → Plan, search, build anything", "Allow Cursor to run this command? [y/N]"],
        "",
        "cursor",
      ),
    ).toBe(false);

    const { tracker, scanner, paint } = terminal("cursor");
    scanner.feedInput("\r");
    paint(decision, "");
    vi.advanceTimersByTime(1500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "needs_input" });
  });
});

describe("stale dialog and Cursor footer regressions", () => {
  type DialogAgent = "claude" | "codex" | "grok";
  type RegressionAgent = DialogAgent | "cursor";

  const commands: Record<RegressionAgent, string> = {
    claude: "claude",
    codex: "codex",
    grok: "grok",
    cursor: "cursor-agent",
  };

  function liveDialog(agent: DialogAgent): string[] {
    if (agent === "codex") {
      return ["Do you want to proceed?", "› 1. Yes, proceed (y)", "  2. No"];
    }
    if (agent === "grok") {
      return ["Do you want to proceed?", "❯ Allow once", "  Reject"];
    }
    return ["Do you want to proceed?", "❯ Continue", "  No"];
  }

  function finishedScreen(agent: DialogAgent): string[] {
    if (agent === "claude") {
      return ["✻ Worked for 2s", "─".repeat(40), "❯", "─".repeat(40)];
    }
    if (agent === "codex") {
      return ["Worked for 4m4s", "› Ask Codex to do anything"];
    }
    return ["Worked for 4m4s", "╭────────────────────╮", "❯", "Grok 4.7 (xhigh) · always-approve"];
  }

  function idleCursor(agent: DialogAgent): string {
    return agent === "codex" ? "› Ask Codex to do anything" : "❯";
  }

  function terminal(agent: RegressionAgent) {
    const tracker = new TerminalActivityTracker();
    let lines: string[] = [];
    let cursorLine = "";
    const scanner = new PtyActivityScanner({
      setActivity: (state, attentionReason) => tracker.set(state, attentionReason),
      clearActivity: () => tracker.clear(),
      getActivity: () => tracker.getSnapshot(),
      readLastLines: (limit) => lines.slice(-limit),
      readCursorLine: () => cursorLine,
      stillnessMs: 500,
    });
    scanner.handleInitialCommand(commands[agent]);
    return {
      tracker,
      scanner,
      paint(next: string[], cursor: string, output = next.join("\n")) {
        lines = next;
        cursorLine = cursor;
        scanner.feedOutput(output);
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each<DialogAgent>(["claude", "codex", "grok"])(
    "finishes %s without re-raising a dialog closed by the turn-end marker",
    (agent) => {
      const dialog = liveDialog(agent);
      const selection = dialog[1];
      const resolved = [...dialog, ...finishedScreen(agent)];
      const cursor = idleCursor(agent);
      expect(isNeedsInputScreen(dialog, agent)).toBe(true);
      expect(isIdleAgentScreen(dialog, selection, agent)).toBe(false);
      expect(isNeedsInputScreen(resolved, agent)).toBe(false);
      expect(isIdleAgentScreen(resolved, cursor, agent)).toBe(true);

      const { tracker, scanner, paint } = terminal(agent);
      scanner.feedInput("\r");
      paint(dialog, selection);
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({
        state: "idle",
        attentionReason: "needs_input",
      });

      scanner.feedInput("\r");
      paint(resolved, cursor);
      vi.advanceTimersByTime(500);
      expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
    },
  );

  it("ignores Cursor prose above the composer but rejects a live busy footer", () => {
    const placeholder = "→ Plan, search, build anything";
    const prose = ["The server is running; ctrl+c to stop it.", placeholder];
    const busy = [placeholder, "ctrl+c to stop"];
    expect(isIdleAgentScreen(prose, "", "cursor")).toBe(true);
    expect(isIdleAgentScreen(busy, "", "cursor")).toBe(false);

    const { tracker, scanner, paint } = terminal("cursor");
    scanner.feedInput("\r");
    paint(busy, "");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "working", attentionReason: null });

    paint(prose, "");
    vi.advanceTimersByTime(500);
    expect(tracker.getSnapshot()).toMatchObject({ state: "idle", attentionReason: "finished" });
  });
});
