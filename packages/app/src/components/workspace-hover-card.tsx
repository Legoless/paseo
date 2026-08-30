import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import { Dimensions, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Check,
  Copy,
  ExternalLink,
  FileDiff,
  Folder,
  GitBranch,
  PanelsTopLeft,
  Server,
} from "lucide-react-native";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import { ForgeBrandIcon } from "@/git/forge-icon";
import type { Theme } from "@/styles/theme";
import { DiffStat } from "@/components/diff-stat";
import { Pressable } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { Portal } from "@gorhom/portal";
import { useBottomSheetModalInternal } from "@gorhom/bottom-sheet";
import type { PrHint } from "@/git/use-pr-status-query";
import { openExternalUrl } from "@/utils/open-external-url";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { PrBadge } from "@/components/sidebar/pr-badge";
import { useHoverSafeZone } from "@/hooks/use-hover-safe-zone";
import { useIsCompactFormFactor } from "@/constants/layout";
import { FloatingSurface } from "@/components/ui/floating";
import { isWeb } from "@/constants/platform";
import { useHosts } from "@/runtime/host-runtime";
import {
  COUNTED_CHECK_PRESENTATIONS,
  countCheckPresentations,
  type CountedCheckPresentation,
} from "@/git/check-presentation";
import { formatCheckPresentationCountsLabel } from "@/git/check-presentation-copy";
import { CheckPresentationIcon, getCheckPresentationTone } from "@/git/check-presentation.view";
import { buildForgeChecksUrl } from "@/git/forge-url";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import {
  collectAllPanes,
  collectAllTabs,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function measureElement(element: View): Promise<Rect> {
  return new Promise((resolve) => {
    element.measureInWindow((x, y, width, height) => {
      resolve({ x, y, width, height });
    });
  });
}

function computeHoverCardPosition({
  triggerRect,
  contentSize,
  displayArea,
  offset,
}: {
  triggerRect: Rect;
  contentSize: { width: number; height: number };
  displayArea: Rect;
  offset: number;
}): { x: number; y: number } {
  let x = triggerRect.x + triggerRect.width + offset;
  let y = triggerRect.y;

  // If it overflows right, try left
  if (x + contentSize.width > displayArea.width - 8) {
    x = triggerRect.x - contentSize.width - offset;
  }

  // Constrain to screen
  const padding = 8;
  x = Math.max(padding, Math.min(displayArea.width - contentSize.width - padding, x));
  y = Math.max(
    displayArea.y + padding,
    Math.min(displayArea.y + displayArea.height - contentSize.height - padding, y),
  );

  return { x, y };
}

const HOVER_GRACE_MS = 100;
const HOVER_CARD_WIDTH = 260;

interface WorkspaceHoverCardProps {
  workspace: SidebarWorkspaceEntry;
  isDragging: boolean;
  disabled?: boolean;
}

interface AgentHoverCardProps {
  title: string;
  serverId: string;
  branch: string | null;
  diffStat: { additions: number; deletions: number } | null;
  workspaceDirectory: string;
  workspaceDirectoryLabel: string;
  prHint: PrHint | null;
  disabled?: boolean;
}

type HoverCardDetails =
  | {
      kind: "workspace";
      title: string;
      workspaceKey: string;
      projectCount: number;
    }
  | ({ kind: "agent" } & Omit<AgentHoverCardProps, "disabled">);

export function WorkspaceHoverCard({
  workspace,
  isDragging,
  disabled = false,
  children,
}: PropsWithChildren<WorkspaceHoverCardProps>): ReactNode {
  const details = useMemo<Extract<HoverCardDetails, { kind: "workspace" }>>(
    () => ({
      kind: "workspace",
      title: workspace.name,
      workspaceKey: workspace.workspaceKey,
      projectCount: workspace.projectCount,
    }),
    [workspace.name, workspace.projectCount, workspace.workspaceKey],
  );
  return (
    <HoverCard details={details} isDragging={isDragging} disabled={disabled}>
      {children}
    </HoverCard>
  );
}

export function AgentHoverCard({
  title,
  serverId,
  branch,
  diffStat,
  workspaceDirectory,
  workspaceDirectoryLabel,
  prHint,
  disabled = false,
  children,
}: PropsWithChildren<AgentHoverCardProps>): ReactNode {
  const details = useMemo<Extract<HoverCardDetails, { kind: "agent" }>>(
    () => ({
      kind: "agent",
      title,
      serverId,
      branch,
      diffStat,
      workspaceDirectory,
      workspaceDirectoryLabel,
      prHint,
    }),
    [branch, diffStat, prHint, serverId, title, workspaceDirectory, workspaceDirectoryLabel],
  );
  return (
    <HoverCard details={details} disabled={disabled}>
      {children}
    </HoverCard>
  );
}

function HoverCard({
  details,
  isDragging = false,
  disabled = false,
  children,
}: PropsWithChildren<{
  details: HoverCardDetails;
  isDragging?: boolean;
  disabled?: boolean;
}>): ReactNode {
  const isCompact = useIsCompactFormFactor();

  if (!isWeb || isCompact) {
    return children;
  }

  return (
    <HoverCardDesktop details={details} isDragging={isDragging} disabled={disabled}>
      {children}
    </HoverCardDesktop>
  );
}

function HoverCardDesktop({
  details,
  isDragging,
  disabled,
  children,
}: PropsWithChildren<{
  details: HoverCardDetails;
  isDragging: boolean;
  disabled: boolean;
}>): ReactElement {
  const triggerRef = useRef<View>(null);
  const contentRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearGraceTimer = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    if (graceTimerRef.current) return;
    graceTimerRef.current = setTimeout(() => {
      graceTimerRef.current = null;
      setOpen(false);
    }, HOVER_GRACE_MS);
  }, []);

  const handleTriggerEnter = useCallback(() => {
    clearGraceTimer();
    if (!isDragging && !disabled) {
      setOpen(true);
    }
  }, [clearGraceTimer, disabled, isDragging]);

  const handleTriggerLeave = useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);

  useHoverSafeZone({
    enabled: open,
    triggerRef,
    contentRef,
    onEnterSafeZone: clearGraceTimer,
    onLeaveSafeZone: scheduleClose,
  });

  useEffect(() => {
    if (isDragging || disabled) {
      clearGraceTimer();
      setOpen(false);
    }
  }, [clearGraceTimer, disabled, isDragging]);

  useEffect(() => {
    return () => {
      clearGraceTimer();
    };
  }, [clearGraceTimer]);

  return (
    <View
      ref={triggerRef}
      collapsable={false}
      onPointerEnter={handleTriggerEnter}
      onPointerLeave={handleTriggerLeave}
    >
      {children}
      {open ? (
        <HoverCardContent details={details} triggerRef={triggerRef} contentRef={contentRef} />
      ) : null}
    </View>
  );
}

