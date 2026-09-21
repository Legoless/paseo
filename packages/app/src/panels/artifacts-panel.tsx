import { Images } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { ArtifactsTimeline } from "@/panels/artifacts/timeline";

const ThemedImages = withUnistyles(Images);
const artifactsPanelPresentation = {
  label: (t) => t("panels.artifacts.label"),
  subtitle: (t) => t("panels.artifacts.subtitle"),
  tooltip: (t) => t("panels.artifacts.tooltip"),
  icon: ThemedImages,
} satisfies PanelPresentation;

function ArtifactsPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  const active = useRetainedPanelActive();
  invariant(target.kind === "artifacts", "ArtifactsPanel requires artifacts target");
  return <ArtifactsTimeline serverId={serverId} workspaceId={workspaceId} active={active} />;
}

export const artifactsPanelRegistration = definePanel("artifacts", {
  component: ArtifactsPanel,
  presentation: artifactsPanelPresentation,
});
