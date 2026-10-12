import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SettingsSection, SettingsCard, SettingsSelect } from "@/components/settings";
import {
  useAppSettings,
  type AppSettings,
  type OpenInSidePanePreferences,
  type PullRequestOpenLocation,
  type ServiceUrlBehavior,
} from "@/hooks/use-settings";

const SOURCES = [
  "explorerFiles",
  "diffs",
  "chatFiles",
  "diffFiles",
  "subagents",
] as const satisfies readonly (keyof OpenInSidePanePreferences)[];

const SERVICE_URL_BEHAVIORS: readonly ServiceUrlBehavior[] = ["ask", "in-app", "external"];

const SERVICE_URL_LABEL_KEYS: Record<ServiceUrlBehavior, string> = {
  ask: "settings.general.serviceUrls.options.ask",
  "in-app": "settings.general.serviceUrls.options.inApp",
  external: "settings.general.serviceUrls.options.external",
};

type OpenLocationSource = keyof OpenInSidePanePreferences | "pullRequests";

function OpenLocationRow({
  source,
  destination,
  allowExplorer,
  onDestinationChange,
}: {
  source: OpenLocationSource;
  destination: PullRequestOpenLocation;
  allowExplorer?: boolean;
  onDestinationChange(source: OpenLocationSource, destination: PullRequestOpenLocation): void;
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
  const options = useMemo(
    () =>
      (["tab", "pane"] as const).map((scope) => ({
        value: scope,
        label: t(`settings.layout.workspacePanes.explorerProject.options.${scope}`),
      })),
    [t],
  );
  return (
    <SettingsSelect
      label={t("settings.layout.workspacePanes.explorerProject.label")}
      hint={t("settings.layout.workspacePanes.explorerProject.description")}
      value={value}
      options={options}
      onValueChange={onChange}
    />
  );
}

function ServiceUrlRow() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const options = useMemo(
    () =>
      SERVICE_URL_BEHAVIORS.map((value) => ({ value, label: t(SERVICE_URL_LABEL_KEYS[value]) })),
    [t],
  );
  const change = useCallback(
    (serviceUrlBehavior: ServiceUrlBehavior) => void updateSettings({ serviceUrlBehavior }),
    [updateSettings],
  );
  return (
    <SettingsSelect
      label={t("settings.layout.openInSidePane.sources.serviceUrls.label")}
      value={settings.serviceUrlBehavior}
      options={options}
      onValueChange={change}
    />
  );
}

/** Where things open: files, diffs, subagents, pull requests, and script URLs. Desktop only. */
export function OpenLocationSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const handleDestinationChange = useCallback(
    (source: OpenLocationSource, destination: PullRequestOpenLocation) => {
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
            <OpenLocationRow
              key={source}
              source={source}
              destination={settings.openInSidePane[source] ? "side" : "main"}
              onDestinationChange={handleDestinationChange}
            />
          ))}
          <OpenLocationRow
            source="pullRequests"
            destination={settings.pullRequestOpenLocation}
            allowExplorer
            onDestinationChange={handleDestinationChange}
          />
          <ServiceUrlRow />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
