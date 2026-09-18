import { router } from "expo-router";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { useCallback, useEffect, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Folder,
  Globe,
  MessageSquare,
  SquareSlash,
  SquareTerminal,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { CustomCommand } from "@getpaseo/protocol/custom-commands";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { buttonControlHeight, HEADER_CONTROL_HEIGHT } from "@/components/ui/control-geometry";
import { extraMutedIconColorMapping } from "@/components/ui/icon-color";
import { useToast } from "@/contexts/toast-context";
import { useFetchQuery } from "@/data/query";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  selectGlobalCommandsEntry,
  selectProjectCommandsEntry,
  useCustomCommandsStore,
} from "@/stores/custom-commands-store";
import {
  buildCommandBindings,
  findCommandComboConflicts,
  shortcutKeysForCommandBinding,
} from "@/commands/custom-commands-model";
import { runCustomCommand } from "@/commands/run-custom-command";
import { useCustomCommandsSupported } from "@/commands/use-custom-commands-supported";
import { applyShortcutOverrides, type ParsedShortcutBinding } from "@/keyboard/keyboard-shortcuts";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { getIsElectronRuntime } from "@/constants/layout";
import type { Theme } from "@/styles/theme";

interface WorkspaceCommandsButtonProps {
  serverId: string;
  /** The workspace's project cwd — the daemon matches project roots exactly, never subdirectories. */
  cwd: string | null;
  workspaceId: string;
  presentation?: "split" | "ghost";
  hideLabels?: boolean;
}

const ThemedFolder = withUnistyles(Folder);
const ThemedGlobe = withUnistyles(Globe);
const ThemedSquareSlash = withUnistyles(SquareSlash);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedChevronDown = withUnistyles(ChevronDown);

const GHOST_TRIGGER_ICON_SIZE = 16;

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function customCommandsQueryKey(serverId: string, cwd: string | null) {
  return ["custom-commands", "project", serverId, cwd] as const;
}

function targetLeadingIcon(target: CustomCommand["target"]): ReactElement {
  if (target === "terminal") {
    return <ThemedSquareTerminal size={14} uniProps={mutedColorMapping} />;
  }
  return <ThemedMessageSquare size={14} uniProps={mutedColorMapping} />;
}

interface CommandMenuItemProps {
  command: CustomCommand;
  binding: ParsedShortcutBinding | undefined;
  conflicts: Set<string>;
  onSelect: (command: CustomCommand) => void;
}

function CommandMenuItem({
  command,
  binding,
  conflicts,
  onSelect,
}: CommandMenuItemProps): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(command), [onSelect, command]);
  const keys = binding ? shortcutKeysForCommandBinding(binding) : null;
  const conflicted = binding ? conflicts.has(binding.id) : false;
  const trailing = useMemo(() => {
    if (conflicted) {
      return <Text style={styles.conflictHint}>{t("workspace.commands.shortcutTaken")}</Text>;
    }
    return keys ? <Shortcut chord={keys} /> : null;
  }, [conflicted, keys, t]);
  return (
    <DropdownMenuItem
      testID={`workspace-command-${command.id}`}
      leading={targetLeadingIcon(command.target)}
      trailing={trailing}
      onSelect={handleSelect}
    >
      {command.title}
    </DropdownMenuItem>
  );
}

interface CommandsMenuContentProps {
  projectCommands: CustomCommand[];
  projectError: string | null;
  globalCommands: CustomCommand[];
  globalErrors: string[];
  bindingByCommandId: Map<string, ParsedShortcutBinding>;
  conflicts: Set<string>;
  onSelect: (command: CustomCommand) => void;
}

