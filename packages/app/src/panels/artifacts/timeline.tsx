import { useCallback, useMemo, useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react-native";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { AttachmentLightbox, type ImageLightboxSource } from "@/components/attachment-lightbox";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useAssistantImage } from "@/assistant-image/use-assistant-image";
import { createAssistantImageOccurrenceKey } from "@/assistant-image/acquisition-cache";
import { useSessionStore } from "@/stores/session-store";
import { formatTimeAgo } from "@/utils/time";
import type { Theme } from "@/styles/theme";
import { useWorkspaceArtifacts } from "./use-workspace-artifacts";
import type { ArtifactEntry } from "./select";
import {
  ARTIFACT_NEAR_BOTTOM_THRESHOLD,
  distanceFromBottom,
  resolveArtifactFollowOutput,
} from "./follow-output";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ARTIFACT_IMAGE_MIN_HEIGHT = 160;

export function ArtifactsTimeline(input: {
  serverId: string;
  workspaceId: string;
  active: boolean;
}) {
  const { t } = useTranslation();
  const entries = useWorkspaceArtifacts(input);
  const client = useSessionStore((state) => state.sessions[input.serverId]?.client ?? null);
  const scrollRef = useRef<ScrollView>(null);
  const offsetYRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const [followOutput, setFollowOutput] = useState(true);

  const scrollToBottom = useCallback(() => {
    setFollowOutput(true);
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const nextOffsetY = contentOffset.y;
    const scrolledUp = nextOffsetY < offsetYRef.current - 1;
    offsetYRef.current = nextOffsetY;
    viewportHeightRef.current = layoutMeasurement.height;
    contentHeightRef.current = contentSize.height;
    const nextDistance = distanceFromBottom({
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
      offsetY: nextOffsetY,
    });
    setFollowOutput((current) =>
      resolveArtifactFollowOutput({
        following: current,
        distanceFromBottom: nextDistance,
        scrolledUp,
      }),
    );
  }, []);

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeightRef.current = height;
      if (!followOutput) {
        return;
      }
      scrollRef.current?.scrollToEnd({ animated: false });
    },
    [followOutput],
  );

  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      viewportHeightRef.current = event.nativeEvent.layout.height;
      if (
        followOutput &&
        distanceFromBottom({
          contentHeight: contentHeightRef.current,
          viewportHeight: event.nativeEvent.layout.height,
          offsetY: offsetYRef.current,
        }) > ARTIFACT_NEAR_BOTTOM_THRESHOLD
      ) {
        scrollRef.current?.scrollToEnd({ animated: false });
      }
    },
    [followOutput],
  );

  return (
    <View style={styles.root} testID="artifacts-timeline">
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        onLayout={handleLayout}
        scrollEventThrottle={16}
      >
        {entries.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t("panels.artifacts.empty")}</Text>
          </View>
        ) : (
          entries.map((entry) => (
            <ArtifactRow key={entry.id} entry={entry} client={client} serverId={input.serverId} />
          ))
        )}
      </ScrollView>
      {followOutput ? null : (
        <View style={styles.jumpContainer} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("agentStream.scrollToBottom")}
            onPress={scrollToBottom}
            style={styles.jumpButton}
          >
            <ChevronDown size={20} color={styles.jumpIcon.color} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function ArtifactRow({
  entry,
  client,
  serverId,
}: {
  entry: ArtifactEntry;
  client: DaemonClient | null;
  serverId: string;
}) {
  const caption = entry.agentTitle ?? entry.agentId;
  return (
    <View style={styles.row} testID={`artifact-row-${entry.id}`}>
      <ArtifactImage
        source={entry.source}
        alt={entry.alt}
        occurrenceKey={`${createAssistantImageOccurrenceKey({
          agentId: entry.agentId,
          itemId: entry.itemId,
        })}:${entry.imageIndex}`}
        client={client}
        workspaceRoot={entry.workspaceRoot}
        serverId={serverId}
      />
      <View style={styles.meta}>
        <Text style={styles.agentTitle} numberOfLines={1}>
          {caption}
        </Text>
        <Text style={styles.timestamp}>{formatTimeAgo(entry.timestamp)}</Text>
      </View>
    </View>
  );
}

function ArtifactImage({
  source,
  alt,
  occurrenceKey,
  client,
  workspaceRoot,
  serverId,
}: {
  source: string;
  alt: string | null;
  occurrenceKey: string;
  client: DaemonClient | null;
  workspaceRoot: string;
  serverId: string;
}) {
  const { t } = useTranslation();
  const [viewerOpen, setViewerOpen] = useState(false);
  const openViewer = useCallback(() => setViewerOpen(true), []);
  const closeViewer = useCallback(() => setViewerOpen(false), []);
  const image = useAssistantImage({
    source,
    occurrenceKey,
    client,
    workspaceRoot,
    serverId,
  });
  const binding = image.status === "failed" ? null : image.binding;
  const aspectRatio = image.status === "failed" ? null : image.aspectRatio;
  const imageUri = binding?.uri ?? "";
  const imageSource = useMemo(() => ({ uri: imageUri }), [imageUri]);
  const imageSizeStyle = useMemo<ViewStyle>(() => {
    if (aspectRatio) {
      return { aspectRatio };
    }
    return { height: ARTIFACT_IMAGE_MIN_HEIGHT };
  }, [aspectRatio]);
  const surfaceStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.imageSurface, imageSizeStyle],
    [imageSizeStyle],
  );
  const lightboxSource = useMemo<ImageLightboxSource | null>(() => {
    if (!viewerOpen || !imageUri) {
      return null;
    }
    return {
      type: "uri",
      uri: imageUri,
      contentSize: aspectRatio ? { width: aspectRatio, height: 1 } : undefined,
    };
  }, [aspectRatio, imageUri, viewerOpen]);

  if (image.status === "failed") {
    return (
      <View style={[styles.imageSurface, styles.imageState, { height: ARTIFACT_IMAGE_MIN_HEIGHT }]}>
        <Text style={styles.imageError}>{image.message}</Text>
      </View>
    );
  }

  if (!binding) {
    return (
      <View style={[styles.imageSurface, styles.imageState, { height: ARTIFACT_IMAGE_MIN_HEIGHT }]}>
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      </View>
    );
  }

  return (
    <View>
      <Pressable
        accessibilityLabel={t("composer.attachments.openImage")}
        accessibilityRole="button"
        disabled={image.status !== "loaded"}
        onPress={openViewer}
        style={surfaceStyle}
      >
        <View style={styles.image} accessibilityRole="image" accessibilityLabel={alt ?? undefined}>
          <Image
            ref={binding.onRef}
            source={imageSource}
            style={styles.image}
            resizeMode="contain"
            onLoad={binding.onLoad}
            onError={binding.onError}
          />
          {image.status === "loading" ? (
            <View pointerEvents="none" style={styles.imageLoading}>
              <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
            </View>
          ) : null}
        </View>
      </Pressable>
      <AttachmentLightbox source={lightboxSource} onClose={closeViewer} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[4],
  },
  empty: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  row: {
    gap: theme.spacing[2],
  },
  meta: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  agentTitle: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  timestamp: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  imageSurface: {
    width: "100%",
    overflow: "hidden",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imageState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
  },
  imageError: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  imageLoading: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  jumpContainer: {
    position: "absolute",
    right: theme.spacing[3],
    bottom: theme.spacing[3],
  },
  jumpButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface3,
  },
  jumpIcon: {
    color: theme.colors.foreground,
  },
}));
