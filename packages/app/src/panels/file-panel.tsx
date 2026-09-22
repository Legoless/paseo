import { Text, View } from "react-native";
import { useMemo } from "react";
import invariant from "tiny-invariant";
import { useTranslation } from "react-i18next";
import { FilePane } from "@/file-pane/pane";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel } from "@/panels/panel-registry";
import { useSelectedWorkspaceProject } from "@/stores/workspace-project-selection-store";
import { createMaterialFileIcon } from "@/components/material-file-icon";
import { isAbsolutePath } from "@/utils/path";

const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

function useFilePanelDescriptor(target: { kind: "file"; path: string }) {
  const fileName = target.path.split("/").findLast(Boolean) ?? target.path;
  const icon = useMemo(() => createMaterialFileIcon(fileName), [fileName]);
  return {
    label: fileName,
    subtitle: target.path,
    tooltip: target.path,
    titleState: "ready" as const,
    icon,
    statusBucket: null,
  };
}

function FilePanel() {
  const { t } = useTranslation();
  const {
    serverId,
    workspaceId,
    workspaceRoot: paneWorkspaceRoot,
    target,
    fileNavigationRevision,
  } = usePaneContext();
  const { cwd: selectedProjectRoot } = useSelectedWorkspaceProject(serverId, workspaceId);
  const workspaceRoot = paneWorkspaceRoot ?? selectedProjectRoot ?? "";
  invariant(target.kind === "file", "FilePanel requires file target");
  if (!workspaceRoot && !isAbsolutePath(target.path)) {
    return (
      <View style={CENTERED_PADDED_STYLE}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>
    );
  }
  return (
    <FilePane
      serverId={serverId}
      workspaceRoot={workspaceRoot}
      location={target}
      navigationRevision={fileNavigationRevision ?? 0}
    />
  );
}

export const filePanelRegistration = definePanel("file", {
  component: FilePanel,
  useDescriptor: useFilePanelDescriptor,
});
