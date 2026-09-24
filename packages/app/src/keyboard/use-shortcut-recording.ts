import { useEffect } from "react";
import { isNative } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";

/**
 * Hands every key to `onKeyDown` while a shortcut is being recorded; pass null when not recording.
 * App shortcuts and the top overlay stand down (`capturingShortcut`), and Electron's zoom and
 * reload accelerators are suppressed so combos like Cmd+- or Cmd+Shift+R record instead.
 * Keep `onKeyDown` stable: a new function restarts the recording session.
 */
export function useShortcutRecording(onKeyDown: ((event: KeyboardEvent) => void) | null): void {
  const setCapturingShortcut = useKeyboardShortcutsStore((s) => s.setCapturingShortcut);

  useEffect(() => {
    if (isNative || !onKeyDown) return;
    const menu = getDesktopHost()?.menu;
    setCapturingShortcut(true);
    void menu?.setCapturingShortcut?.(true);

    function handleKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      onKeyDown?.(event);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      setCapturingShortcut(false);
      void menu?.setCapturingShortcut?.(false);
    };
  }, [onKeyDown, setCapturingShortcut]);
}
