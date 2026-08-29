import { describe, expect, test } from "vitest";

import {
  buildDraftSetupWithCwd,
  shouldAllowEmptyDraftText,
  validateDraftSubmission,
} from "./workspace-tab-core";

const baseComposerState = {
  providerDefinitions: [{ id: "codewhale" }],
  selectedProvider: "codewhale",
  isModelLoading: false,
  effectiveModelId: "",
  availableModels: [],
};

function validate(overrides = {}) {
  return validateDraftSubmission({
    text: "hello",
    allowsEmptyAutoSubmit: false,
    composerState: baseComposerState,
    autoSubmitConfig: null,
    workspaceDirectory: "/tmp/project",
    hasClient: true,
    ...overrides,
  });
}

describe("workspace draft agent model validation", () => {
  test("allows a ready provider with no models to submit without a selected model", () => {
    expect(validate({})).toBeNull();
  });

  test("keeps waiting while model defaults are loading", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          isModelLoading: true,
        },
      }),
    ).toBe("Model defaults are still loading");
  });

  test("still requires a selected model when the provider exposes models", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          availableModels: [{ id: "deepseek/deepseek-v4-pro" }],
        },
      }),
    ).toBe("No model is available for the selected provider");
  });
});

describe("workspace draft empty text readiness", () => {
  test("allows attachment-only retries after a fork draft create fails", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [{ kind: "chat_history" }],
      }),
    ).toBe(true);
  });

  test("still rejects empty drafts with no auto-submit and no attachments", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [],
      }),
    ).toBe(false);
  });
});

describe("buildDraftSetupWithCwd", () => {
  test("keeps every existing setup field but the cwd", () => {
    const currentSetup = {
      provider: "claude" as const,
      cwd: "/repo-one",
      modeId: "plan",
      model: "opus",
      thinkingOptionId: "high",
      featureValues: { fast: true },
    };

    expect(buildDraftSetupWithCwd({ currentSetup, cwd: "/repo-two" })).toEqual({
      ...currentSetup,
      cwd: "/repo-two",
    });
  });

  test("snapshots the composer selections when the draft has no setup yet", () => {
    expect(
      buildDraftSetupWithCwd({
        currentSetup: null,
        cwd: "/repo-two",
        provider: "codex",
        modeId: null,
        model: "gpt-5",
        thinkingOptionId: null,
        featureValues: undefined,
      }),
    ).toEqual({
      provider: "codex",
      cwd: "/repo-two",
      modeId: null,
      model: "gpt-5",
      thinkingOptionId: null,
      featureValues: {},
    });
  });

  test("returns null when there is no provider to pin", () => {
    expect(
      buildDraftSetupWithCwd({
        currentSetup: null,
        cwd: "/repo-two",
        provider: null,
        modeId: null,
        model: null,
        thinkingOptionId: null,
        featureValues: undefined,
      }),
    ).toBeNull();
  });
});
