import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, Folder, FolderGit2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  toWorkspaceProjectComboboxOptions,
  useOrderedWorkspaceProjectPickerOptions,
} from "@/components/workspace-project-picker";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import type { WorkspaceMemberDescriptor } from "@/stores/session-store";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { shortenPath } from "@/utils/shorten-path";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedFolder = withUnistyles(FolderGit2);
/** A plain folder for "no project"; the git folder means a project is chosen. */
const ThemedPlainFolder = withUnistyles(Folder);
const ThemedChevronDown = withUnistyles(ChevronDown);

const EMPTY_MEMBERS: WorkspaceMemberDescriptor[] = [];

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
  const anchorRef = useRef<View | null>(null);
  const homeDirectory = useHostHomeDirectory(serverId);
  const members = useWorkspaceFields(serverId, workspaceId, (workspace) => workspace.members);
  const orderedOptions = useOrderedWorkspaceProjectPickerOptions(
    serverId,
    workspaceId,
    members ?? EMPTY_MEMBERS,
  );
  const noProjectLabel = t("workspace.tabs.projectSelector.noProject");
  const homePath = homeDirectory ? shortenPath(homeDirectory) : "~";
  const options = useMemo<ComboboxOption[]>(() => {
    const entries = toWorkspaceProjectComboboxOptions(orderedOptions);
    if (!homeDirectory) return entries;
    return [
      { id: HOME_OPTION_VALUE, label: noProjectLabel, description: homePath, kind: "directory" },
      ...entries,
    ];
  }, [orderedOptions, homeDirectory, homePath, noProjectLabel]);
  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleSelect = useCallback(
    (id: string) => onSelect(id === HOME_OPTION_VALUE ? null : id),
    [onSelect],
  );
  const triggerStyle = useCallback(
    ({ hovered, pressed }: { hovered: boolean; pressed: boolean }) => [
      styles.trigger,
      (hovered || pressed || isOpen) && styles.triggerActive,
    ],
    [isOpen],
  );

  // Nothing to choose between: no projects, and no home path from this daemon.
  if (orderedOptions.length === 0 && !homeDirectory) {
    return null;
  }

  const selected = selectedCwd ? orderedOptions.find((option) => option.cwd === selectedCwd) : null;
  const label = selected?.label ?? noProjectLabel;
  const path = selected?.path ?? homePath;

  return (
    <>
      <ComboboxTrigger
        ref={anchorRef}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.projectSelector.selectProject")}
        style={triggerStyle}
        onPress={handleOpen}
        testID="workspace-new-tab-project-selector-trigger"
        chevron={null}
        block
      >
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
      </ComboboxTrigger>
      <Combobox
        options={options}
        value={selectedCwd ?? (homeDirectory ? HOME_OPTION_VALUE : "")}
        onSelect={handleSelect}
        searchable
        searchPlaceholder={t("workspace.tabs.projectSelector.searchPlaceholder")}
        title={t("workspace.tabs.projectSelector.label")}
        emptyText={t("workspace.tabs.projectSelector.empty")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        desktopMinWidth={280}
        renderOption={renderProjectComboboxOption}
      />
    </>
  );
}

const HOME_OPTION_VALUE = "__home__";

function renderProjectComboboxOption({
  option,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const testID =
    option.id === HOME_OPTION_VALUE
      ? "workspace-new-tab-project-selector-home"
      : `workspace-new-tab-project-selector-option-${encodeURIComponent(option.id)}`;
  return (
    <ComboboxItem
      label={option.label}
      description={option.description}
      kind={option.kind}
      selected={selected}
      active={active}
      onPress={onPress}
      testID={testID}
    />
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
