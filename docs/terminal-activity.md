# Terminal Activity Indicators

Paseo surfaces terminal activity as a tab indicator (the same marks used by agents) and as a matching colored glow on the pane that holds the active tab: blue while working, orange while blocked on input, red on a spend or quota limit, green when the turn finished and is ready for the next task. Plain idle terminals and file panes stay unadorned. Agent panes use the same overlay, with red also for other errors, and glow blue while the agent's [background work](agent-lifecycle.md#workspace-activity) is still running. Green follows finished attention on both, so it clears when you focus the pane. Settings → Appearance → Pane status glow turns every overlay off; Terminal agent glow turns off only terminal overlays.

## Current state

Terminal activity is source-agnostic plumbing. `TerminalActivityTracker` holds the current per-terminal state and emits transitions to the manager, worker protocol, websocket subscription, app buckets, dots, and notifications.

Activity is driven automatically by `PtyActivityScanner`, which monitors the terminal PTY stream, keystrokes, and titles for supported agent CLIs (`claude`, `codex`, `grok`, `agy`/`antigravity`, `opencode`, `pi`, `copilot`, `cursor-agent`, etc.). The scanner marks turns working on prompt submission or when the spawn command already includes a print/exec prompt (`claude -p`, `codex exec`). It flags interactive approval pauses as `needs_input`, and concludes completed turns as finished attention once the screen settles at the agent's prompt. Antigravity leaves its `>` composer up while a task is still running; a status line ending in `running`, or a non-zero `N task(s)` count, stays working instead of turning green. Claude does the same after a turn whose background work is still going: its turn line above the composer ends in `N shell(s) still running` or reads `Waiting for N background agent(s) to finish`, and that screen stays working too. A working screen that stays still across three samples with no prompt or question clears without finished attention, so a hung TUI does not stay blue. That check follows the tracker, which hooks write directly: working reported by a hook settles at the next still screen after PTY output (a Codex subagent's tool hooks can arrive after the turn's Stop, and Codex sends no Stop for subagents), and a finish or approval reported by a hook is never cleared as a hung turn. Codex's idle prompt is its composer line, `› ` plus the placeholder or a draft. Codex keeps that composer up while a turn runs, so a screen that still shows its `Working (12s • esc to interrupt)` status line stays working. The stillness clock starts when the scanner marks the turn working, including Enter or print/exec with no further output. A hook report does not start it. A spend or quota banner is red (`attentionReason: "quota"`, the `failed` bucket) for every supported agent CLI. That includes the banner that appears as the turn ends, so a Stop hook's idle report cannot repaint it green. An approval stays orange. Focusing the pane clears the red glow, and the next submitted turn clears the reason. Optional hook commands can also report coarse activity to the daemon's `/api/terminal-activity` endpoint.

## Architecture

```
TerminalSession
  ├── TerminalActivityTracker               one per session
  │     ├── set(state)                      records the latest state
  │     └── onChange(snapshot, previous)    fires only on resolved-state transitions
  │
  └── onActivityChange({ activity, previous })   subscribed in TerminalManager
        ├── emits terminalsChanged          terminal list/tab indicators only
        └── subscribeTerminalActivity       per-transition stream for notification policy
        └── subscribeTerminalWorkspaceContributionChanged  workspace status rollup only
```

`TerminalActivityTracker` is the single stateful object per session. It holds `{ state, changedAt }`, starts at unknown (`null`), and fires `onChange` only when the state actually changes.

Terminal directory snapshots (`terminalsChanged`) and workspace contribution changes are separate concerns. A title-only change produces a terminal list snapshot but never touches workspace descriptors. A transition that changes the derived workspace bucket (e.g. idle -> working, working -> idle, attention cleared) emits both a terminal list snapshot and a server-internal `TerminalWorkspaceContributionChanged` event, which Session consumes to invalidate every active workspace sharing the owning workspace's `cwd`.

### Transitions carry their own history

Each `onChange` delivers both the new snapshot and the `previous` one (`{ state, changedAt }`). The transition flows unchanged up through `TerminalSession.onActivityChange` (as `{ activity, previous }`), the worker protocol's `terminalActivityChange` event, and the manager-level `subscribeTerminalActivity(listener)` stream (`{ terminalId, name, cwd, activity, previous }`).

The daemon consumes these transitions, not snapshots. When a transition moves from `working` to `idle`, the tracker records finished attention, so the terminal shows the same green finished dot as an idle agent that needs review. The websocket layer also fires a "Terminal finished" attention notification. A terminal that exits while still working emits no turn-end notification.

Terminal list visibility is `workspaceId`-scoped: a terminal belongs to the workspace that created it, and same-`cwd` sibling workspaces do not see it in their terminal lists. Terminal status routing starts from that owning workspace, uses the owning workspace's `cwd`, then fans the status bucket out to every active workspace with the same `cwd`.