function CommandsMenuContent({
  projectCommands,
  projectError,
  globalCommands,
  globalErrors,
  bindingByCommandId,
  conflicts,
  onSelect,
}: CommandsMenuContentProps): ReactElement {
  const { t } = useTranslation();
  const projectIcon = useMemo(() => <ThemedFolder size={14} uniProps={mutedColorMapping} />, []);
  const globalIcon = useMemo(() => <ThemedGlobe size={14} uniProps={mutedColorMapping} />, []);
  const renderCommand = (command: CustomCommand) => (
    <CommandMenuItem
      key={command.id}
      command={command}
      binding={bindingByCommandId.get(command.id)}
      conflicts={conflicts}
      onSelect={onSelect}
    />
  );
  return (
    <>
      {projectCommands.length > 0 ? (
        <DropdownMenuLabel leading={projectIcon} testID="workspace-commands-project-group">
          {t("workspace.commands.groups.project")}
        </DropdownMenuLabel>
      ) : null}
      {projectCommands.map(renderCommand)}
      {projectCommands.length > 0 && globalCommands.length > 0 ? <DropdownMenuSeparator /> : null}
      {globalCommands.length > 0 ? (
        <DropdownMenuLabel leading={globalIcon} testID="workspace-commands-global-group">
          {t("workspace.commands.groups.global")}
        </DropdownMenuLabel>
      ) : null}
      {globalCommands.map(renderCommand)}
      {projectError ? (
        <DropdownMenuHint testID="workspace-commands-project-error">
          {projectError}
        </DropdownMenuHint>
      ) : null}
      {globalErrors.map((error) => (
        <DropdownMenuHint key={error} testID="workspace-commands-global-error">
          {error}
        </DropdownMenuHint>
      ))}
    </>
  );
}