function HoverCardContent({
  details,
  triggerRef,
  contentRef,
}: {
  details: HoverCardDetails;
  triggerRef: React.RefObject<View | null>;
  contentRef: React.RefObject<View | null>;
}): ReactElement | null {
  const bottomSheetInternal = useBottomSheetModalInternal(true);
  const [triggerRect, setTriggerRect] = useState<Rect | null>(null);
  const [contentSize, setContentSize] = useState<{ width: number; height: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  // Measure trigger — same pattern as tooltip.tsx
  useEffect(() => {
    if (!triggerRef.current) return;

    let cancelled = false;
    measureElement(triggerRef.current).then((rect) => {
      if (cancelled) return;
      setTriggerRect(rect);
      return;
    });

    return () => {
      cancelled = true;
    };
  }, [triggerRef]);

  // Compute position when both measurements are available
  useEffect(() => {
    if (!triggerRect || !contentSize) return;
    const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
    const displayArea = { x: 0, y: 0, width: screenWidth, height: screenHeight };
    const result = computeHoverCardPosition({
      triggerRect,
      contentSize,
      displayArea,
      offset: 4,
    });
    setPosition(result);
  }, [triggerRect, contentSize]);

  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = event.nativeEvent.layout;
      setContentSize({ width, height });
    },
    [],
  );

  const frameStyle = useMemo(
    () => ({
      position: "absolute" as const,
      top: position?.y ?? -9999,
      left: position?.x ?? -9999,
    }),
    [position?.x, position?.y],
  );

  return (
    <Portal hostName={bottomSheetInternal?.hostName}>
      <View pointerEvents="box-none" style={styles.portalOverlay}>
        <FloatingSurface
          ref={contentRef}
          entering={FadeIn.duration(80)}
          exiting={FadeOut.duration(80)}
          collapsable={false}
          onLayout={handleLayout}
          accessibilityRole="menu"
          accessibilityLabel={details.title}
          testID={details.kind === "workspace" ? "workspace-hover-card" : "agent-hover-card"}
          style={styles.card}
          frameStyle={frameStyle}
        >
          {details.kind === "workspace" ? (
            <WorkspaceHoverCardBody details={details} />
          ) : (
            <AgentHoverCardBody details={details} />
          )}
        </FloatingSurface>
      </View>
    </Portal>
  );
}