Path-prefix routing is only a legacy fallback for unowned terminal activity contribution. If a live terminal has no `workspaceId`, the daemon resolves the deepest active parent workspace from the terminal `cwd`, then fans status out to active same-`cwd` siblings of that owner. That fallback contributes status, but it does not make the terminal visible in workspace-scoped terminal lists.

## Hook reporting

Terminals receive four environment variables when the daemon creates the shell:

- `PASEO_TERMINAL_ID`
- `PASEO_ACTIVITY_TOKEN`
- `PASEO_TERMINAL_ACTIVITY_URL`
- `PASEO_HOOK_CLI` — absolute path to the current `paseo` CLI executable.

These four variables are the terminal's hook identity, and only the daemon's own terminals carry one. The daemon worker deletes them from its own environment at startup and `createProviderEnv` strips them from agent spawns: a daemon started from inside a Paseo pane would otherwise let its agents, scripts, and services post activity into that pane.

The generated shell command uses `PASEO_HOOK_CLI` to run the current CLI. `paseo hooks <agent> <event>` then reads the terminal id, token, and activity URL, reads the hook's stdin payload once, asks the agent hook provider registry to resolve the event to a coarse activity state, and silently posts `{ terminalId, token, state, sessionId? }` to the activity URL. `state` is `running`, `idle`, `needs-input`, or `quota`; `sessionId` is the payload's `session_id` (Claude and Codex). The CLI never writes to stdout, because Claude adds `UserPromptSubmit` stdout to the model's context. Missing env, unsupported agents/events, malformed hook input, and daemon/network failures are no-ops so agent hooks never break the user's terminal session. An older daemon drops `sessionId` and rejects `quota`; the CLI fails open.

Claude hook mapping:

- `UserPromptSubmit` → `running`, installed with `"async": true` so Claude does not wait about 0.3 s for the CLI's startup before each prompt. Claude versions that do not know the key ignore it and run the hook synchronously.
- `Stop` → `idle`, or `running` while its `background_tasks` payload lists a task with status `running`. Claude resumes a turn when that work finishes.
- `StopFailure` → `quota` when its `error` is `rate_limit` or `billing_error`, otherwise `idle`.
- `Notification` → `needs-input` for the dialog types `permission_prompt`, `elicitation_dialog`, `elicitation_url_dialog`, `worker_permission_prompt`, and `agent_needs_input`. Claude sends them once a dialog has stayed open about 6 s without input, so the scanner usually shows the dialog first. `idle_prompt` is ignored: Claude sends it a minute after a finished turn, which `Stop` already recorded, and mapping it turned finished panes orange.

`SessionEnd` is not installed. The shell's command-finished already clears activity when Claude exits, and its idle report turned `/exit` into a finished turn.

Claude does not run `Stop` when the user interrupts a turn. A standalone Ctrl-C or Escape input
while terminal activity is working clears the activity without finished attention. The same
fallback applies to every hooked terminal agent; exact input matching excludes escape sequences and
pasted content, while later provider idle events remain authoritative.

Codex hook mapping:

- `UserPromptSubmit` → `running`
- `PreToolUse`, `PostToolUse` → `running`
- `PermissionRequest` → `needs-input`
- `Stop` → `idle`

OpenCode uses a server plugin instead of command hooks. Both generations discover the same global plugin file. Their loaders select separate entrypoints: OpenCode 1 calls `server()` with `{ type, properties }` bus events; OpenCode 2 calls `setup()` and subscribes to decoded `{ type, data }` events. Do not share their status mapping: V1 publishes `session.status` snapshots, while V2 publishes `session.execution.*` transitions.

| OpenCode event                                              | Generation | Activity    |
| ----------------------------------------------------------- | ---------- | ----------- |
| `session.status` with `busy` or `retry`                     | 1          | running     |
| `session.status` with `idle`                                | 1          | idle        |
| `session.execution.started`                                 | 2          | running     |
| `session.execution.succeeded`, `.failed`, or `.interrupted` | 2          | idle        |
| `permission.asked`                                          | Both       | needs-input |
| `permission.replied`                                        | Both       | running     |

The plugin translates both event contracts into the existing Paseo hook events. OpenCode 2 disposes its event subscription when the plugin unloads.

The daemon maps hook states onto terminal activity like an agent lifecycle plus unread attention: `running` → `state: working`, `idle` → `state: idle`, `needs-input` → `state: idle` with `attentionReason: needs_input`, and `quota` → `state: idle` with `attentionReason: quota`. A `working` → `idle` transition records `state: idle` with `attentionReason: finished` until the user focuses that terminal; plain idle terminals still contribute no workspace status.

A nested agent inherits the pane's hook env, so a `claude -p` run by Claude's Bash tool, an advisor, or a teammate posts its own `running` and `idle` into the same terminal. `TerminalActivityTracker` therefore remembers the session whose report started or first confirmed the turn, and while the terminal is working it ignores reports from any other session. Starting a turn from a non-working state makes the reporter the owner; the owner is cleared on finish, quota, interrupt, clear, or command-finished and kept across `needs_input`, so the outer session resumes after an approval. Scanner updates and reports without a `sessionId` are never gated.

