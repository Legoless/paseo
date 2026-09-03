import { default as React, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, Grid2x2, Rows2, Square } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { PaneLayout, PaneLayoutNode } from "@getpaseo/protocol/workspace-layouts";
import { MenuHint, MenuItem, MenuSeparator, type MenuPageDefinition } from "@/components/ui/menu";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import type { Theme } from "@/styles/theme";
import { BUILT_IN_PANE_LAYOUTS } from "./built-in";

/** The `MenuSubTrigger` on a workspace's menu that opens the layout page. */
export const PANE_LAYOUT_PAGE_ID = "paneLayout";

/** Matches the leading column every other workspace-menu row sits in. */
const MENU_ICON_SIZE = 14;

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedSquare = withUnistyles(Square);
const ThemedColumns = withUnistyles(Columns2);
const ThemedRows = withUnistyles(Rows2);
const ThemedGrid = withUnistyles(Grid2x2);

const BUILT_IN_ICONS: Record<string, React.ReactElement> = {
  single: <ThemedSquare size={MENU_ICON_SIZE} uniProps={mutedMapping} />,
  "two-columns": <ThemedColumns size={MENU_ICON_SIZE} uniProps={mutedMapping} />,
  "two-rows": <ThemedRows size={MENU_ICON_SIZE} uniProps={mutedMapping} />,
};

/** Every grid shares one icon; the dimensions are in the label. */
const GRID_ICON = <ThemedGrid size={MENU_ICON_SIZE} uniProps={mutedMapping} />;

const CUSTOM_ICON = <ThemedGrid size={MENU_ICON_SIZE} uniProps={mutedMapping} />;

const NO_PAGES: readonly MenuPageDefinition[] = [];
const NO_LAYOUTS: readonly PaneLayout[] = [];
const NO_ERRORS: readonly string[] = [];

export interface PaneLayoutTarget {
  serverId: string;
  workspaceId: string;
}

/**
 * Whether this client can arrange panes at all. Splits do not exist on compact or on wide native,
 * so the row is simply absent there rather than given a fallback — the precedent
 * docs/explorer-sidebar.md sets for desktop layout preferences.
 */
export function useCanApplyPaneLayouts(): boolean {
  const isCompact = useIsCompactFormFactor();
  return supportsDesktopPaneSplits() && !isCompact;
}

/** The single page behind a workspace's `Pane layout` row, for whichever menu is asking. */
export function usePaneLayoutMenuPages(
  target: PaneLayoutTarget | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  const canApply = useCanApplyPaneLayouts();
  return useMemo(() => {
    if (!target || !canApply) return NO_PAGES;
    return [
      {
        id: PANE_LAYOUT_PAGE_ID,
        title: t("paneLayouts.title"),
        content: <PaneLayoutPickerPage target={target} />,
      },
    ];
  }, [canApply, t, target]);
}

function PaneLayoutPickerPage({ target }: { target: PaneLayoutTarget }): React.ReactElement {
  const { t } = useTranslation();
  const { config } = useDaemonConfig(target.serverId);
  const client = useHostRuntimeClient(target.serverId);
  const applyPaneLayout = useWorkspaceLayoutStore((state) => state.applyPaneLayout);

  const custom = config?.paneLayouts ?? NO_LAYOUTS;
  const errors = config?.paneLayoutErrors ?? NO_ERRORS;
  // Against an older daemon the layouts directory is ignored entirely, which is indistinguishable
  // from having authored none. Say which it is.
  const hostSupportsLayouts = client?.getLastServerInfoMessage()?.features?.paneLayouts === true;

  const workspaceKey = buildWorkspaceTabPersistenceKey(target);
  const apply = useCallback(
    (node: PaneLayoutNode) => {
      if (workspaceKey) {
        applyPaneLayout(workspaceKey, node);
      }
    },
    [applyPaneLayout, workspaceKey],
  );

  return (
    <>
      {BUILT_IN_PANE_LAYOUTS.map((layout) => (
        <PaneLayoutRow
          key={layout.id}
          testID={`pane-layout-${layout.id}`}
          leading={BUILT_IN_ICONS[layout.id] ?? GRID_ICON}
          label={t(layout.nameKey, layout.nameParams)}
          node={layout.root}
          onApply={apply}
        />
      ))}
      {custom.length > 0 ? <MenuSeparator /> : null}
      {custom.map((layout) => (
        <PaneLayoutRow
          key={layout.id}
          testID={`pane-layout-custom-${layout.id}`}
          leading={CUSTOM_ICON}
          // User-authored, so never translated.
          label={layout.name}
          node={layout.root}
          onApply={apply}
        />
      ))}
      {!hostSupportsLayouts ? <MenuHint>{t("paneLayouts.updateHost")}</MenuHint> : null}
      {errors.map((error) => (
        // Daemon output naming a file the user wrote — not translated either.
        <MenuHint key={error} testID="pane-layout-error">
          {error}
        </MenuHint>
      ))}
    </>
  );
}

function PaneLayoutRow({
  testID,
  leading,
  label,
  node,
  onApply,
}: {
  testID: string;
  leading: React.ReactElement;
  label: string;
  node: PaneLayoutNode;
  onApply: (node: PaneLayoutNode) => void;
}): React.ReactElement {
  const handleSelect = useCallback(() => {
    onApply(node);
  }, [node, onApply]);
  return (
    // No `selected` check: applying is an action, and there is no "current layout" to tick.
    <MenuItem testID={testID} leading={leading} onSelect={handleSelect}>
      {label}
    </MenuItem>
  );
}
