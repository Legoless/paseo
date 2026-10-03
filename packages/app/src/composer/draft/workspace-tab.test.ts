import { InitialPromptFailedError } from "@getpaseo/client/internal/daemon-client";
import { describe, expect, test, vi } from "vitest";

import {
  archiveAgentLeftByFailedPrompt,
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

describe("archiving the agent left by a failed first prompt", () => {
  test("archives the agent named by a failed first prompt", async () => {
    const archived: string[] = [];
    await archiveAgentLeftByFailedPrompt(
      new InitialPromptFailedError("Input exceeds the maximum length", "agent-orphan"),
      async (agentId) => {
        archived.push(agentId);
      },
    );
    expect(archived).toEqual(["agent-orphan"]);
  });

  test("archives nothing when creation failed before an agent existed", async () => {
    const archived: string[] = [];
    await archiveAgentLeftByFailedPrompt(new Error("Provider unavailable"), async (agentId) => {
      archived.push(agentId);
    });
    expect(archived).toEqual([]);
  });

  test("does not fail the retry when archiving fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      archiveAgentLeftByFailedPrompt(
        new InitialPromptFailedError("failed", "agent-1"),
        async () => {
          throw new Error("host disconnected");
        },
      ),
    ).resolves.toBeUndefined();
  });
});
