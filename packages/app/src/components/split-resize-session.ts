import { getIsElectron, isWeb } from "@/constants/platform";

export const SPLIT_RESIZE_ROOT_ATTRIBUTE = "data-split-resizing";

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
  // Glow is a pane-sized overlay Chromium re-rasterizes on every resize frame.
  // Hide only that; pane content has to stay visible for the drag.
  style.textContent = `
html[${SPLIT_RESIZE_ROOT_ATTRIBUTE}] [data-testid="workspace-pane-status-glow"] {
  visibility: hidden;
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