function WorkspaceHoverCardBody({
  details,
}: {
  details: Extract<HoverCardDetails, { kind: "workspace" }>;
}) {
  const { t } = useTranslation();
  const openTabCount = useWorkspaceLayoutStore((state) => {
    const layout = state.layoutByWorkspace[details.workspaceKey];
    if (!layout) return 0;
    const visibleTabIds = new Set(collectAllPanes(layout.root).flatMap((pane) => pane.tabIds));
    return collectAllTabs(layout.root).filter(
      (tab) => visibleTabIds.has(tab.tabId) && tab.target.kind === "agent",
    ).length;
  });
  return (
    <>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} testID="hover-card-workspace-name">
          {details.title}
        </Text>
      </View>
      <InfoRow
        icon={ThemedPanelsTopLeft}
        value={t("workspace.hoverCard.openTabs", { count: openTabCount })}
        testID="hover-card-workspace-tabs"
      />
      <InfoRow
        icon={ThemedFolder}
        value={t("workspace.hoverCard.projects", { count: details.projectCount })}
        testID="hover-card-workspace-projects"
      />
    </>
  );
}

function AgentHoverCardBody({
  details,
}: {
  details: Extract<HoverCardDetails, { kind: "agent" }>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} testID="hover-card-agent-name">
          {details.title}
        </Text>
      </View>
      {details.prHint ? <PrBadge hint={details.prHint} style={styles.cardInfoRow} /> : null}
      {details.diffStat ? (
        <View style={styles.cardInfoRow}>
          <ThemedFileDiff size={12} uniProps={foregroundMutedColorMapping} />
          <DiffStat additions={details.diffStat.additions} deletions={details.diffStat.deletions} />
        </View>
      ) : null}
      <HostRow serverId={details.serverId} />
      {details.branch ? (
        <CopyableInfoRow
          icon={ThemedGitBranch}
          value={details.branch}
          copyValue={details.branch}
          copyLabel={t("workspace.hoverCard.copyBranchName")}
          testID="hover-card-agent-branch"
        />
      ) : null}
      {details.workspaceDirectory ? (
        <CopyableInfoRow
          icon={ThemedFolder}
          value={details.workspaceDirectoryLabel}
          copyValue={details.workspaceDirectory}
          copyLabel={t("workspace.hoverCard.copyPath")}
          testID="hover-card-agent-cwd"
        />
      ) : null}
      {details.prHint?.checks && details.prHint.checks.length > 0 ? (
        <>
          <View style={styles.separator} />
          <ChecksSummaryPressable
            checks={details.prHint.checks}
            url={details.prHint.url}
            forge={details.prHint.forge}
          />
        </>
      ) : null}
    </>
  );
}

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedFolder = withUnistyles(Folder);
const ThemedPanelsTopLeft = withUnistyles(PanelsTopLeft);
const ThemedServer = withUnistyles(Server);
const ThemedFileDiff = withUnistyles(FileDiff);

type CardInfoIcon = React.ComponentType<React.ComponentProps<typeof ThemedGitBranch>>;

function HostRow({ serverId }: { serverId: string }): ReactElement | null {
  const hosts = useHosts();
  const host = hosts.find((h) => h.serverId === serverId);
  const label = host?.label?.trim() || serverId;

  return <InfoRow icon={ThemedServer} value={label} testID="hover-card-agent-host" />;
}

const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedCopy = withUnistyles(Copy);
const ThemedCheck = withUnistyles(Check);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function InfoRow({
  icon: Icon,
  value,
  testID,
}: {
  icon: CardInfoIcon;
  value: string;
  testID: string;
}) {
  return (
    <View style={styles.cardInfoRow}>
      <Icon size={12} uniProps={foregroundMutedColorMapping} />
      <Text style={styles.cardInfoText} numberOfLines={1} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function renderChecksSummaryForgeIcon(icon: string, iconUniProps: typeof foregroundColorMapping) {
  return <ForgeBrandIcon iconKind={icon} size={12} uniProps={iconUniProps} />;
}

function CopyableInfoRow({
  icon: Icon,
  value,
  copyValue,
  copyLabel,
  testID,
}: {
  icon: CardInfoIcon;
  value: string;
  copyValue: string;
  copyLabel: string;
  testID: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);

  const handlePress = useCallback(() => {
    void copyToClipboard(copyValue);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, [copyValue]);

  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);

  let iconUniProps = foregroundMutedColorMapping;
  if (copied || isHovered) {
    iconUniProps = foregroundColorMapping;
  }
  const textStyle =
    copied || isHovered ? [styles.cardInfoText, styles.cardInfoTextHovered] : styles.cardInfoText;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copyLabel}
      style={styles.cardInfoRow}
      hitSlop={4}
      onPressIn={handlePressIn}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
    >
      {(() => {
        if (copied) {
          return <ThemedCheck size={12} uniProps={iconUniProps} />;
        }
        if (isHovered) {
          return <ThemedCopy size={12} uniProps={iconUniProps} />;
        }
        return <Icon size={12} uniProps={iconUniProps} />;
      })()}
      <Text style={textStyle} numberOfLines={1} testID={testID}>
        {value}
      </Text>
    </Pressable>
  );
}

