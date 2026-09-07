import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, FolderGit2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { WorkspaceMemberDescriptor } from "@/stores/session-store";
import { useSelectedWorkspaceProject } from "@/stores/workspace-project-selection-store";
import {
  buildWorkspaceProjectPickerOptions,
  useWorkspaceMemberOrder,
  orderWorkspaceProjectPickerOptions,
  toWorkspaceProjectComboboxOptions,
  type WorkspaceProjectPickerOption,
} from "@/components/workspace-project-picker-order";
import { Combobox } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { shortenPath } from "@/utils/shorten-path";
import { ICON_SIZE, type Theme } from "@/styles/theme";

export type { WorkspaceProjectPickerOption } from "@/components/workspace-project-picker-order";
export {
  buildWorkspaceProjectPickerOptions,
  orderWorkspaceProjectPickerOptions,
  toWorkspaceProjectComboboxOptions,
} from "@/components/workspace-project-picker-order";

export function useOrderedWorkspaceProjectPickerOptions(
  serverId: string | null,
  workspaceId: string | null,
  members: WorkspaceMemberDescriptor[],
): WorkspaceProjectPickerOption[] {
  const memberOrder = useWorkspaceMemberOrder(serverId, workspaceId);
  return useMemo(() => {
    const options = buildWorkspaceProjectPickerOptions(members);
    return memberOrder ? orderWorkspaceProjectPickerOptions(options, memberOrder) : options;
  }, [members, memberOrder]);
}

interface WorkspaceProjectPickerProps {
  serverId: string | null;
  workspaceId: string | null;
  testID?: string;
}

const ThemedFolder = withUnistyles(FolderGit2);
const ThemedChevronDown = withUnistyles(ChevronDown);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

/**
 * Explorer sidebar project switcher for multi-project workspaces. Renders
 * nothing until the workspace has more than one member.
 */
export function WorkspaceProjectPicker({
  serverId,
  workspaceId,
  testID = "workspace-project-picker",
}: WorkspaceProjectPickerProps) {
  const { t } = useTranslation();
  const { member, members, setSelected } = useSelectedWorkspaceProject(serverId, workspaceId);
  const orderedOptions = useOrderedWorkspaceProjectPickerOptions(serverId, workspaceId, members);
  const options = useMemo(
    () => toWorkspaceProjectComboboxOptions(orderedOptions),
    [orderedOptions],
  );
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<View | null>(null);
  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleSelect = useCallback((id: string) => setSelected(id), [setSelected]);
  const triggerStyle = useCallback(
    ({ hovered, pressed }: { hovered: boolean; pressed: boolean }) => [
      styles.trigger,
      (hovered || pressed || isOpen) && styles.triggerActive,
    ],
    [isOpen],
  );

  if (orderedOptions.length <= 1 || !member) {
    return null;
  }

  const selectedLabel =
    orderedOptions.find((option) => option.cwd === member.workspaceDirectory)?.label ??
    member.projectDisplayName;

  return (
    <>
      <ComboboxTrigger
        ref={anchorRef}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.projectPicker.selectProject")}
        style={triggerStyle}
        onPress={handleOpen}
        testID={`${testID}-trigger`}
        chevron={null}
        block
      >
        <ThemedFolder
          size={ICON_SIZE.sm}
          uniProps={isOpen ? foregroundColorMapping : foregroundMutedColorMapping}
        />
        <View style={styles.triggerText}>
          <Text style={styles.triggerLabel} numberOfLines={1} testID={`${testID}-label`}>
            {selectedLabel}
          </Text>
          <Text style={styles.triggerPath} numberOfLines={1}>
            {shortenPath(member.workspaceDirectory)}
          </Text>
        </View>
        <ThemedChevronDown size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
      </ComboboxTrigger>
      <Combobox
        options={options}
        value={member.workspaceDirectory}
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
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    marginHorizontal: theme.spacing[2],
    marginTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  triggerActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  triggerText: {
    flex: 1,
    minWidth: 0,
  },
  triggerLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  triggerPath: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
