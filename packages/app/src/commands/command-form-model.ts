import { createStore } from "zustand/vanilla";
import type { CustomCommand } from "@getpaseo/protocol/custom-commands";
import { parseBindingChord } from "@/keyboard/keyboard-shortcuts";

interface CommandFormState {
  command: CustomCommand;
  shortcutValid: boolean;
  canSubmit: boolean;
  pending: boolean;
  error: string | null;
}

export function openCommandForm(initial: CustomCommand) {
  function derive(
    command: CustomCommand,
    pending = false,
    error: string | null = null,
  ): CommandFormState {
    let shortcutValid = true;
    try {
      parseBindingChord(command.shortcut?.trim() ?? "");
    } catch {
      shortcutValid = false;
    }
    return {
      command,
      shortcutValid,
      canSubmit: Boolean(command.title.trim() && command.text.trim() && shortcutValid && !pending),
      pending,
      error,
    };
  }
  const store = createStore(() => derive(initial));
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    set<K extends keyof CustomCommand>(key: K, value: CustomCommand[K]) {
      if (store.getState().pending) return;
      store.setState(derive({ ...store.getState().command, [key]: value }), true);
    },
    async save(onSave: (command: CustomCommand) => Promise<void>, fallbackError: string) {
      const state = store.getState();
      if (!state.canSubmit) return false;
      store.setState(derive(state.command, true), true);
      try {
        const { shortcut, ...command } = state.command;
        await onSave({
          ...command,
          title: command.title.trim(),
          ...(shortcut?.trim() ? { shortcut: shortcut.trim() } : {}),
        });
        store.setState(derive(state.command), true);
        return true;
      } catch (error) {
        store.setState(
          derive(state.command, false, error instanceof Error ? error.message : fallbackError),
          true,
        );
        return false;
      }
    },
  };
}
