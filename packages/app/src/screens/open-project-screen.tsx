import { useEffect } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PaseoLogo } from "@/components/icons/paseo-logo";
import { CommunityLinks } from "@/components/community-links";
import { HomeTiles } from "@/components/home-tiles";
import { MenuHeader } from "@/components/headers/menu-header";
import { usePanelStore } from "@/stores/panel-store";
import { useHosts, useHostRuntimeLastError } from "@/runtime/host-runtime";
import {
  useIsCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";

export function OpenProjectScreen() {
  const hosts = useHosts();
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  const isCompactLayout = useIsCompactFormFactor();

  useEffect(() => {
    if (!isCompactLayout) {
      openDesktopAgentList();
    }
  }, [isCompactLayout, openDesktopAgentList]);

  return (
    <View style={styles.container}>
      <MenuHeader borderless />
      <View style={styles.content}>
        <TitlebarDragRegion />
        <View style={styles.logo}>
          <PaseoLogo size={52} />
        </View>
        {hosts.map((host) => (
          <HostError key={host.serverId} serverId={host.serverId} label={host.label} />
        ))}
        <HomeTiles />
      </View>
      <View style={styles.communityRow}>
        <CommunityLinks />
      </View>
    </View>
  );
}

function HostError({ serverId, label }: { serverId: string; label: string }) {
  const error = useHostRuntimeLastError(serverId);
  return error ? (
    <Text accessibilityRole="alert" style={styles.hostError}>
      {label}: {error}
    </Text>
  ) : null;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    userSelect: "none",
  },
  content: {
    position: "relative",
    flex: 1,
    justifyContent: { xs: "flex-start", md: "center" },
    alignItems: "center",
    gap: 0,
    padding: theme.spacing[6],
    paddingTop: { xs: theme.spacing[12], md: theme.spacing[6] },
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[6],
      md: HEADER_INNER_HEIGHT + theme.spacing[6],
    },
  },
  logo: {
    marginBottom: theme.spacing[8],
  },
  hostError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    maxWidth: 452,
    textAlign: "center",
  },
  communityRow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[2],
      md: HEADER_INNER_HEIGHT + theme.spacing[2],
    },
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
  },
}));
