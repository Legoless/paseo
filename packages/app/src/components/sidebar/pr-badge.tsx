import { useCallback, useState } from "react";
import {
  Pressable,
  Text,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import type { PrHint } from "@/git/use-pr-status-query";
import { PullRequestStateIcon } from "@/git/pull-request-state-icon";
import type { Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";

const ThemedExternalLink = withUnistyles(ExternalLink);
const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});

export function PrBadge({ hint, style }: { hint: PrHint; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      void openExternalUrl(hint.url);
    },
    [hint.url],
  );
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.badge,
      style,
      pressed && styles.badgePressed,
    ],
    [style],
  );
  const textStyle = isHovered ? [styles.text, styles.textHovered] : styles.text;
  const presentation = getForgePresentation(normalizeForge(hint.forge));

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t("workspace.git.pr.accessibility.pullRequest", {
        number: hint.number,
        context: presentation.changeRequestContext,
      })}
      hitSlop={4}
      onPressIn={handlePressIn}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={pressableStyle}
    >
      {isHovered ? (
        <ThemedExternalLink size={12} uniProps={foregroundColorMapping} />
      ) : (
        <PullRequestStateIcon state={hint.state} size={12} />
      )}
      <Text style={textStyle} numberOfLines={1}>
        {hint.number}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  badgePressed: {
    opacity: 0.82,
  },
  text: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
  },
  textHovered: {
    color: theme.colors.foreground,
  },
}));
