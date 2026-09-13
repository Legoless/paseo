import { getIsElectron } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { resolveIsolatedTerminalRenderer } from "./resolve-terminal-guest-renderer";

/**
 * True only when the user opted into the isolated renderer and we are inside Electron. Toggling
 * takes effect on the next terminal mount; mounted emulators are not migrated live.
 */
export function useIsolatedTerminalRenderer(): boolean {
  const { settings } = useAppSettings();
  return (
    resolveIsolatedTerminalRenderer({
      useIsolatedTerminalRenderer: settings.useIsolatedTerminalRenderer,
      isElectronRuntime: getIsElectron(),
    }) === "isolated"
  );
}
