import { test } from "../support/fixtures";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import {
  composerLocator,
  expectComposerDraft,
  expectComposerEditable,
  expectComposerVisible,
  submitMessage,
} from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test.describe("composer prompt history", () => {
  test("cycles through sent prompts with ArrowUp and ArrowDown and preserves drafts", async ({
    page,
  }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "prompt-history-e2e-",
      title: "Prompt history E2E",
    });

    try {
      await openAgentRoute(page, session);
      await expectComposerVisible(page);
      await expectAgentIdle(page);

      const composer = composerLocator(page);

      // Send first prompt
      await submitMessage(page, "First test prompt");
      await expectAgentIdle(page);
      await expectComposerEditable(page);
      await expectComposerDraft(page, "");

      // Send second prompt
      await submitMessage(page, "Second test prompt");
      await expectAgentIdle(page);
      await expectComposerEditable(page);
      await expectComposerDraft(page, "");

      // Press ArrowUp on empty composer -> shows latest prompt
      await composer.focus();
      await composer.press("ArrowUp");
      await expectComposerDraft(page, "Second test prompt");

      // Press ArrowUp again -> shows earlier prompt
      await composer.press("ArrowUp");
      await expectComposerDraft(page, "First test prompt");

      // ArrowUp at earliest prompt stays at earliest prompt
      await composer.press("ArrowUp");
      await expectComposerDraft(page, "First test prompt");

      // Press ArrowDown -> cycles back to newer prompt
      await composer.press("ArrowDown");
      await expectComposerDraft(page, "Second test prompt");

      // Press ArrowDown past latest prompt -> restores initial empty draft
      await composer.press("ArrowDown");
      await expectComposerDraft(page, "");

      // Type a draft, then press ArrowUp
      await composer.fill("Stashed draft text");
      await composer.press("ArrowUp");
      await expectComposerDraft(page, "Second test prompt");

      // Press ArrowDown -> restores stashed draft
      await composer.press("ArrowDown");
      await expectComposerDraft(page, "Stashed draft text");

      // Press ArrowUp, then Escape -> cancels navigation and restores stashed draft
      await composer.press("ArrowUp");
      await expectComposerDraft(page, "Second test prompt");
      await composer.press("Escape");
      await expectComposerDraft(page, "Stashed draft text");
    } finally {
      await session.cleanup();
    }
  });
});
