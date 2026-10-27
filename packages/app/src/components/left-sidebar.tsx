import { router } from "expo-router";
import {
  CircleGauge,
  FolderPlus,
  Plus,
  Server,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Pressable,
  type PressableStateCallbackType,
  StyleSheet as RNStyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { resolveDesktopSidebarWidth } from "@/components/desktop-sidebar-layout";
import {
  SIDEBAR_RESIZE_ACTIVATION_OFFSET,
  SIDEBAR_RESIZE_FAIL_OFFSET,
} from "@/components/sidebar-resize-handle-layout";
import { HostPicker } from "@/components/hosts/host-picker";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { SidebarSeparator } from "@/components/sidebar/sidebar-separator";
import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";
import { SidebarHelpMenu } from "@/components/sidebar/sidebar-help-menu";
import { SidebarResizeHandle } from "@/components/sidebar-resize-handle";
import { DensityIcon } from "@/components/ui/density-icon";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HEADER_INNER_HEIGHT, useIsCompactFormFactor } from "@/constants/layout";
import { resolveAddProjectTargetWorkspace } from "@/add-project-flow/target-workspace";
import { useCreateProjectlessWorkspace } from "@/hooks/use-create-projectless-workspace";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useImportSession } from "@/hooks/use-import-session";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import {
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarWorkspaceSection } from "@/projects/workspace-groups";
import { density } from "@/styles/density";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { RetainedPanelActivity } from "@/components/retained-panel";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";
import { type SidebarGroupMode, useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useHosts } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import { builtinSidebarNavLabelKey } from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { usePanelStore } from "@/stores/panel-store";
import { useOwnsWindowChromeCorner, WindowChromeSafeArea } from "@/utils/desktop-window";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import {
  buildNewWorkspaceRoute,
  buildSettingsAddHostRoute,
  buildSettingsRoute,
} from "@/utils/host-routes";
import { openHostOverview } from "@/navigation/settings-navigation";
import {
  UsageSidebarItem,
  UsageSidebarRoot,
  useHasUsageSummary,
  useOpenSidebarUsage,
} from "@/usage";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarCalloutSlot } from "./sidebar-callout-slot";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";
import type { Theme } from "@/styles/theme";

type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

interface SidebarSharedProps {
  theme: SidebarTheme;
  workspaceGroups: SidebarWorkspaceGroup[];
  projectIconTargets: SidebarProjectIconTarget[];
  memberIconTargets: SidebarProjectIconTarget[];
  pinnedGroups: PinnedSidebarGroups;
  topLevelWorkspaces: SidebarWorkspacePlacement[];
  sectionsByWorkspaceKey: ReadonlyMap<string, SidebarWorkspaceSection>;
  hasProjectsBeforeFilter: boolean;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isManualRefresh: boolean;
  groupMode: SidebarGroupMode;
  collapsedWorkspaceKeys: ReadonlySet<string>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  toggleWorkspaceCollapsed: (workspaceKey: string) => void;
  handleRefresh: () => void;
  handleOpenProject: () => void;
  handleImportSession: () => void;
  handleSettings: () => void;
  labels: SidebarLabels;
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}

interface SidebarLabels {
  addProject: string;
  hosts: string;
  settings: string;
  searchHosts: string;
  usage: string;
  closeSidebar: string;
}

interface MobileSidebarProps extends SidebarSharedProps {
  active: boolean;
  insetsTop: number;
  insetsBottom: number;
  closeSidebar: () => void;
}

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  active: boolean;
}

