import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  createAgentTabFromMenu,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

function visibleNewAgentRows(page: Page) {
  return page.locator('[data-testid^="sidebar-new-agent-row-"]').filter({ visible: true });
}

test.describe("workspace pane agent visibility", () => {
  test("shows every unstarted agent in the sidebar as soon as its tab is created", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pane-agent-visibility-" });

    try {
      await workspace.client.setWorkspaceLabel({
        workspaceId: workspace.workspaceId,
        label: { name: "Draft", color: "red" },
        assigned: true,
      });
      await workspace.client.setWorkspaceLabel({
        workspaceId: workspace.workspaceId,
        label: { name: "Draft", color: "red" },
        assigned: false,
      });
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      await expect(visibleNewAgentRows(page)).toHaveCount(1);

      await createAgentTabFromMenu(page);
      await createAgentTabFromMenu(page);

      await expect(visibleNewAgentRows(page)).toHaveCount(3);
      await expect(visibleNewAgentRows(page)).toHaveText(["New Agent", "New Agent", "New Agent"]);

      const newAgentRow = visibleNewAgentRows(page).first();
      await newAgentRow.hover();
      const hoverCard = page.getByTestId("agent-hover-card").filter({ visible: true });
      await expect(hoverCard).toBeVisible();
      await expect(hoverCard.getByTestId("hover-card-agent-name")).toHaveText("New Agent");

      await page.mouse.move(800, 500);
      await expect(hoverCard).toBeHidden();
      await newAgentRow.click({ button: "right" });

      const contextMenu = page
        .locator('[data-menu-surface="true"][data-testid^="sidebar-new-agent-context-menu-"]')
        .filter({ visible: true });
      await expect(contextMenu).toBeVisible();
      await expect(contextMenu.locator('[data-testid^="sidebar-agent-menu-open-"]')).toBeVisible();
      await expect(
        contextMenu.locator('[data-testid^="sidebar-agent-menu-copy-path-"]'),
      ).toBeVisible();
      const labelsItem = contextMenu.locator('[data-testid^="sidebar-agent-menu-labels-"]');
      await expect(labelsItem).toBeVisible();
      await expect(
        contextMenu.locator('[data-testid^="sidebar-agent-menu-archive-"]'),
      ).toBeVisible();
      await expect(contextMenu.locator('[data-testid^="sidebar-agent-menu-close-"]')).toBeVisible();

      await labelsItem.click();
      const labelRow = page
        .getByTestId("workspace-label-picker-row-Draft")
        .filter({ visible: true });
      await expect(labelRow).toBeVisible();
      await labelRow.click();
      await expect(labelRow).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(contextMenu).toBeHidden();

      await expect(newAgentRow.getByTestId("workspace-label-chip-Draft")).toBeVisible();
      const titleBox = await newAgentRow
        .locator('[data-testid^="sidebar-new-agent-title-"]')
        .boundingBox();
      const labelsBox = await newAgentRow
        .locator('[data-testid^="sidebar-new-agent-labels-"]')
        .boundingBox();
      if (!titleBox || !labelsBox) throw new Error("expected labelled agent row geometry");
      expect(labelsBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
      await newAgentRow.hover();
      await expect(hoverCard.getByTestId("workspace-label-chip-Draft")).toBeVisible();

      await page.mouse.move(800, 500);
      await newAgentRow.click({ button: "right" });
      await contextMenu.locator('[data-testid^="sidebar-agent-menu-close-"]').click();
      await expect(visibleNewAgentRows(page)).toHaveCount(2);
    } finally {
      await workspace.cleanup();
    }
  });
});
