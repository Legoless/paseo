import { useId } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import type { Theme } from "@/styles/theme";

export const SCRIM_WIDTH = 48;
const SCRIM_SOLID_OFFSET = "55%";

const BACKDROP_CSS_COLOR: Record<SurfaceBackdrop, string> = {
  surface0: "var(--colors-surface0)",
  surface1: "var(--colors-surface1)",
  surface2: "var(--colors-surface2)",
  surfaceSidebar: "var(--colors-surface-sidebar)",
  surfaceSidebarHover: "var(--colors-surface-sidebar-hover)",
  surfaceSidebarSelected: "var(--colors-surface-sidebar-selected)",
};

function TrailingActionScrimSvg({
  gradientId,
  color,
  backdrop,
}: {
  gradientId: string;
  color: string;
  backdrop: SurfaceBackdrop;
}) {
  const stopColor = isWeb ? BACKDROP_CSS_COLOR[backdrop] : color;
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          {/* Vary opacity rather than interpolating toward `transparent`, which crosses black in
              some engines and leaves a grey fringe. */}
          <Stop offset="0%" stopColor={stopColor} stopOpacity={0} />
          <Stop offset={SCRIM_SOLID_OFFSET} stopColor={stopColor} stopOpacity={1} />
          <Stop offset="100%" stopColor={stopColor} stopOpacity={1} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

const ThemedTrailingActionScrimSvg = withUnistyles(TrailingActionScrimSvg);

const backdropColorMappings: Record<SurfaceBackdrop, (theme: Theme) => { color: string }> = {
  surface0: (theme) => ({ color: theme.colors.surface0 }),
  surface1: (theme) => ({ color: theme.colors.surface1 }),
  surface2: (theme) => ({ color: theme.colors.surface2 }),
  surfaceSidebar: (theme) => ({ color: theme.colors.surfaceSidebar }),
  surfaceSidebarHover: (theme) => ({ color: theme.colors.surfaceSidebarHover }),
  surfaceSidebarSelected: (theme) => ({ color: theme.colors.surfaceSidebarSelected }),
};

/** Fades trailing content into the surface beneath an absolutely overlaid action. */
export function TrailingActionScrim({
  backdrop,
  testID,
}: {
  backdrop: SurfaceBackdrop;
  testID?: string;
}) {
  // React-generated ids contain characters that are invalid inside SVG fragment references.
  const gradientId = `trailing-action-scrim-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <View style={styles.scrim} pointerEvents="none" testID={testID}>
      <ThemedTrailingActionScrimSvg
        gradientId={gradientId}
        backdrop={backdrop}
        uniProps={backdropColorMappings[backdrop]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: SCRIM_WIDTH,
  },
});