export const LeftSidebar = memo(function LeftSidebar({ active }: { active: boolean }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);

  const {
    hasProjectsBeforeFilter,
    workspaceEntriesByKey,
    isInitialLoad,
    isRevalidating,
    refreshAll,
    workspaceGroups,
    topLevelWorkspaces,
    workspaceGroupSections,
    projectIconTargets,
    pinnedGroups,
    collapsedWorkspaceKeys,
    toggleWorkspaceCollapsed,
    groupMode,
    shortcutModel,
  } = useSidebarModel();
  const { shortcutIndexByWorkspaceKey } = shortcutModel;

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  const openProjectPicker = useOpenAddProject();
  const { open: openImportSession, sheet: importSessionSheet } = useImportSession();
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const addProjectTargetWorkspace = useMemo(
    () =>
      resolveAddProjectTargetWorkspace({
        activeSelection: activeWorkspaceSelection ?? null,
        pinnedWorkspaces: pinnedGroups.pinnedChats,
        topLevelWorkspaces,
      }),
    [activeWorkspaceSelection, pinnedGroups.pinnedChats, topLevelWorkspaces],
  );

  const openProjectPickerForTarget = useCallback(() => {
    // The host is pinned to the target's, since a project can only join a
    // workspace on the same daemon.
    openProjectPicker(
      addProjectTargetWorkspace?.serverId,
      addProjectTargetWorkspace ? { targetWorkspace: addProjectTargetWorkspace } : undefined,
    );
  }, [addProjectTargetWorkspace, openProjectPicker]);

  const handleOpenProjectMobile = useCallback(() => {
    showMobileAgent();
    openProjectPickerForTarget();
  }, [showMobileAgent, openProjectPickerForTarget]);

  const handleOpenProjectDesktop = openProjectPickerForTarget;

  const handleSettingsMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsRoute());
  }, [showMobileAgent]);

  const handleSettingsDesktop = useCallback(() => {
    router.push(buildSettingsRoute());
  }, []);

  const handleAddHostMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, [showMobileAgent]);

  const handleAddHostDesktop = useCallback(() => {
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, []);

  const handleOpenHostSettingsMobile = useCallback(
    (serverId: string) => {
      showMobileAgent();
      openHostOverview(serverId);
    },
    [showMobileAgent],
  );

  const handleOpenHostSettingsDesktop = useCallback((serverId: string) => {
    openHostOverview(serverId);
  }, []);

  const handleImportSessionMobile = useCallback(() => {
    showMobileAgent();
    openImportSession();
  }, [openImportSession, showMobileAgent]);

  const labels = useMemo(
    (): SidebarLabels => ({
      addProject: t("sidebar.actions.addProject"),
      hosts: t("sidebar.actions.hosts"),
      settings: t("sidebar.actions.settings"),
      searchHosts: t("sidebar.host.searchPlaceholder"),
      usage: t(builtinSidebarNavLabelKey("usage")),
      closeSidebar: t("sidebar.actions.closeSidebar"),
    }),
    [t],
  );

  const sharedProps = {
    theme,
    workspaceGroups,
    projectIconTargets,
    memberIconTargets: workspaceGroupSections.memberIconTargets,
    pinnedGroups,
    topLevelWorkspaces,
    sectionsByWorkspaceKey: workspaceGroupSections.sectionsByWorkspaceKey,
    hasProjectsBeforeFilter,
    workspaceEntriesByKey,
    isInitialLoad,
    isRevalidating,
    isManualRefresh,
    groupMode,
    collapsedWorkspaceKeys,
    shortcutIndexByWorkspaceKey,
    toggleWorkspaceCollapsed,
    handleRefresh,
    labels,
  };

  if (isCompactLayout) {
    return (
      <>
        <RetainedPanelActivity active={active}>
          <MobileSidebar
            {...sharedProps}
            active={active}
            insetsTop={insets.top}
            insetsBottom={insets.bottom}
            closeSidebar={showMobileAgent}
            handleOpenProject={handleOpenProjectMobile}
            handleImportSession={handleImportSessionMobile}
            handleSettings={handleSettingsMobile}
            handleAddHost={handleAddHostMobile}
            handleOpenHostSettings={handleOpenHostSettingsMobile}
          />
        </RetainedPanelActivity>
        {importSessionSheet}
      </>
    );
  }

  return (
    <>
      <RetainedPanelActivity active={active}>
        <DesktopSidebar
          {...sharedProps}
          insetsTop={insets.top}
          active={active}
          handleOpenProject={handleOpenProjectDesktop}
          handleImportSession={openImportSession}
          handleSettings={handleSettingsDesktop}
          handleAddHost={handleAddHostDesktop}
          handleOpenHostSettings={handleOpenHostSettingsDesktop}
        />
      </RetainedPanelActivity>
      {importSessionSheet}
    </>
  );
});