export function WorkspaceCommandsButton({
  serverId,
  cwd,
  workspaceId,
  presentation = "split",
  hideLabels,
}: WorkspaceCommandsButtonProps): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const supported = useCustomCommandsSupported(serverId);
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const queryClient = useQueryClient();
  const runtimeClient = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config } = useDaemonConfig(supported ? serverId : null);
  const { overrides } = useKeyboardShortcutOverrides();

  // Freshness is pull-driven: the daemon watches neither file, so the read happens on mount
  // and each time the menu opens (an invalidation below) — never on a timer.
  const projectQuery = useFetchQuery({
    queryKey: customCommandsQueryKey(serverId, cwd),
    dataShape: "value",
    staleTimeMs: 60_000,
    enabled: supported && !!runtimeClient && isConnected && !!cwd,
    queryFn: async () => {
      if (!runtimeClient || !cwd) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return await runtimeClient.listProjectCommands(cwd);
    },
  });

  const setProjectCommands = useCustomCommandsStore((state) => state.setProjectCommands);
  const setGlobalCommands = useCustomCommandsStore((state) => state.setGlobalCommands);

  // Mirror both command sources into the store so the global keyboard handler and the
  // settings page resolve the same commands without fetching. Outlives this component on
  // purpose: hiding the button must not unbind the shortcuts it advertised.
  const projectData = projectQuery.data;
  useEffect(() => {
    if (!projectData || !cwd) {
      return;
    }
    setProjectCommands({
      serverId,
      cwd,
      project: projectData.commands,
      projectError: projectData.error,
      sourcePath: projectData.sourcePath,
    });
  }, [projectData, serverId, cwd, setProjectCommands]);

  const globalCommands = useMemo(() => config?.customCommands ?? [], [config?.customCommands]);
  const globalCommandErrors = useMemo(
    () => config?.customCommandErrors ?? [],
    [config?.customCommandErrors],
  );
  useEffect(() => {
    if (!supported) {
      return;
    }
    setGlobalCommands({ serverId, global: globalCommands, globalErrors: globalCommandErrors });
  }, [supported, serverId, globalCommands, globalCommandErrors, setGlobalCommands]);

  const projectEntry = useCustomCommandsStore((state) =>
    selectProjectCommandsEntry(state, serverId, cwd),
  );
  const globalEntry = useCustomCommandsStore((state) => selectGlobalCommandsEntry(state, serverId));

  // Project commands shadow global ones by id; a shadowed global row would advertise the
  // project command's shortcut but read as the global one, so it leaves the menu.
  const visibleGlobalCommands = useMemo(() => {
    const projectIds = new Set(projectEntry.project.map((command) => command.id));
    return globalEntry.global.filter((command) => !projectIds.has(command.id));
  }, [projectEntry.project, globalEntry.global]);

  const platform = useMemo(
    () => ({ isMac: getShortcutOs() === "mac", isDesktop: getIsElectronRuntime() }),
    [],
  );
  const effectiveBindings = useMemo(
    () =>
      applyShortcutOverrides(
        buildCommandBindings([...projectEntry.project, ...visibleGlobalCommands]),
        overrides,
      ),
    [projectEntry.project, visibleGlobalCommands, overrides],
  );
  const bindingByCommandId = useMemo(() => {
    const map = new Map<string, ParsedShortcutBinding>();
    for (const binding of effectiveBindings) {
      if (binding.payload?.type === "user-command") {
        map.set(binding.payload.commandId, binding);
      }
    }
    return map;
  }, [effectiveBindings]);
  const conflicts = useMemo(
    () => findCommandComboConflicts({ commandBindings: effectiveBindings, platform }),
    [effectiveBindings, platform],
  );

  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        void queryClient.invalidateQueries({ queryKey: customCommandsQueryKey(serverId, cwd) });
      }
    },
    [queryClient, serverId, cwd],
  );

  const handleSelect = useCallback(
    (command: CustomCommand) => {
      void runCustomCommand({
        serverId,
        workspaceId,
        command,
        client,
        onError: (message) => toast.error(message),
      });
    },
    [serverId, workspaceId, client, toast],
  );

  const triggerIconSize = presentation === "ghost" ? GHOST_TRIGGER_ICON_SIZE : 14;
  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      presentation === "ghost" ? styles.ghostButton : styles.splitButtonPrimary,
      (hovered || pressed || open) &&
        (presentation === "ghost" ? styles.ghostButtonHovered : styles.splitButtonPrimaryHovered),
    ],
    [presentation],
  );

  const openSettings = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(serverId, "commands"));
  }, [serverId]);
  if (!supported) {
    return null;
  }
  const hasContent = Boolean(
    projectEntry.project.length ||
    visibleGlobalCommands.length ||
    projectEntry.projectError ||
    globalEntry.globalErrors.length,
  );

  return (
    <View style={presentation === "ghost" ? styles.ghostButtonFrame : styles.splitButton}>
      <DropdownMenu onOpenChange={handleMenuOpenChange}>
        <DropdownMenuTrigger
          testID="workspace-commands-button"
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.commands.accessibility.trigger")}
        >
          <View style={styles.splitButtonContent}>
            <ThemedSquareSlash size={triggerIconSize} uniProps={mutedColorMapping} />
            {!hideLabels && (
              <Text style={styles.splitButtonText}>{t("workspace.commands.title")}</Text>
            )}
            {presentation === "split" ? (
              <ThemedChevronDown size={16} uniProps={extraMutedIconColorMapping} />
            ) : null}
          </View>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          minWidth={220}
          maxWidth={300}
          testID="workspace-commands-menu"
        >
          <CommandsMenuContent
            projectCommands={projectEntry.project}
            projectError={projectEntry.projectError}
            globalCommands={visibleGlobalCommands}
            globalErrors={globalEntry.globalErrors}
            bindingByCommandId={bindingByCommandId}
            conflicts={conflicts}
            onSelect={handleSelect}
          />
          {hasContent ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={openSettings} testID="workspace-commands-settings">
            {t("settings.commands.manage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  splitButton: {
    height: {
      xs: buttonControlHeight.xs,
      md: HEADER_CONTROL_HEIGHT,
    },
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
  },
  ghostButtonFrame: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  ghostButton: {
    width: theme.spacing[8],
    height: theme.spacing[8],
    padding: 0,
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  splitButtonPrimary: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[2],
    },
    justifyContent: "center",
  },
  splitButtonPrimaryHovered: {
    backgroundColor: theme.colors.surface2,
  },
  splitButtonText: {
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.5,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  splitButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: {
      xs: theme.spacing[1.5],
      md: theme.spacing[1],
    },
    minHeight: theme.fontSize.base * 1.5,
  },
  conflictHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
