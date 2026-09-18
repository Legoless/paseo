import type { CustomCommand } from "@getpaseo/protocol/custom-commands";
import type { ShortcutKey } from "@/utils/format-shortcut";
import {
  DEFAULT_BINDINGS,
  parseBindingChord,
  type ParsedShortcutBinding,
} from "@/keyboard/keyboard-shortcuts";
import { chordStringToShortcutKeys, chordToString } from "@/keyboard/shortcut-string";

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

function appliesToPlatform(
  when: ParsedShortcutBinding["when"],
  platform: { isMac: boolean; isDesktop: boolean },
): boolean {
  if (when?.mac !== undefined && when.mac !== platform.isMac) {
    return false;
  }
  if (when?.desktop !== undefined && when.desktop !== platform.isDesktop) {
    return false;
  }
  return true;
}

/**
 * The binding ids whose combo a built-in already owns on this platform. Dynamic bindings are
 * appended after the defaults and the matcher takes the first match, so a conflicting command
 * shortcut never fires — the menu marks the row instead of letting the user discover that.
 */
export function findCommandComboConflicts(input: {
  commandBindings: readonly ParsedShortcutBinding[];
  platform: { isMac: boolean; isDesktop: boolean };
  defaults?: readonly ParsedShortcutBinding[];
}): Set<string> {
  const defaults = input.defaults ?? DEFAULT_BINDINGS;
  const taken = new Set<string>();
  for (const binding of defaults) {
    if (binding.parsedChord.length === 0) {
      continue;
    }
    if (!appliesToPlatform(binding.when, input.platform)) {
      continue;
    }
    taken.add(chordToString(binding.parsedChord));
  }
  const conflicts = new Set<string>();
  for (const binding of input.commandBindings) {
    if (binding.parsedChord.length === 0) {
      continue;
    }
    if (taken.has(chordToString(binding.parsedChord))) {
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
