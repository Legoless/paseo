import type {
  ProviderCatalog,
  ProviderLaunch,
  ProviderModel,
  ProviderMode,
  ProviderStatus,
} from "@getpaseo/plugin/server/provider";
import { probe } from "./process.js";
import { AntigravityError } from "./wire.js";

const modes: readonly ProviderMode[] = [
  {
    id: "full-access",
    icon: "ShieldOff",
    colorTier: "dangerous",
    label: "Full access",
    description:
      "Antigravity cannot ask for permission when another app drives it. Paseo starts it with --dangerously-skip-permissions.",
    isUnattended: true,
  },
];

const STATUS_CACHE_TTL_MS = 60_000;
const CATALOG_CACHE_TTL_MS = 60_000;
const inflightCatalogs = new Map<string, Promise<ProviderCatalog>>();
const catalogCache = new Map<string, { catalog: ProviderCatalog; expiresAt: number }>();
const inflightStatuses = new Map<string, Promise<ProviderStatus>>();
const statusCache = new Map<string, { status: ProviderStatus; expiresAt: number }>();

export function launchCacheKey(launch: ProviderLaunch): string {
  const env = Object.entries(launch.env).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([launch.command, launch.args, env]);
}

function groupModels(models: ProviderModel[]): ProviderModel[] {
  const groups = new Map<string, ProviderModel[]>();
  for (const model of models) {
    const match = /^(.*) \((Low|Medium|High|XHigh|Max)\)$/i.exec(model.label);
    if (!match) continue;
    const effort = match[2].toLowerCase();
    if (!model.id.endsWith(`-${effort}`)) continue;
    const baseId = model.id.slice(0, -effort.length - 1);
    const key = JSON.stringify([baseId, match[1]]);
    const group = groups.get(key) ?? [];
    group.push(model);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const representative = group[0];
    const label = representative.label.replace(/ \([^()]+\)$/, "");
    const thinkingOptions = group.map((model) => {
      const effortLabel = model.label.slice(label.length + 2, -1);
      return {
        id: effortLabel.toLowerCase(),
        label: effortLabel,
        metadata: { modelId: model.id },
      };
    });
    representative.aliases = group.slice(1).map((model) => model.id);
    // Saved native variants retain their encoded effort while the picker shows one row.
    for (const [index, model] of group.entries()) {
      model.label = label;
      model.thinkingOptions = thinkingOptions;
      model.defaultThinkingOptionId = thinkingOptions[index].id;
      if (index > 0) model.isSelectable = false;
    }
  }
  return models;
}

export function nativeModel(
  config: { model?: string; thinkingOption?: string },
  catalog: ProviderCatalog,
): string | undefined {
  const model = catalog.models.find((entry) => entry.id === config.model);
  const option = model?.thinkingOptions?.find((entry) => entry.id === config.thinkingOption);
  const modelId = option?.metadata?.modelId;
  return typeof modelId === "string" ? modelId : config.model;
}

export async function getCatalog(
  launch: ProviderLaunch,
  cwd?: string,
  options?: { refresh?: boolean },
): Promise<ProviderCatalog> {
  const key = launchCacheKey(launch);
  if (!options?.refresh) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.catalog;
    }
  }
  const existing = inflightCatalogs.get(key);
  if (existing) return existing;
  const pending = (async () => {
    try {
      const output = await probe({ launch, args: ["models"], cwd });
      const models: ProviderModel[] = [];
      for (const line of output.trim().split(/\r?\n/)) {
        const [id, label, ...extra] = line.split("\t");
        if (!id || !label || extra.length > 0)
          throw new AntigravityError("Invalid `agy models` output", "INVALID_CATALOG");
        if (models.some((model) => model.id === id))
          throw new AntigravityError(`Duplicate Antigravity model: ${id}`, "INVALID_CATALOG");
        models.push({ id, label });
      }
      const catalog: ProviderCatalog = {
        models: groupModels(models),
        modes,
        thinkingOptions: [],
        defaultMode: "full-access",
      };
      catalogCache.set(key, { catalog, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS });
      return catalog;
    } catch (error) {
      const cached = catalogCache.get(key);
      if (
        cached &&
        error instanceof AntigravityError &&
        (error.code === "PROBE_TIMEOUT" ||
          (error.code === "PROBE_ERROR" && !/authentication failed/i.test(error.message)))
      ) {
        catalogCache.set(key, {
          catalog: cached.catalog,
          expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
        });
        return cached.catalog;
      }
      throw error;
    }
  })().finally(() => {
    inflightCatalogs.delete(key);
  });
  inflightCatalogs.set(key, pending);
  return pending;
}

export async function getStatus(launch: ProviderLaunch): Promise<ProviderStatus> {
  const key = launchCacheKey(launch);
  const cached = statusCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.status;
  }
  const existing = inflightStatuses.get(key);
  if (existing) return existing;
  const pending = (async (): Promise<ProviderStatus> => {
    try {
      const version = (await probe({ launch, args: ["--version"] })).trim();
      const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
      if (!match)
        return {
          available: false,
          diagnostic: "Could not read the Antigravity version. Update `agy` to 1.1.15 or later.",
        };
      const [, major, minor, patch] = match.map(Number);
      const supported = major > 1 || (major === 1 && (minor > 1 || (minor === 1 && patch >= 15)));
      if (!supported)
        return {
          available: false,
          diagnostic: `Antigravity ${version} is unsupported. Update \`agy\` to 1.1.15 or later.`,
        };
      await getCatalog(launch);
      const status: ProviderStatus = { available: true };
      statusCache.set(key, { status, expiresAt: Date.now() + STATUS_CACHE_TTL_MS });
      return status;
    } catch (error) {
      if (!(error instanceof AntigravityError)) throw error;
      if (
        (cached?.status.available || catalogCache.has(key)) &&
        (error.code === "PROBE_TIMEOUT" ||
          (error.code === "PROBE_ERROR" && !/authentication failed/i.test(error.message)))
      ) {
        const status: ProviderStatus = { available: true };
        statusCache.set(key, { status, expiresAt: Date.now() + STATUS_CACHE_TTL_MS });
        return status;
      }
      return { available: false, diagnostic: error.message };
    }
  })().finally(() => {
    inflightStatuses.delete(key);
  });
  inflightStatuses.set(key, pending);
  return pending;
}

export function validateSelection(
  config: { model?: string; mode?: string; thinkingOption?: string },
  catalog: ProviderCatalog,
): void {
  if (config.model && !catalog.models.some((model) => model.id === config.model))
    throw new AntigravityError(`Unknown Antigravity model: ${config.model}`, "INVALID_MODEL");
  if (config.mode && !catalog.modes.some((mode) => mode.id === config.mode))
    throw new AntigravityError(`Unknown Antigravity mode: ${config.mode}`, "INVALID_MODE");
  const model = catalog.models.find((entry) => entry.id === config.model);
  if (
    config.thinkingOption &&
    !model?.thinkingOptions?.some((option) => option.id === config.thinkingOption)
  )
    throw new AntigravityError(
      `Unsupported Antigravity effort for ${config.model ?? "the default model"}: ${config.thinkingOption}`,
      "INVALID_THINKING_OPTION",
    );
}
