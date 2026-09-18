import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { resolvePaneStatusGlowBucket, type PaneStatusGlowBucket } from "@/utils/pane-status-glow";

const GLOW_DATA_SET = {
  running: { statusGlow: "running" },
  needs_input: { statusGlow: "needs_input" },
  failed: { statusGlow: "failed" },
  attention: { statusGlow: "attention" },
} as const;

export function PaneStatusGlowLayer({
  bucket,
}: {
  bucket: SidebarStateBucket | null;
}): ReactElement | null {
  const glow = resolvePaneStatusGlowBucket(bucket);
  if (!glow) {
    return null;
  }
  return (
    <View
      testID="workspace-pane-status-glow"
      dataSet={GLOW_DATA_SET[glow]}
      style={glowLayerStyle(glow)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

function glowLayerStyle(bucket: PaneStatusGlowBucket) {
  if (bucket === "running") {
    return styles.running;
  }
  if (bucket === "needs_input") {
    return styles.needsInput;
  }
  if (bucket === "failed") {
    return styles.failed;
  }
  return styles.attention;
}

const WEB_GLOW_DEPTH_PX = 24;

// Web draws the inset glow as four edge gradients. Chromium re-rasterizes a blurred inset
// box-shadow on a pane-sized overlay every resize frame and every repaint of content sharing
// its layer, on the GPU thread that presents frames. Theme colors are CSS variables on web
// (Unistyles CSSVars), so alpha goes through color-mix rather than hex math.
function webGlow(color: string) {
  const tint = (percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;
  const ramp = (direction: string) =>
    `linear-gradient(${direction}, ${tint(60)}, ${tint(16)} 11px, transparent ${WEB_GLOW_DEPTH_PX}px)`;
  return {
    boxShadow: "none",
    backgroundImage: ["to bottom", "to top", "to right", "to left"].map(ramp).join(", "),
    backgroundSize: `100% ${WEB_GLOW_DEPTH_PX}px, 100% ${WEB_GLOW_DEPTH_PX}px, ${WEB_GLOW_DEPTH_PX}px 100%, ${WEB_GLOW_DEPTH_PX}px 100%`,
    backgroundPosition: "top, bottom, left, right",
    backgroundRepeat: "no-repeat",
  };
}

function glowLayer(theme: Theme, bucket: PaneStatusGlowBucket) {
  const color = getStatusDotColor({ theme, bucket });
  return {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    pointerEvents: "none" as const,
    borderWidth: theme.borderWidth[2],
    borderColor: color ?? "transparent",
    boxShadow: color ? `inset 0 0 18px 2px ${color}` : undefined,
    _web: color ? webGlow(color) : undefined,
  };
}

const styles = StyleSheet.create((theme) => ({
  running: glowLayer(theme, "running"),
  needsInput: glowLayer(theme, "needs_input"),
  failed: glowLayer(theme, "failed"),
  attention: glowLayer(theme, "attention"),
}));
