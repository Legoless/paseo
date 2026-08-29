import { useCallback, useState } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  WorkspaceProjectMenuItems,
  type WorkspaceProjectPickerOption,
} from "@/components/workspace-project-picker";

export interface DraftProjectPickerValue {
  options: WorkspaceProjectPickerOption[];
  selectedCwd: string;
  onSelect: (cwd: string) => void;
  /** Set while the draft cannot pin a setup yet (no provider resolved). */
  disabled?: boolean;
}

interface DraftProjectPickerProps {
  picker: DraftProjectPickerValue;
  disabled?: boolean;
}

interface DraftProjectTriggerState {
  hovered: boolean;
  pressed: boolean;
  open: boolean;
}

/**
 * Composer-badge project picker for multi-project workspace drafts. Choosing a
 * member re-points the draft's working directory at that member's cwd.
 */
export function DraftProjectPicker({ picker, disabled = false }: DraftProjectPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const isDisabled = disabled || picker.disabled === true;
  const selected =
    picker.options.find((option) => option.cwd === picker.selectedCwd) ?? picker.options[0] ?? null;
  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: DraftProjectTriggerState) => [
      styles.badge,
      (hovered || pressed || open) && styles.badgeActive,
      isDisabled && styles.badgeDisabled,
    ],
    [isDisabled],
  );

  if (!selected) {
    return null;
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.projectPicker.selectProject")}
        disabled={isDisabled}
        style={triggerStyle}
        testID="draft-project-picker-trigger"
      >
        <Text style={styles.badgeText} numberOfLines={1} testID="draft-project-picker-label">
          {selected.label}
        </Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        minWidth={240}
        side="top"
        testID="draft-project-picker-content"
      >
        <WorkspaceProjectMenuItems
          options={picker.options}
          selectedCwd={picker.selectedCwd}
          onSelect={picker.onSelect}
          testIDPrefix="draft-project-picker"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    maxWidth: 180,
  },
  badgeActive: {
    backgroundColor: theme.colors.surface2,
  },
  badgeDisabled: {
    opacity: 0.5,
  },
  badgeText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
}));
