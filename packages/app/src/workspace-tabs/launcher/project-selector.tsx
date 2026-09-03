import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, Folder, FolderGit2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildWorkspaceProjectPickerOptions,
  WorkspaceProjectMenuItems,
} from "@/components/workspace-project-picker";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { shortenPath } from "@/utils/shorten-path";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedFolder = withUnistyles(FolderGit2);
/** A plain folder for "no project"; the git folder means a project is chosen. */
const ThemedPlainFolder = withUnistyles(Folder);
const ThemedChevronDown = withUnistyles(ChevronDown);

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The daemon user's home directory, or null against a daemon too old to send one. Absence is the
 * gate — there is no boolean feature flag, because a path the client cannot name is a project it
 * cannot offer.
 */
export function useHostHomeDirectory(serverId: string): string | null {
  const client = useHostRuntimeClient(serverId);
  return client?.getLastServerInfoMessage()?.homeDirectory ?? null;
}

/**
 * Chooses the project a new tab launches into. "No project" is the default and resolves to the
 * daemon user's home directory: a tab created from the launcher belongs to no project until the
 * user picks one.
 */
export function NewTabProjectSelector({
  serverId,
  workspaceId,
  selectedCwd,
  onSelect,
}: {
  serverId: string;
  workspaceId: string;
  /** null means home. */
  selectedCwd: string | null;
  onSelect: (cwd: string | null) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const homeDirectory = useHostHomeDirectory(serverId);
  const members = useWorkspaceFields(serverId, workspaceId, (workspace) => workspace.members);
  const options = useMemo(() => buildWorkspaceProjectPickerOptions(members ?? []), [members]);

  const selectHome = useCallback(() => onSelect(null), [onSelect]);
  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.trigger,
      (hovered || pressed || open) && styles.triggerActive,
    ],
    [],
  );

  // Nothing to choose between: no projects, and no home path from this daemon.
  if (options.length === 0 && !homeDirectory) {
    return null;
  }

  const selected = selectedCwd ? options.find((option) => option.cwd === selectedCwd) : null;
  const label = selected?.label ?? t("workspace.tabs.projectSelector.noProject");
  const homePath = homeDirectory ? shortenPath(homeDirectory) : "~";
  const path = selected?.path ?? homePath;

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.projectSelector.selectProject")}
        style={triggerStyle}
        testID="workspace-new-tab-project-selector-trigger"
      >
        <View style={styles.triggerRow}>
          {selected ? (
            <ThemedFolder size={ICON_SIZE.sm} uniProps={mutedMapping} />
          ) : (
            <ThemedPlainFolder size={ICON_SIZE.sm} uniProps={mutedMapping} />
          )}
          <Text
            numberOfLines={1}
            style={styles.triggerLabel}
            testID="workspace-new-tab-project-selector-label"
          >
            {label}
          </Text>
          <Text numberOfLines={1} style={styles.triggerPath}>
            {path}
          </Text>
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedMapping} />
        </View>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        minWidth={240}
        side="bottom"
        testID="workspace-new-tab-project-selector-content"
      >
        <DropdownMenuItem
          selected={selectedCwd === null}
          showSelectedCheck
          description={homeDirectory ? homePath : undefined}
          onSelect={selectHome}
          testID="workspace-new-tab-project-selector-home"
        >
          {t("workspace.tabs.projectSelector.noProject")}
        </DropdownMenuItem>
        {options.length > 0 ? <DropdownMenuSeparator /> : null}
        <WorkspaceProjectMenuItems
          options={options}
          selectedCwd={selectedCwd}
          onSelect={onSelect}
          testIDPrefix="workspace-new-tab-project-selector"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  triggerActive: {
    backgroundColor: theme.colors.surface2,
  },
  triggerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  triggerLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 0,
  },
  triggerPath: {
    minWidth: 0,
    flexShrink: 1,
    flexGrow: 1,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
}));
