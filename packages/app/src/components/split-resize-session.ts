import { getIsElectron, isWeb } from "@/constants/platform";

export const SPLIT_RESIZE_ROOT_ATTRIBUTE = "data-split-resizing";
export const PANE_PANEL_CONTENT_DATA_SET = { panePanelContent: "true" } as const;

const STYLE_ID = "paseo-split-resize-styles";
const WINDOW_RESIZE_SETTLE_MS = 150;

let splitterDepth = 0;
let windowResizing = false;
let windowResizeTimer: ReturnType<typeof setTimeout> | null = null;

function isDocumentReady(): boolean {
  return isWeb && typeof document !== "undefined";
}

function installSplitResizeStyles(): void {
  if (!isDocumentReady() || document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Skip laying out agent streams, glows, and terminals while the mosaic is
  // still moving. Tab bars stay visible so the user can see the new geometry.
  style.textContent = `
html[${SPLIT_RESIZE_ROOT_ATTRIBUTE}] [data-pane-panel-content] {
  content-visibility: hidden;
  pointer-events: none;
}
`;
  document.head.append(style);
}

function syncSplitResizeSession(): void {
  if (!isDocumentReady()) {
    return;
  }
  const active = splitterDepth > 0 || windowResizing;
  if (active) {
    installSplitResizeStyles();
    document.documentElement.setAttribute(SPLIT_RESIZE_ROOT_ATTRIBUTE, "true");
    document.documentElement.style.overflowX = "hidden";
    return;
  }
  document.documentElement.removeAttribute(SPLIT_RESIZE_ROOT_ATTRIBUTE);
  document.documentElement.style.overflowX = "";
}

export function isSplitResizeActive(): boolean {
  return splitterDepth > 0 || windowResizing;
}

export function beginSplitterDrag(): void {
  splitterDepth += 1;
  syncSplitResizeSession();
}

export function endSplitterDrag(): void {
  splitterDepth = Math.max(0, splitterDepth - 1);
  syncSplitResizeSession();
}

export function noteWindowResizing(): void {
  if (!isWeb) {
    return;
  }
  windowResizing = true;
  syncSplitResizeSession();
  if (windowResizeTimer !== null) {
    clearTimeout(windowResizeTimer);
  }
  windowResizeTimer = setTimeout(() => {
    windowResizeTimer = null;
    windowResizing = false;
    syncSplitResizeSession();
  }, WINDOW_RESIZE_SETTLE_MS);
}

export function installSplitResizeWindowListener(): () => void {
  if (!isWeb || !getIsElectron()) {
    return () => {};
  }
  const onResize = () => noteWindowResizing();
  window.addEventListener("resize", onResize);
  return () => {
    window.removeEventListener("resize", onResize);
    if (windowResizeTimer !== null) {
      clearTimeout(windowResizeTimer);
      windowResizeTimer = null;
    }
    windowResizing = false;
    syncSplitResizeSession();
  };
}
