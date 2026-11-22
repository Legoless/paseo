import { expect, test } from "../support/fixtures";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import {
  expectTimelinePromptVisible,
  openAgentTimeline,
  seedLongMockAgentTimeline,
} from "../support/helpers/timeline-pagination";
import {
  disconnectViewedTimeline,
  restoreViewedTimelineWithHeldResponse,
} from "../support/helpers/timeline-resume";

test.describe("Agent timeline sync retry", () => {
  test("a refused catch-up offers a retry that reports pending, failure, and recovery", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const gate = await installDaemonWebSocketGate(page);
    const agent = await seedLongMockAgentTimeline({ turns: 2 });
    try {
      await openAgentTimeline(page, agent);
      await expectTimelinePromptVisible(page, agent.newestPrompt);

      gate.failTimelineResponses(agent.agentId);
      await disconnectViewedTimeline(page, gate);
      await restoreViewedTimelineWithHeldResponse(page, gate);

      const callout = page.getByTestId("agent-timeline-sync-error");
      const retry = page.getByTestId("agent-timeline-sync-retry");
      await expect(callout).toBeVisible({ timeout: 30_000 });
      await expect(retry).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath("1-sync-error.png"), fullPage: true });

      gate.holdTimelineResponses(agent.agentId);
      await retry.click();
      await gate.waitForHeldTimelineResponse();
      await expect(retry).toBeDisabled();
      await expect(retry).toHaveText("Retrying…");
      await page.screenshot({ path: testInfo.outputPath("2-retry-pending.png"), fullPage: true });

      gate.releaseHeldTimelineResponses();
      await expect(retry).toBeEnabled({ timeout: 30_000 });
      await expect(callout).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("3-retry-failed.png"), fullPage: true });

      gate.allowTimelineResponses();
      await retry.click();
      await expect(callout).toBeHidden({ timeout: 30_000 });
      await expectTimelinePromptVisible(page, agent.newestPrompt);
      await page.screenshot({ path: testInfo.outputPath("4-recovered.png"), fullPage: true });
    } finally {
      gate.restore();
      await agent.cleanup();
    }
  });

  test("the sync error callout can be dismissed", async ({ page }) => {
    test.setTimeout(120_000);
    const gate = await installDaemonWebSocketGate(page);
    const agent = await seedLongMockAgentTimeline({ turns: 2 });
    try {
      await openAgentTimeline(page, agent);
      await expectTimelinePromptVisible(page, agent.newestPrompt);

      gate.failTimelineResponses(agent.agentId);
      await disconnectViewedTimeline(page, gate);
      await restoreViewedTimelineWithHeldResponse(page, gate);

      const callout = page.getByTestId("agent-timeline-sync-error");
      await expect(callout).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("agent-timeline-sync-dismiss").click();
      await expect(callout).toBeHidden();
      await expectTimelinePromptVisible(page, agent.newestPrompt);
    } finally {
      gate.restore();
      await agent.cleanup();
    }
  });

  test("a refused first load offers a retry instead of a dead panel", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const gate = await installDaemonWebSocketGate(page);
    const agent = await seedLongMockAgentTimeline({ turns: 2 });
    try {
      gate.failTimelineResponses(agent.agentId);
      await openAgentTimeline(page, agent);

      const loadError = page.getByTestId("agent-load-error");
      const retry = page.getByTestId("agent-load-error-retry");
      await expect(loadError).toBeVisible({ timeout: 60_000 });
      await expect(loadError).toContainText("already has an active writer");
      await page.screenshot({ path: testInfo.outputPath("5-load-error.png"), fullPage: true });

      await retry.click();
      await expect(loadError).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: testInfo.outputPath("6-load-retry-failed.png") });

      gate.allowTimelineResponses();
      await retry.click();
      await expect(loadError).toBeHidden({ timeout: 30_000 });
      await expectTimelinePromptVisible(page, agent.newestPrompt);
      await page.screenshot({ path: testInfo.outputPath("7-load-recovered.png"), fullPage: true });
    } finally {
      gate.restore();
      await agent.cleanup();
    }
  });

  test("a missing persisted session shows a notice and Start new session with pending, failure, and recovery", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const gate = await installDaemonWebSocketGate(page);
    const agent = await seedLongMockAgentTimeline({ turns: 2 });
    try {
      gate.failTimelineResponses(agent.agentId, {
        error: "Persisted claude session expired-session is no longer available",
        errorCode: "session_not_found",
      });
      await openAgentTimeline(page, agent);

      const notice = page.getByTestId("agent-session-missing");
      const startNew = page.getByTestId("agent-session-missing-start-new");
      await expect(notice).toBeVisible({ timeout: 60_000 });
      await expect(notice).toContainText("Session history unavailable");
      await expect(startNew).toBeEnabled();
      await expect(startNew).toHaveText("Start new session");
      await expect(page.getByText("Start chatting with this agent...")).toHaveCount(0);
      await expect(page.locator('[data-testid="message-input-root"]:visible')).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath("8-session-missing.png"),
        fullPage: true,
      });

      // Hold the archive RPC to verify pending state, then reject it to verify failure recovery.
      gate.holdNextClientRequest("archive_agent_request");
      await startNew.click();
      await gate.waitForHeldClientRequest();
      await expect(startNew).toBeDisabled();
      await expect(startNew).toHaveText("Starting...");
      await page.screenshot({
        path: testInfo.outputPath("9-session-missing-starting.png"),
        fullPage: true,
      });

      gate.rejectHeldClientRequest("Archive failed on daemon");
      const errorText = page.getByTestId("agent-session-missing-error");
      await expect(errorText).toBeVisible({ timeout: 30_000 });
      await expect(errorText).toContainText("Archive failed on daemon");
      await expect(startNew).toBeEnabled();
      await expect(startNew).toHaveText("Start new session");
      await page.screenshot({
        path: testInfo.outputPath("10-session-missing-start-failed.png"),
        fullPage: true,
      });

      // Retry without interception: archives the dead agent and replaces the tab with a working draft.
      await startNew.click();
      await expect(notice).toBeHidden({ timeout: 30_000 });
      await expect(page.locator('[data-testid="message-input-root"]:visible')).toBeVisible({
        timeout: 30_000,
      });
      await page.screenshot({
        path: testInfo.outputPath("11-session-missing-draft-ready.png"),
        fullPage: true,
      });
    } finally {
      gate.restore();
      await agent.cleanup();
    }
  });
});
