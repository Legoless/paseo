import { useCallback, useMemo } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { SettingsSection, SettingsCard, SettingsSelect } from "@/components/settings";
import {
  useAppSettings,
  type AppSettings,
  type OpenInSidePanePreferences,
  type PullRequestOpenLocation,
} from "@/hooks/use-settings";
import { settingsStyles } from "@/styles/settings";

const SOURCES = [
  "explorerFiles",
  "diffs",
  "chatFiles",
  "diffFiles",
  "subagents",
] as const satisfies readonly (keyof OpenInSidePanePreferences)[];

type LayoutPreferenceSource = keyof OpenInSidePanePreferences | "pullRequests";

function destinationTriggerStyle({
  pressed,
  open,
}: PressableStateCallbackType & { open?: boolean }) {
  return [styles.destinationTrigger, (pressed || open) && styles.destinationTriggerActive];
}

function LayoutPreferenceRow({
  source,
  destination,
  allowExplorer,
  onDestinationChange,
}: {
  source: LayoutPreferenceSource;
  destination: PullRequestOpenLocation;
  allowExplorer?: boolean;
  onDestinationChange(source: LayoutPreferenceSource, destination: PullRequestOpenLocation): void;
}) {
  const { t } = useTranslation();
  const options = useMemo(() => {
    const destinations = allowExplorer
      ? (["main", "side", "explorer"] as const)
      : (["main", "side"] as const);
    return destinations.map((value) => ({
      value,
      label: t(`settings.layout.openInSidePane.destinations.${value}`),
    }));
  }, [allowExplorer, t]);
  const change = useCallback(
    (value: PullRequestOpenLocation) => onDestinationChange(source, value),
    [source, onDestinationChange],
  );
  return (
    <SettingsSelect
      label={t(`settings.layout.openInSidePane.sources.${source}.label`)}
      value={destination}
      options={options}
      onValueChange={change}
    />
  );
}

function ExplorerProjectScopeRow({
  value,
  onChange,
}: {
  value: AppSettings["explorerProjectScope"];
  onChange: (value: AppSettings["explorerProjectScope"]) => void;
}) {
  const { t } = useTranslation();
  const label = t("settings.layout.workspacePanes.explorerProject.label");
  const selectedLabel = t(`settings.layout.workspacePanes.explorerProject.options.${value}`);
  const selectTab = useCallback(() => onChange("tab"), [onChange]);
  const selectPane = useCallback(() => onChange("pane"), [onChange]);
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.layout.workspacePanes.explorerProject.description")}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownTrigger
          style={destinationTriggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${selectedLabel}`}
        >
          <Text style={styles.destinationLabel}>{selectedLabel}</Text>
        </DropdownTrigger>
        <DropdownMenuContent side="bottom" align="end" width={220}>
          <DropdownMenuItem selected={value === "tab"} onSelect={selectTab}>
            {t("settings.layout.workspacePanes.explorerProject.options.tab")}
          </DropdownMenuItem>
          <DropdownMenuItem selected={value === "pane"} onSelect={selectPane}>
            {t("settings.layout.workspacePanes.explorerProject.options.pane")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

export function LayoutSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const handleDestinationChange = useCallback(
    (source: LayoutPreferenceSource, destination: PullRequestOpenLocation) => {
      if (source === "pullRequests") {
        void updateSettings({ pullRequestOpenLocation: destination });
        return;
      }
      void updateSettings({
        openInSidePane: { ...settings.openInSidePane, [source]: destination === "side" },
      });
    },
    [settings.openInSidePane, updateSettings],
  );
  const handleExplorerProjectScopeChange = useCallback(
    (explorerProjectScope: AppSettings["explorerProjectScope"]) => {
      void updateSettings({ explorerProjectScope });
    },
    [updateSettings],
  );
  return (
    <>
      <SettingsSection title={t("settings.layout.workspacePanes.title")}>
        <SettingsCard>
          <ExplorerProjectScopeRow
            value={settings.explorerProjectScope}
            onChange={handleExplorerProjectScopeChange}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("settings.layout.openInSidePane.title")}>
        <SettingsCard>
          {SOURCES.map((source) => (
            <LayoutPreferenceRow
              key={source}
              source={source}
              destination={settings.openInSidePane[source] ? "side" : "main"}
              onDestinationChange={handleDestinationChange}
            />
          ))}
          <LayoutPreferenceRow
            source="pullRequests"
            destination={settings.pullRequestOpenLocation}
            allowExplorer
            onDestinationChange={handleDestinationChange}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  destinationTrigger: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  destinationTriggerActive: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  destinationLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));
