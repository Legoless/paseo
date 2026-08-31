import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

// ── runtime detection ───────────────────────────────────────────────────────
// Packaged: reads variant.json from extraResources (<resourcesPath>/variant.json).
// Dev: checks PASEO_VARIANT env var.
// ---------------------------------------------------------------------------

interface VariantManifest {
  variant: "neo";
}

function readVariantManifest(): VariantManifest | null {
  // In packaged apps, process.resourcesPath points to the Resources/ dir inside
  // the .app bundle on macOS. electron-builder places extraResources here.
  if (process.resourcesPath) {
    const manifestPath = path.join(process.resourcesPath, "variant.json");
    try {
      if (existsSync(manifestPath)) {
        const raw = readFileSync(manifestPath, "utf-8");
        const parsed = JSON.parse(raw) as VariantManifest;
        if (parsed.variant === "neo") {
          return parsed;
        }
      }
    } catch {
      // Missing or unreadable — normal Paseo build.
    }
  }

  // Dev fallback: env var override (only when not packaged).
  if (process.env.PASEO_VARIANT === "neo") {
    return { variant: "neo" };
  }

  return null;
}

const variant = readVariantManifest();

export const isNeo = variant?.variant === "neo";

export const APP_NAME = process.env.PASEO_TEST_APP_NAME?.trim() || (isNeo ? "Paseo Neo" : "Paseo");
export const APP_SCHEME = isNeo ? "paseo-neo" : "paseo";
export const NEO_PASEO_HOME = path.join(process.env.HOME ?? "~", ".paseo-neo");
// ponytail: port 6768 chosen to leave room for dev ports 6769+; change if it collides.
export const NEO_PASEO_LISTEN = "127.0.0.1:6768";
