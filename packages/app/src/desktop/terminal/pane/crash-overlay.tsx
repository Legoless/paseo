import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/**
 * In-tab affordance shown when an isolated terminal guest dies or hangs. It covers the guest
 * surface only; the daemon session and the main-renderer stream subscription are untouched, so
 * Reload re-mounts the guest and replays the cached snapshot.
 */
export function TerminalGuestCrashOverlay({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation();
  const handleReload = useCallback(() => {
    onReload();
  }, [onReload]);

  return (
    <View style={styles.overlay} testID="terminal-guest-crash-overlay">
      <View style={styles.card}>
        <Text style={styles.title}>{t("workspace.terminal.rendererStopped")}</Text>
        <Text style={styles.description}>{t("workspace.terminal.rendererStoppedDescription")}</Text>
        <Button variant="secondary" size="sm" onPress={handleReload}>
          {t("workspace.terminal.reload")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  card: {
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: 320,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
