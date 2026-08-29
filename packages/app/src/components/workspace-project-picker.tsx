import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, FolderGit2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { WorkspaceMemberDescriptor } from "@/stores/session-store";
import { useSelectedWorkspaceProject } from "@/stores/workspace-project-selection-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shortenPath } from "@/utils/shorten-path";
import { ICON_SIZE, type Theme } from "@/styles/theme";

export interface WorkspaceProjectPickerOption {
  cwd: string;
  label: string;
  path: string;
}

export function buildWorkspaceProjectPickerOptions(
  members: WorkspaceMemberDescriptor[],
): WorkspaceProjectPickerOption[] {
  return members.map((member) => ({
    cwd: member.workspaceDirectory,
    label: member.projectCustomName ?? member.projectDisplayName,
    path: shortenPath(member.workspaceDirectory),
  }));
}

interface WorkspaceProjectMenuItemsProps {
  options: WorkspaceProjectPickerOption[];
  selectedCwd: string | null;
  onSelect: (cwd: string) => void;
  testIDPrefix: string;
}

interface WorkspaceProjectMenuItemProps {
  option: WorkspaceProjectPickerOption;
  selected: boolean;
  onSelect: (cwd: string) => void;
  testID: string;
}

function WorkspaceProjectMenuItem({
  option,
  selected,
  onSelect,
  testID,
}: WorkspaceProjectMenuItemProps) {
  const handleSelect = useCallback(() => onSelect(option.cwd), [onSelect, option.cwd]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      description={option.path}
      onSelect={handleSelect}
      testID={testID}
    >
      {option.label}
    </DropdownMenuItem>
  );
}

/** One item list for every workspace project picker so the triggers can't drift. */
export function WorkspaceProjectMenuItems({
  options,
  selectedCwd,
  onSelect,
  testIDPrefix,
}: WorkspaceProjectMenuItemsProps) {
  return (
    <>
      {options.map((option) => (
        <WorkspaceProjectMenuItem
          key={option.cwd}
          option={option}
          selected={option.cwd === selectedCwd}
          onSelect={onSelect}
          testID={`${testIDPrefix}-option-${encodeURIComponent(option.cwd)}`}
        />
      ))}
    </>
  );
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
  const options = useMemo(() => buildWorkspaceProjectPickerOptions(members), [members]);
  const [isOpen, setIsOpen] = useState(false);
  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.trigger,
      (hovered || pressed || open) && styles.triggerActive,
    ],
    [],
  );

  if (options.length <= 1 || !member) {
    return null;
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.projectPicker.selectProject")}
        style={triggerStyle}
        testID={`${testID}-trigger`}
      >
        {({ hovered, pressed, open }) => (
          <View style={styles.triggerRow}>
            <ThemedFolder
              size={ICON_SIZE.sm}
              uniProps={
                hovered || pressed || open ? foregroundColorMapping : foregroundMutedColorMapping
              }
            />
            <View style={styles.triggerText}>
              <Text style={styles.triggerLabel} numberOfLines={1} testID={`${testID}-label`}>
                {options.find((option) => option.cwd === member.workspaceDirectory)?.label ??
                  member.projectDisplayName}
              </Text>
              <Text style={styles.triggerPath} numberOfLines={1}>
                {shortenPath(member.workspaceDirectory)}
              </Text>
            </View>
            <ThemedChevronDown size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
          </View>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" minWidth={240} side="bottom" testID={`${testID}-content`}>
        <WorkspaceProjectMenuItems
          options={options}
          selectedCwd={member.workspaceDirectory}
          onSelect={setSelected}
          testIDPrefix={testID}
        />
      </DropdownMenuContent>
    </DropdownMenu>
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
  triggerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
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