function ChecksSummaryPill({
  count,
  presentation,
}: {
  count: number;
  presentation: CountedCheckPresentation;
}) {
  if (count === 0) return null;
  return (
    <View style={styles.checksSummaryPill}>
      <CheckPresentationIcon presentation={presentation} size={12} />
      <Text style={checksSummaryTextStyle(presentation)}>{count}</Text>
    </View>
  );
}

function checksSummaryTextStyle(presentation: CountedCheckPresentation) {
  const tone = getCheckPresentationTone(presentation);
  if (tone === "success") return styles.checksStatusTextPassed;
  if (tone === "danger") return styles.checksStatusTextFailed;
  if (tone === "warning") return styles.checksStatusTextPending;
  return styles.checksStatusTextMuted;
}

function ChecksSummaryContent({
  checks,
  forge,
  hovered,
}: {
  checks: NonNullable<PrHint["checks"]>;
  forge: PrHint["forge"];
  hovered: boolean;
}) {
  const { t } = useTranslation();
  const counts = countCheckPresentations(checks);

  const labelStyle = hovered
    ? [styles.checksSummaryLabel, styles.checksSummaryLabelHovered]
    : styles.checksSummaryLabel;
  const iconUniProps = hovered ? foregroundColorMapping : foregroundMutedColorMapping;
  const icon = getForgePresentation(normalizeForge(forge)).icon;

  return (
    <>
      {hovered ? (
        <ThemedExternalLink size={12} uniProps={iconUniProps} />
      ) : (
        renderChecksSummaryForgeIcon(icon, iconUniProps)
      )}
      <Text style={labelStyle}>{t("workspace.git.pr.sections.checks")}</Text>
      <View style={styles.checksSummaryCounts}>
        {COUNTED_CHECK_PRESENTATIONS.map((presentation) => (
          <ChecksSummaryPill
            key={presentation}
            count={counts[presentation]}
            presentation={presentation}
          />
        ))}
      </View>
    </>
  );
}

function ChecksSummaryPressable({
  checks,
  forge,
  url,
}: {
  checks: NonNullable<PrHint["checks"]>;
  forge: PrHint["forge"];
  url: string;
}) {
  const { t } = useTranslation();
  const counts = countCheckPresentations(checks);
  const accessibilityLabel = formatCheckPresentationCountsLabel(
    counts,
    t("workspace.git.pr.sections.checks"),
    t,
  );
  const handlePress = useCallback(() => {
    void openExternalUrl(buildForgeChecksUrl(forge, url) ?? url);
  }, [forge, url]);

  const renderChildren = useCallback(
    ({ hovered }: { pressed: boolean; hovered?: boolean }) => (
      <ChecksSummaryContent checks={checks} forge={forge} hovered={Boolean(hovered)} />
    ),
    [checks, forge],
  );

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="link"
      style={checksSummaryPressableStyle}
      onPress={handlePress}
    >
      {renderChildren}
    </Pressable>
  );
}

function checksSummaryPressableStyle({ hovered = false }: { pressed: boolean; hovered?: boolean }) {
  return [styles.checksSummaryRow, hovered && styles.listRowHovered];
}

const styles = StyleSheet.create((theme) => ({
  portalOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
  },
  card: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    paddingTop: theme.spacing[2],
    width: HOVER_CARD_WIDTH,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 1000,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    flex: 1,
    minWidth: 0,
  },
  cardInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  cardInfoText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  cardInfoTextHovered: {
    color: theme.colors.foreground,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  listRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  checksSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 6,
    minHeight: 28,
  },
  checksSummaryLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  checksSummaryLabelHovered: {
    color: theme.colors.foreground,
  },
  checksSummaryCounts: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    justifyContent: "flex-end",
  },
  checksSummaryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  checksStatusTextFailed: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusDanger,
  },
  checksStatusTextPending: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusWarning,
  },
  checksStatusTextPassed: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusSuccess,
  },
  checksStatusTextMuted: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
}));