function sidebarHostOptionTestID(serverId: string): string {
  return `sidebar-host-row-${serverId}`;
}

function FooterIconButton({
  buttonRef,
  onPress,
  testID,
  label,
  icon,
  iconSizeAdjustment = 0,
  shortcutKeys,
}: {
  onPress: () => void;
  testID: string;
  label: string;
  icon: LucideIcon;
  /** Only for a glyph that reads larger than the others at the same size. */
  iconSizeAdjustment?: number;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
  buttonRef?: RefObject<View | null>;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          ref={buttonRef}
          style={styles.footerIconButton}
          testID={testID}
          nativeID={testID}
          collapsable={false}
          accessible
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={onPress}
        >
          {({ hovered }) => (
            <DensityIcon
              icon={icon}
              size="md"
              sizeAdjustment={iconSizeAdjustment}
              color={hovered ? "foreground" : "foregroundMuted"}
            />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8} testID={`${testID}-tooltip`}>
        <IconTooltipContent label={label} shortcutKeys={shortcutKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarHostPicker({
  label,
  onAddHost,
  onOpenHostSettings,
}: {
  label: string;
  onAddHost: () => void;
  onOpenHostSettings: (serverId: string) => void;
}) {
  const hosts = useHosts();
  const triggerRef = useRef<View | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = useCallback(
    (id: string) => {
      onOpenHostSettings(id);
    },
    [onOpenHostSettings],
  );

  const handleOpen = useCallback(() => setIsOpen(true), []);

  return (
    <HostPicker
      hosts={hosts}
      value=""
      onSelect={handleSelect}
      open={isOpen}
      onOpenChange={setIsOpen}
      anchorRef={triggerRef}
      includeAddHost
      onAddHost={onAddHost}
      showActiveConnection
      onOpenHostSettings={onOpenHostSettings}
      searchable
      desktopPlacement="top-start"
      desktopMinWidth={240}
      addHostTestID="sidebar-host-add"
      hostOptionTestID={sidebarHostOptionTestID}
    >
      <FooterIconButton
        buttonRef={triggerRef}
        onPress={handleOpen}
        testID="sidebar-hosts-trigger"
        label={label}
        icon={Server}
        // Server's two boxes fill more of the square than the other glyphs.
        iconSizeAdjustment={-1}
      />
    </HostPicker>
  );
}

function IconTooltipContent({
  label,
  shortcutKeys,
}: {
  label: string;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
    </View>
  );
}

function SidebarFooter({
  handleOpenProject,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  onBeforeNavigate,
}: {
  handleOpenProject: () => void;
  handleSettings: () => void;
  labels: {
    addProject: string;
    hosts: string;
    settings: string;
    searchHosts: string;
    usage: string;
  };
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
  onBeforeNavigate?: () => void;
}) {
  const newAgentKeys = useShortcutKeys("new-agent");
  const settingsKeys = useShortcutKeys("toggle-settings");

  // One line of icons: Add project, Usage, Hosts, then Help and Settings at the end.
  return (
    <UsageSidebarRoot>
      <View style={styles.footerContainer} testID="sidebar-footer">
        <SidebarFooterRows onBeforeNavigate={onBeforeNavigate} />
        <View style={styles.sidebarFooter} testID="sidebar-footer-bottom-line">
          <FooterIconButton
            onPress={handleOpenProject}
            testID="sidebar-add-project"
            label={labels.addProject}
            icon={FolderPlus}
            shortcutKeys={newAgentKeys}
          />
          <SidebarUsageIcon label={labels.usage} />
          <SidebarHostPicker
            label={labels.hosts}
            onAddHost={handleAddHost}
            onOpenHostSettings={handleOpenHostSettings}
          />
          <View style={styles.footerSpacer} />
          <SidebarHelpMenu />
          <FooterIconButton
            onPress={handleSettings}
            testID="sidebar-settings"
            label={labels.settings}
            icon={Settings}
            shortcutKeys={settingsKeys}
          />
        </View>
      </View>
    </UsageSidebarRoot>
  );
}

function SidebarUsageIcon({ label }: { label: string }) {
  const openUsage = useOpenSidebarUsage();
  return (
    <FooterIconButton
      onPress={openUsage}
      testID="sidebar-usage-icon"
      label={label}
      icon={CircleGauge}
    />
  );
}

/**
 * The footer rows in the user's `sidebarFooterItems` order: the Usage item and plugin rows. The
 * Usage item is left out while it has no summary to show.
 */
function SidebarFooterRows({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { items } = useSidebarNavItems("footer");
  const hasUsageSummary = useHasUsageSummary();
  const rowsRef = useRef<View | null>(null);
  const visibleItems = items.filter(
    (item) => item.visible && (item.kind === "plugin" || hasUsageSummary),
  );
  if (visibleItems.length === 0) return null;
  return (
    <>
      <View ref={rowsRef} collapsable={false} style={styles.footerRows}>
        {visibleItems.map((item) =>
          item.kind === "plugin" ? (
            <PluginSidebarItem
              key={item.key}
              group={item.group}
              section="footer"
              fallbackAnchorRef={rowsRef}
              onBeforeNavigate={onBeforeNavigate}
            />
          ) : (
            <UsageSidebarItem key={item.key} />
          ),
        )}
      </View>
      <SidebarSeparator testID="sidebar-footer-separator" />
    </>
  );
}

function MobileSidebar({
  active,
  theme,
  workspaceGroups,
  projectIconTargets,
  memberIconTargets,
  pinnedGroups,
  topLevelWorkspaces,
  sectionsByWorkspaceKey,
  hasProjectsBeforeFilter,
  workspaceEntriesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedWorkspaceKeys,
  shortcutIndexByWorkspaceKey,
  toggleWorkspaceCollapsed,
  handleRefresh,
  handleOpenProject,
  handleImportSession,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  insetsBottom,
  closeSidebar,
}: MobileSidebarProps) {
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const { gesture: closeGesture, gestureRef: closeGestureRef } = useCloseAgentListGesture();

  const handleWorkspacePress = useCallback(() => {
    closeSidebar();
  }, [closeSidebar]);

  const mobileSidebarInsetStyle = useMemo(
    () => ({
      paddingTop: insetsTop,
      paddingBottom: insetsBottom,
      backgroundColor: theme.colors.surfaceSidebar,
    }),
    [insetsTop, insetsBottom, theme.colors.surfaceSidebar],
  );

  return (
    <MobilePanelOverlay
      panel="agent-list"
      closeGesture={closeGesture}
      panelStyle={mobileSidebarInsetStyle}
    >
      <View style={styles.sidebarContent} pointerEvents="auto">
        <WindowChromeSafeArea placement="below" />
        <SidebarNavRows style={styles.sidebarHeaderGroup} onBeforeNavigate={closeSidebar}>
          {workspacesSectionHeaderElement}
        </SidebarNavRows>
        <WindowChromeSafeArea
          placement="inline"
          pointerEvents="box-none"
          style={styles.mobileCloseButtonRow}
        >
          <Pressable
            style={styles.mobileCloseButton}
            onPress={closeSidebar}
            testID="sidebar-close"
            nativeID="sidebar-close"
            accessible
            accessibilityRole="button"
            accessibilityLabel={labels.closeSidebar}
            hitSlop={8}
          >
            {({ hovered, pressed }) => (
              <X
                size={theme.iconSize.md}
                color={hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted}
              />
            )}
          </Pressable>
        </WindowChromeSafeArea>

        {isInitialLoad && !hasActiveHostFilter ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedWorkspaceKeys={collapsedWorkspaceKeys}
            onToggleWorkspaceCollapsed={toggleWorkspaceCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            workspaceGroups={workspaceGroups}
            projectIconTargets={projectIconTargets}
            memberIconTargets={memberIconTargets}
            pinnedGroups={pinnedGroups}
            topLevelWorkspaces={topLevelWorkspaces}
            sectionsByWorkspaceKey={sectionsByWorkspaceKey}
            hasProjectsBeforeFilter={hasProjectsBeforeFilter}
            workspaceEntriesByKey={workspaceEntriesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onWorkspacePress={handleWorkspacePress}
            onAddProject={handleOpenProject}
            onImportSession={handleImportSession}
            parentGestureRef={closeGestureRef}
            dragGestureHostActive={active}
          />
        )}

        <SidebarFooter
          handleOpenProject={handleOpenProject}
          handleSettings={handleSettings}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
          onBeforeNavigate={closeSidebar}
        />
      </View>
    </MobilePanelOverlay>
  );
}

function DesktopSidebar({
  workspaceGroups,
  projectIconTargets,
  memberIconTargets,
  pinnedGroups,
  topLevelWorkspaces,
  sectionsByWorkspaceKey,
  hasProjectsBeforeFilter,
  workspaceEntriesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedWorkspaceKeys,
  shortcutIndexByWorkspaceKey,
  toggleWorkspaceCollapsed,
  handleRefresh,
  handleOpenProject,
  handleImportSession,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  active,
}: DesktopSidebarProps) {
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const visibleSidebarWidth = resolveDesktopSidebarWidth({
    requestedWidth: sidebarWidth,
    viewportWidth,
  });

  const startWidthRef = useRef(visibleSidebarWidth);
  const resizeWidth = useSharedValue(visibleSidebarWidth);
  const [resizePressed, setResizePressed] = useState(false);
  const showResizeGrip = useCallback(() => setResizePressed(true), []);
  const hideResizeGrip = useCallback(() => setResizePressed(false), []);

  useEffect(() => {
    resizeWidth.value = visibleSidebarWidth;
  }, [resizeWidth, visibleSidebarWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onBegin(() => {
          scheduleOnRN(showResizeGrip);
        })
        // Horizontal intent only, so a finger dragging down the touch grip scrolls
        // the workspace list instead of resizing. Anchoring the start width to the
        // activation translation keeps the extra threshold from jumping the edge.
        .activeOffsetX([-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET])
        .failOffsetY([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET])
        .onStart((event) => {
          startWidthRef.current = visibleSidebarWidth - event.translationX;
          resizeWidth.value = visibleSidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          resizeWidth.value = resolveDesktopSidebarWidth({
            requestedWidth: newWidth,
            viewportWidth,
          });
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        })
        .onFinalize(() => {
          scheduleOnRN(hideResizeGrip);
        }),
    [
      hideResizeGrip,
      resizeWidth,
      setSidebarWidth,
      showResizeGrip,
      viewportWidth,
      visibleSidebarWidth,
    ],
  );

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));

  const desktopSidebarStyle = useMemo(
    () => [
      staticStyles.desktopSidebar,
      !active && staticStyles.desktopSidebarHidden,
      resizeAnimatedStyle,
    ],
    [active, resizeAnimatedStyle],
  );
  const desktopSidebarBorderStyle = useMemo(
    () => [styles.desktopSidebarBorder, { flex: 1, paddingTop: insetsTop }],
    [insetsTop],
  );
  const sidebarHeaderGroupStyle = useMemo(
    () => [styles.sidebarHeaderGroup, ownsTopLeft && styles.sidebarHeaderGroupBelowChrome],
    [ownsTopLeft],
  );
  return (
    <Animated.View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      style={desktopSidebarStyle}
    >
      <View style={desktopSidebarBorderStyle}>
        <View style={styles.sidebarDragArea}>
          {ownsTopLeft ? (
            <View style={styles.desktopChromeRow}>
              <TitlebarDragRegion />
            </View>
          ) : (
            <TitlebarDragRegion />
          )}
          <SidebarNavRows style={sidebarHeaderGroupStyle}>
            {workspacesSectionHeaderElement}
          </SidebarNavRows>
        </View>

        {isInitialLoad && !hasActiveHostFilter ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedWorkspaceKeys={collapsedWorkspaceKeys}
            onToggleWorkspaceCollapsed={toggleWorkspaceCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            workspaceGroups={workspaceGroups}
            projectIconTargets={projectIconTargets}
            memberIconTargets={memberIconTargets}
            pinnedGroups={pinnedGroups}
            topLevelWorkspaces={topLevelWorkspaces}
            sectionsByWorkspaceKey={sectionsByWorkspaceKey}
            hasProjectsBeforeFilter={hasProjectsBeforeFilter}
            workspaceEntriesByKey={workspaceEntriesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onAddProject={handleOpenProject}
            onImportSession={handleImportSession}
          />
        )}

        <SidebarCalloutSlot />

        <SidebarFooter
          handleOpenProject={handleOpenProject}
          handleSettings={handleSettings}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
        />

        <SidebarResizeHandle
          edge="right"
          gesture={resizeGesture}
          pressed={resizePressed}
          testID="left-sidebar-resize-handle"
        />
      </View>
    </Animated.View>
  );
}

const ThemedPlus = withUnistyles(Plus);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function renderNewWorkspaceIcon({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) {
  return (
    <ThemedPlus
      size={14}
      uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

function WorkspacesSectionHeader() {
  const { t } = useTranslation();
  const createProjectlessWorkspace = useCreateProjectlessWorkspace();
  const headerIconButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.workspacesHeaderIconButton,
      (hovered || pressed) && styles.workspacesHeaderIconButtonHovered,
    ],
    [],
  );
  const handleNewWorkspacePress = useCallback(() => {
    // The sidebar overlays the workspace on compact form factors, so the new
    // workspace would open behind it.
    usePanelStore.getState().showMobileAgent();
    void (async () => {
      const created = await createProjectlessWorkspace();
      // Several hosts and no active workspace is a real choice; the /new screen
      // is the surface that can ask which one.
      if (!created) router.push(buildNewWorkspaceRoute());
    })();
  }, [createProjectlessWorkspace]);

  return (
    <SidebarSectionHeader title="Workspaces">
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("sidebar.actions.newWorkspace")}
            testID="sidebar-new-workspace"
            style={headerIconButtonStyle}
            onPress={handleNewWorkspacePress}
          >
            {renderNewWorkspaceIcon}
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          {/* No shortcut chord here: Cmd+N opens the New Workspace screen, this
            creates one outright. Same label, different actions. */}
          <IconTooltipContent label={t("sidebar.actions.newWorkspace")} />
        </TooltipContent>
      </Tooltip>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <View>
            <SidebarDisplayPreferencesMenu />
          </View>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <IconTooltipContent label="Display preferences" />
        </TooltipContent>
      </Tooltip>
    </SidebarSectionHeader>
  );
}

// Stable element so both sidebar surfaces share one WorkspacesSectionHeader instance
// identity (it takes no props).
const workspacesSectionHeaderElement = <WorkspacesSectionHeader />;

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticStyles = RNStyleSheet.create({
  desktopSidebar: {
    position: "relative" as const,
  },
  desktopSidebarHidden: {
    display: "none",
  },
});

const styles = StyleSheet.create((theme) => ({
  sidebarHeaderGroup: {
    paddingTop: theme.spacing[2],
    gap: 2,
    paddingBottom: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sidebarHeaderGroupBelowChrome: {
    paddingTop: 0,
  },
  workspacesHeaderIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  workspacesHeaderIconButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  mobileCloseButtonRow: {
    position: "absolute",
    top: theme.spacing[3],
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: "flex-end",
  },
  mobileCloseButton: {
    // The 16px X paints farther inside its 32px hit target than the 14px Settings2 glyph.
    // This optical inset puts their painted right edges on the same sidebar rail.
    marginRight: theme.spacing[2] + 1.5,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  desktopSidebarBorder: {
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  sidebarDragArea: {
    position: "relative",
  },
  desktopChromeRow: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: "transparent",
  },
  footerContainer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  // Buttons sit edge to edge; their own inset spaces the glyphs.
  sidebarFooter: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
  },
  // Pushes Help and Settings to the end of the icon line.
  footerSpacer: {
    flex: 1,
  },
  // Usage and plugin rows sit above the footer's icon line, spaced like the header nav rows.
  footerRows: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    gap: 2,
  },
  footerIconButton: {
    width: density.iconButton,
    height: density.iconButton,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