## Focus clearing

Client heartbeats include the focused terminal id. When a visible client focuses a terminal with an `attentionReason`, the daemon clears the attention and leaves the terminal idle. Plain idle terminal activity does not contribute to workspace status, so a workspace whose only attention source was that terminal rolls up from `needs_input` or `attention` back to `done`.

### Agent hook installation

Installing hooks edits the user's real agent config files, so it is opt-in. The daemon setting
`enableTerminalAgentHooks` (persisted under `daemon.enableTerminalAgentHooks`, default `false`)
gates installation. It is surfaced in the app under a host's **Terminals** settings as "Enable
terminal agent hooks" — "Get notifications and status from terminal agents. This installs hooks in
your agent config files." `applyTerminalAgentHookSetting` reconciles the installed hooks with the
setting: at startup it installs only when enabled; toggling the setting live installs on enable and
removes Paseo's marker-matched hooks on disable. `paseo hooks` keeps working regardless — the gate
only controls whether the daemon writes hooks into agent configs, not whether the CLI can post
activity when the env is present.

When enabled, Paseo installs provider hooks globally:

- Claude hooks are written to `~/.claude/settings.json` (or `CLAUDE_CONFIG_DIR/settings.json` when that override is set).
- Codex hooks are written to `~/.codex/hooks.json` (or `CODEX_HOME/hooks.json` when that override is set). Codex supports a native `commandWindows`, so each Paseo hook includes both POSIX and Windows commands. Non-managed Codex hooks are trust-gated by Codex; users may see Codex's hook review prompt before the hook runs.
- OpenCode gets a self-contained plugin at `$XDG_CONFIG_HOME/opencode/plugins/paseo-terminal-activity.js` (or `~/.config/opencode/plugins/paseo-terminal-activity.js` when XDG is unset; `OPENCODE_CONFIG_DIR` still wins when set).

Installation is marker-based/idempotent for config hooks and exact-file/idempotent for the OpenCode plugin. Paseo preserves user hooks, removes only its own marker-matched command hooks, and leaves hooks installed across daemon shutdown. Every install and uninstall sweeps Paseo's hooks from all events, not only the current ones, so an event Paseo stops installing disappears from configs an older version wrote. Outside a Paseo terminal they are inert because the command or plugin is gated on `PASEO_TERMINAL_ID`.

Every Paseo daemon on the machine (for example the packaged app and the dev stack) shares these global configs, and disabling the setting in any of them removes the hooks for all. A daemon whose setting is on therefore checks for its hooks each time it creates a terminal and reinstalls them if they are missing, with one warning in the daemon log. That check only looks for a marker-matched hook per event: a changed command text is rewritten at startup or when the setting is toggled.

Provider variation lives in `AGENT_HOOK_PROVIDERS`: provider id, installed events, config install metadata, and runtime event-to-activity resolution. The daemon calls `installRegisteredAgentHooks()` once; the CLI calls `resolveHookActivity(provider, event, input)`. Adding a provider should add one provider entry and register it in `AGENT_HOOK_PROVIDERS`, without editing the generic CLI command or daemon bootstrap.

The installed hook command keeps the config portable and resolves the CLI at runtime:

```sh
if [ -n "$PASEO_TERMINAL_ID" ]; then "${PASEO_HOOK_CLI:-paseo}" hooks claude <event> 2>/dev/null || true; fi
```

Codex also receives the Windows equivalent:

```bat
if defined PASEO_TERMINAL_ID (if defined PASEO_HOOK_CLI ("%PASEO_HOOK_CLI%" hooks codex <event> 2>nul || exit /b 0) else (paseo hooks codex <event> 2>nul || exit /b 0)) else (exit /b 0)
```

A missing or broken CLI stays silent: Claude and Codex print a hook's stderr and non-zero exit as errors on every turn. Codex trusts hooks by their command text, so a change to this command makes Codex ask to review Paseo's hooks again.

The daemon resolves the current CLI through `PASEO_CLI` when its launcher supplies one, or through the npm package shim for standalone installs. The desktop app always sets `PASEO_CLI`: the bundled shim when packaged, and the workspace `packages/cli/bin/paseo` when not, because an unpackaged Electron has no bundled shim and its hooks exited 127. Dev hooks run the built `packages/cli/dist`, so rebuild the CLI before testing hook changes in dev terminals. Terminal setup exposes that resolved executable to hooks as `PASEO_HOOK_CLI`; desktop and other daemon launchers do not know about the hook-specific variable. The generated command falls back to bare `paseo` if the hook env is missing and no-ops outside Paseo terminals because the `PASEO_TERMINAL_ID` gate remains first. Paseo also prepends the resolved CLI directory to each terminal `PATH` as a secondary fallback. All other behavior lives in `paseo hooks`: read the env, map the event, POST activity, and no-op/fail-open when anything is missing or unavailable.

If config installation fails, daemon startup and terminal spawn continue without terminal activity hooks.
