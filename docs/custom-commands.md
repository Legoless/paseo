# Custom commands

A custom command is a titled snippet of text. Picking it from the **Commands** dropdown — or pressing
its keyboard shortcut — types the text into the agent composer or the focused terminal and, by
default, presses Enter. Commands are JSON files the daemon serves; the app never reads the files
itself.

The dropdown sits next to the Git actions: in each pane's project tray, in the workspace header on
desktop without pane splits, and in the compact header cluster on mobile. The tray's visibility
ellipsis menu can hide it.

## Where the files live

```
$PASEO_HOME/commands.json                  # global, every project
<project-root>/.paseo-neo/commands.json    # one project
```

```json
{
  "commands": [
    {
      "id": "run-tests",
      "title": "Run tests",
      "text": "npm test",
      "target": "terminal",
      "submit": true,
      "shortcut": "Cmd+Shift+R"
    }
  ]
}
```

- `title` and `text` are required. Everything else has a default.
- `id` — optional. Derived from the title when omitted: lowercase, non-alphanumeric runs become one
  dash. A title with no letters or numbers fails the file; give that entry an explicit `id`.
- `target` — `"agent"` (default) or `"terminal"`.
- `submit` — default `true`. With `false`, the text waits for you to send it.
- `shortcut` — an app-side key combo like `"Cmd+Shift+R"` (`Cmd`/`Ctrl`/`Alt`/`Shift`/`Mod` plus a
  key). The daemon treats it as opaque text; a combo that cannot parse degrades to no shortcut.

A project command with the same `id` as a global one shadows it: the project entry runs, and the
global one leaves the menu.

## What running one does

**Agent target.** The focused pane's chat tab answers first, then any visible chat. With
`submit: true` the message is sent through the same path the app uses to drain queued messages — the
mounted composer is never touched, and the draft is cleared. With `submit: false` the text replaces
the composer's draft and the tab is surfaced. A draft tab (no agent yet) always takes the second
path, whatever `submit` says — there is nothing to send to yet.

**Terminal target.** The focused pane's terminal tab, then any visible terminal. The text is typed
at the prompt; `submit: true` appends the carriage return. The tab is surfaced either way.

No matching tab at all is a toast, not a silent drop.

## Shortcuts

Command shortcuts fire globally on desktop and web, including while a terminal or text field is
focused — that is the point of them. They bind as `user-command.<id>` and sit after the built-ins in
the matcher, which takes the first match: a combo a built-in already owns never fires, and the menu
marks the row "Shortcut in use" instead of letting you discover that.

Rebind or unassign under **Settings → Shortcuts → Commands**; overrides are the same per-binding
record the built-ins use. Mobile has no keyboard shortcuts — the menu is the only surface there.

## Refresh model

There is no file watcher on either file. Global commands reload on `paseo daemon reload` and ride
the daemon config payload (`customCommands`, plus `customCommandErrors` when the file is unusable).
Project commands are fetched per workspace project cwd through `commands.project.list.request` —
on workspace entry and each time the menu opens.

The daemon matches project roots exactly, so the app passes the workspace's project cwd, never a
pane's nested directory; an unknown cwd is an empty answer, not an error. A project file that fails
to read or parse lands as a muted error row in the menu, and a broken global file lands the same way
— the commands themselves are better absent than half-applied.

`server_info.features.customCommands` gates the whole feature: against an older daemon the dropdown
and the shortcuts are absent.
