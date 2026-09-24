import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchQuery } from "@/data/query";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useCustomCommandsStore } from "@/stores/custom-commands-store";
import { useCustomCommandsSupported } from "@/commands/use-custom-commands-supported";

export function customCommandsQueryKey(serverId: string, cwd: string | null) {
  return ["custom-commands", "project", serverId, cwd] as const;
}

/**
 * Mirrors a workspace project's commands (project file plus the host's global file) into the
 * store the keyboard handler, the commands menu and Settings read. The keyboard hook mounts this
 * for the active workspace, so shortcuts bind even while the tray hides the commands button.
 * Freshness is pull-driven: the daemon watches neither file, so the project read happens on
 * mount and each time the menu opens (the button invalidates the query), never on a timer.
 */
export function useCustomCommandsSync({
  serverId,
  cwd,
}: {
  serverId: string | null;
  cwd: string | null;
}): void {
  const { t } = useTranslation();
  const supported = useCustomCommandsSupported(serverId ?? "");
  const enabledServerId = supported ? serverId : null;
  const runtimeClient = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const { config } = useDaemonConfig(enabledServerId);

  const projectQuery = useFetchQuery({
    queryKey: customCommandsQueryKey(serverId ?? "", cwd),
    dataShape: "value",
    staleTimeMs: 60_000,
    enabled: Boolean(enabledServerId) && !!runtimeClient && isConnected && !!cwd,
    queryFn: async () => {
      if (!runtimeClient || !cwd) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return await runtimeClient.listProjectCommands(cwd);
    },
  });

  const setProjectCommands = useCustomCommandsStore((state) => state.setProjectCommands);
  const setGlobalCommands = useCustomCommandsStore((state) => state.setGlobalCommands);

  const projectData = projectQuery.data;
  useEffect(() => {
    if (!enabledServerId || !projectData || !cwd) {
      return;
    }
    setProjectCommands({
      serverId: enabledServerId,
      cwd,
      project: projectData.commands,
      projectError: projectData.error,
      sourcePath: projectData.sourcePath,
    });
  }, [projectData, enabledServerId, cwd, setProjectCommands]);

  const globalCommands = useMemo(() => config?.customCommands ?? [], [config?.customCommands]);
  const globalCommandErrors = useMemo(
    () => config?.customCommandErrors ?? [],
    [config?.customCommandErrors],
  );
  useEffect(() => {
    if (!enabledServerId || !config) {
      return;
    }
    setGlobalCommands({
      serverId: enabledServerId,
      global: globalCommands,
      globalErrors: globalCommandErrors,
    });
  }, [enabledServerId, config, globalCommands, globalCommandErrors, setGlobalCommands]);
}
