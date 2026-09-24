# Custom commands

A custom command is a titled snippet of text. The commands button runs the first one, the same way
the git button runs its primary action. The caret opens the full list, and a keyboard shortcut runs
one from anywhere. Either way the text goes into the tab it was run from, a chat or a terminal, and
by default presses Enter. Commands are JSON files the daemon serves; the app never reads the files
itself.

The control sits next to the Git actions: in each pane's project tray, in the workspace header on
desktop without pane splits, and in the compact header cluster on mobile. Use the tray’s ellipsis
menu (left or right click) to show or hide **Commands**, alongside Branch, Editor, and Git. An
enabled control stays visible even when no commands exist; **Manage commands…** opens
**Settings → Host → Commands** for that host. Hiding the control does not unbind shortcuts: the
keyboard hook loads the active workspace's commands itself (`useCustomCommandsSync`).

## Editing commands

Use **Settings → Host → Commands** to add, edit, or delete global commands. Set the name, text,
whether to submit immediately, and an optional keyboard shortcut. To set the shortcut, click the
field and press a combo with Cmd, Ctrl or Alt, or an F-key; other keys are typing and are ignored.
Esc, Tab or clicking away cancels; Delete or Backspace clears. The primary modifier is saved as
`Mod` (Cmd on a Mac, Ctrl elsewhere) because every client of the host binds the same file. The field
keeps one combo; bind a multi-step chord under **Settings → Shortcuts**. The field is hidden on mobile, which has no
shortcuts. These commands are available across the host’s projects. Project-specific commands remain
file-authored.

Settings writes the global file atomically and updates connected clients without a daemon restart
or reload. Renaming preserves command identity and shortcut overrides. A stale editor cannot overwrite
another window’s changes: close it and reopen the command to use the latest version. A malformed
commands file must be repaired before Settings can save over it.

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
      "submit": true,
      "shortcut": "Cmd+Shift+R"
    }
  ]
}
```

- `title` and `text` are required. Everything else has a default.
- `id` — optional. Derived from the title when omitted: lowercase, non-alphanumeric runs become one
  dash. A title with no letters or numbers fails the file; give that entry an explicit `id`.
- `target` — not read by the app from v0.9.2, which runs a command in whichever tab it starts from.
  Older apps still require it, so the daemon keeps validating it: when present it must be
  `"agent"` or `"terminal"`.
- `submit` — default `true`. With `false`, the text waits for you to send it.
- `shortcut` — an app-side key combo like `"Cmd+Shift+R"` (`Cmd`/`Ctrl`/`Alt`/`Shift`/`Mod` plus a
  key). The daemon treats it as opaque text; a combo that cannot parse degrades to no shortcut.

A project command with the same `id` as a global one shadows it: the project entry runs, and the
global one leaves the menu.

## What running one does

A command runs in one tab and never looks for another. A pane's button uses that pane's open tab. A
keyboard shortcut, or a header button (mobile, or desktop without pane splits), uses the focused
pane's open tab. Any other kind of tab (browser, file, changes, and so on) is a toast.

**Chat tab.** With `submit: true` the message is sent through the same path the app uses to drain
queued messages — the mounted composer is never touched, and the draft is cleared. On a draft tab
(no agent yet), `submit: true` creates the agent and starts the first turn using the tab's chosen
provider and model. With `submit: false`, the text replaces the composer's draft.

**Terminal tab.** The text is typed at the prompt; `submit: true` appends the carriage return, the
same as pressing Enter.

## Shortcuts

Command shortcuts fire globally on desktop and web, including while a terminal or text field is
focused — that is the point of them. They bind as `user-command.<id>` and sit after the built-ins in
the matcher, which takes the first match: a combo a built-in already owns never fires. In the desktop
app the Electron application menu also takes its combos (Reload, Copy, New Window, …) before the page
sees them; `DESKTOP_MENU_COMBOS` in `packages/app/src/commands/custom-commands-model.ts` mirrors
`packages/desktop/src/features/menu.ts`, so update both together. The commands menu and the Settings
list mark such a command "Shortcut in use", and the editor warns as soon as you record one.

Rebind or unassign under **Settings → Shortcuts → Commands**; overrides are the same per-binding
record the built-ins use, and the Settings list shows the shortcut after overrides. Mobile has no
keyboard shortcuts — the menu is the only surface there.

## Refresh model

There is no file watcher on either file. Global file edits reload on `paseo daemon reload`; Settings
saves apply immediately. Global commands ride the daemon config payload (`customCommands`, plus `customCommandErrors` when the file is unusable).
Project commands are fetched per workspace project cwd through `commands.project.list.request` —
on workspace entry and each time the menu opens.

The daemon matches project roots exactly, so the app passes the workspace's project cwd, never a
pane's nested directory; an unknown cwd is an empty answer, not an error. A project file that fails
to read or parse lands as a muted error row in the menu, and a broken global file lands the same way
— the commands themselves are better absent than half-applied.

`server_info.features.customCommands` gates the whole feature: against an older daemon the dropdown
and the shortcuts are absent. Settings editing additionally requires
`server_info.features.customCommandsEditing` and `daemon.manage` permission.
