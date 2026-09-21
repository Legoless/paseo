// Apply the interface (UI) font app-wide on web.
//
// react-native-web stamps a hardcoded default font onto every text element, so a
// plain `body { font-family }` never cascades in — the element already has its own
// font. Instead we inject ONE rule that points all text at a CSS variable and set
// that variable live. The selector is high-specificity (1,2,0) so it deterministically
// beats both RN-web's base font and Unistyles' generated classes (0,1,0) — no reliance
// on stylesheet order. Code/diff/terminal surfaces carry `data-pmono` (and have their
// subtree excluded via `:not([data-pmono] *)`) so they keep their monospace font.
import { DEFAULT_WEB_UI_FONT_STACK } from "@/styles/theme";

const STYLE_ID = "paseo-ui-font";
const RULE =
  ":is(#root, #overlay-root) *:not([data-pmono]):not([data-pmono] *){font-family:var(--paseo-ui-font);}";

export function sanitizeCssFontStack(uiFontStack: string): string {
  return uiFontStack
    .replace(/[<>{}();]/g, "")
    .replace(/[\r\n]/g, " ")
    .trim();
}

export function resolveWebUiFontStack(requested: string, spaceAdvancePx: number | null): string {
  const stack = sanitizeCssFontStack(requested);
  if (stack.length === 0 || stack === "normal") {
    return DEFAULT_WEB_UI_FONT_STACK;
  }
  if (spaceAdvancePx !== null && spaceAdvancePx < 1) {
    return DEFAULT_WEB_UI_FONT_STACK;
  }
  return stack;
}

function measureSpaceAdvancePx(fontStack: string): number | null {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    context.font = `16px ${fontStack}`;
    return context.measureText("a a").width - context.measureText("aa").width;
  } catch {
    return null;
  }
}

export function applyRootUiFont(uiFontStack: string): void {
  if (typeof document === "undefined") return;
  const requested = sanitizeCssFontStack(uiFontStack);
  const value = resolveWebUiFontStack(requested, measureSpaceAdvancePx(requested));
  if (value.length === 0) return;

  document.documentElement.style.setProperty("--paseo-ui-font", value);

  // The rule itself is static (references the variable); inject it once.
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = RULE;
    document.head.appendChild(style);
  }
}
