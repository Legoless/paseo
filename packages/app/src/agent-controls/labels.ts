import { i18n } from "@/i18n/i18next";

interface ControlLabelInput {
  id: string;
  label?: string | null;
}

function sentenceCase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function splitCompactLabel(value: string, splitHyphen: boolean): string {
  const separatorPattern = splitHyphen ? /[_-]+/g : /_+/g;

  return value
    .replace(separatorPattern, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatControlLabel(option: ControlLabelInput, splitHyphen: boolean): string {
  const rawLabel = (option.label ?? option.id).trim();
  return sentenceCase(splitCompactLabel(rawLabel, splitHyphen));
}

export function formatAgentModeLabel(mode: ControlLabelInput): string {
  return formatControlLabel(mode, mode.label == null);
}

function stripThinkingLabelPrefix(value: string): string {
  const match = /^thinking[\s:_-]+(.+)$/i.exec(value);
  if (!match) {
    return value;
  }
  const stripped = match[1]?.trim() ?? "";
  return stripped || value;
}

// Grok's built-in catalog names efforts "Extra High Effort" and its downloaded one "Extra High",
// so the same effort renders one way whichever catalog the provider reported.
function stripEffortLabelSuffix(value: string): string {
  const match = /^(.+?)[\s_-]+effort$/i.exec(value);
  return match?.[1]?.trim() || value;
}

export function formatThinkingOptionLabel(option: ControlLabelInput): string {
  const rawLabel = stripEffortLabelSuffix(
    stripThinkingLabelPrefix((option.label ?? option.id).trim()),
  );
  const compactLabel = rawLabel.replace(/[\s_-]+/g, "").toLowerCase();

  if (compactLabel === "xhigh" || compactLabel === "extrahigh") {
    return i18n.t("agentControls.thinking.extraHigh");
  }

  return sentenceCase(splitCompactLabel(rawLabel, true));
}
