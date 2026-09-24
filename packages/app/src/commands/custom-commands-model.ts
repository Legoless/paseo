import type { CustomCommand } from "@getpaseo/protocol/custom-commands";
import type { ShortcutKey } from "@/utils/format-shortcut";
import {
  DEFAULT_BINDINGS,
  parseBindingChord,
  type ParsedShortcutBinding,
} from "@/keyboard/keyboard-shortcuts";
import {
  chordStringToShortcutKeys,
  keyComboToString,
  type KeyCombo,
} from "@/keyboard/shortcut-string";

export const USER_COMMAND_BINDING_PREFIX = "user-command.";

/**
 * A file-authored combo that fails to parse degrades to no shortcut. The daemon validates the
 * commands file's shape but treats `shortcut` as opaque text, so the parse boundary is here.
 */
function sanitizeCommandCombo(shortcut: string | undefined): string {
  if (!shortcut) {
    return "";
  }
  try {
    parseBindingChord(shortcut);
    return shortcut;
  } catch {
    return "";
  }
}

/**
 * One keyboard binding per command. No `when` clause: command shortcuts fire in every focus
 * scope (they act on the composer or terminal, wherever focus happens to be), and no `help`
 * entry — the settings page lists them in its own Commands group.
 */
export function buildCommandBindings(commands: CustomCommand[]): ParsedShortcutBinding[] {
  return commands.map((command) => {
    const combo = sanitizeCommandCombo(command.shortcut);
    return {
      id: USER_COMMAND_BINDING_PREFIX + command.id,
      action: "userCommand.run",
      combo,
      parsedChord: parseBindingChord(combo),
      payload: { type: "user-command", commandId: command.id },
    };
  });
}

interface ShortcutPlatform {
  isMac: boolean;
  isDesktop: boolean;
}

/**
 * Combos the Electron application menu takes before the page sees the key
 * (packages/desktop/src/features/menu.ts, including its roles' default accelerators), so a command
 * bound to one never fires in the desktop app.
 */
const DESKTOP_MENU_COMBOS: Record<"mac" | "other", readonly string[]> = {
  mac: [
    "Cmd+H",
    "Alt+Cmd+H",
    "Cmd+Q",
    "Shift+Cmd+N",
    "Cmd+Z",
    "Shift+Cmd+Z",
    "Cmd+X",
    "Cmd+C",
    "Cmd+V",
    "Cmd+A",
    "Cmd+=",
    "Cmd+-",
    "Cmd+0",
    "Cmd+R",
    "Shift+Cmd+R",
    "Alt+Cmd+I",
    "Ctrl+Cmd+F",
    "Cmd+M",
  ],
  other: [
    "Ctrl+Shift+N",
    "Ctrl+Z",
    "Ctrl+Y",
    "Ctrl+Shift+Z",
    "Ctrl+X",
    "Ctrl+C",
    "Ctrl+V",
    "Ctrl+A",
    "Ctrl+=",
    "Ctrl+-",
    "Ctrl+0",
    "Ctrl+R",
    "Ctrl+Shift+R",
    "Ctrl+Shift+I",
    "F11",
    "Ctrl+M",
    "Ctrl+W",
  ],
};

// Cmd and Mod are the same key on a Mac, as Ctrl and Mod are elsewhere; compare them as one.
function comboKey(combo: KeyCombo, isMac: boolean): string {
  const primary = combo.mod === true || (isMac ? combo.meta === true : combo.ctrl === true);
  const { mod: _mod, meta, ctrl, ...rest } = combo;
  return keyComboToString({
    ...rest,
    ...(primary ? { mod: true as const } : {}),
    ...(isMac && ctrl ? { ctrl } : {}),
    ...(!isMac && meta ? { meta } : {}),
  });
}

function chordKey(chord: readonly KeyCombo[], isMac: boolean): string {
  return chord.map((combo) => comboKey(combo, isMac)).join(" ");
}

function appliesToPlatform(
  when: ParsedShortcutBinding["when"],
  platform: ShortcutPlatform,
): boolean {
  if (when?.mac !== undefined && when.mac !== platform.isMac) {
    return false;
  }
  if (when?.desktop !== undefined && when.desktop !== platform.isDesktop) {
    return false;
  }
  return true;
}

function takenChordKeys(
  platform: ShortcutPlatform,
  defaults: readonly ParsedShortcutBinding[],
): Set<string> {
  const taken = new Set<string>();
  for (const binding of defaults) {
    if (binding.parsedChord.length > 0 && appliesToPlatform(binding.when, platform)) {
      taken.add(chordKey(binding.parsedChord, platform.isMac));
    }
  }
  if (platform.isDesktop) {
    for (const combo of DESKTOP_MENU_COMBOS[platform.isMac ? "mac" : "other"]) {
      taken.add(chordKey(parseBindingChord(combo), platform.isMac));
    }
  }
  return taken;
}

/**
 * Whether a built-in or, in the desktop app, the application menu already owns this combo, so a
 * command bound to it would never fire. An unparseable combo is not taken; it has no binding.
 */
export function isCommandComboTaken(
  combo: string,
  platform: ShortcutPlatform,
  defaults: readonly ParsedShortcutBinding[] = DEFAULT_BINDINGS,
): boolean {
  const chord = parseBindingChord(sanitizeCommandCombo(combo));
  return (
    chord.length > 0 && takenChordKeys(platform, defaults).has(chordKey(chord, platform.isMac))
  );
}

/**
 * The binding ids whose combo a built-in or the desktop menu already owns on this platform.
 * Dynamic bindings are appended after the defaults and the matcher takes the first match, so a
 * conflicting command shortcut never fires — the menu marks the row instead of letting the user
 * discover that.
 */
export function findCommandComboConflicts(input: {
  commandBindings: readonly ParsedShortcutBinding[];
  platform: ShortcutPlatform;
  defaults?: readonly ParsedShortcutBinding[];
}): Set<string> {
  const taken = takenChordKeys(input.platform, input.defaults ?? DEFAULT_BINDINGS);
  const conflicts = new Set<string>();
  for (const binding of input.commandBindings) {
    if (
      binding.parsedChord.length > 0 &&
      taken.has(chordKey(binding.parsedChord, input.platform.isMac))
    ) {
      conflicts.add(binding.id);
    }
  }
  return conflicts;
}

/**
 * The keys to display for a command binding. Unlike the action-based resolver for built-ins,
 * dynamic bindings have no help entry, so the (already override-applied) binding itself is the
 * source of truth: no parsed chord means no keys.
 */
export function shortcutKeysForCommandBinding(
  binding: ParsedShortcutBinding,
): ShortcutKey[][] | null {
  if (binding.parsedChord.length === 0) {
    return null;
  }
  return chordStringToShortcutKeys(binding.combo);
}
