import { expect, test } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  createAgentTabFromMenu,
  ensureExplorerSidebar,
  openFilesPanel,
  selectWorkspaceTab,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

function explorerSidebar(page: Parameters<typeof ensureExplorerSidebar>[0]) {
  return page.getByTestId("workspace-explorer-sidebar").filter({ visible: true });
}

test.describe("Explorer sidebar", () => {
  test("starts with Files and Changes, switches views, and toggles without changing main", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "explorer-sidebar-defaults-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      const mainPane = page.getByTestId("workspace-pane-main");
      const mainTabsBefore = await mainPane.locator('[data-testid^="workspace-tab-"]').count();
      await expect(mainPane.getByTestId("workspace-explorer-toggle")).toBeVisible();
      await expect(
        mainPane.getByTestId("workspace-tabs-row").getByTestId("workspace-explorer-toggle"),
      ).toHaveCount(0);

      const explorer = await ensureExplorerSidebar(page);
      await expect(mainPane.getByTestId("workspace-explorer-sidebar")).toBeVisible();
      await expect(explorer.getByTestId("workspace-explorer-toggle")).toBeVisible();
      await expect(
        mainPane.getByTestId("pane-project-tray").getByTestId("workspace-explorer-toggle"),
      ).toHaveCount(0);
      await expect(explorer.getByTestId("explorer-sidebar-tab-files")).toBeVisible();
      await expect(explorer.getByTestId("explorer-sidebar-tab-changes_tree")).toBeVisible();
      await expect(explorer.getByTestId("workspace-new-tab-button")).toHaveCount(0);

      await openFilesPanel(page);
      await expect(explorer.getByTestId("file-explorer-tree-scroll")).toBeVisible();

      await explorer.getByTestId("explorer-sidebar-tab-changes_tree").click();
      await expect(explorer.getByTestId("changes-tree-panel")).toBeVisible();

      await explorer.getByTestId("workspace-explorer-toggle").click();
      await expect(explorerSidebar(page)).toHaveCount(0);
      await expect(mainPane.locator('[data-testid^="workspace-tab-"]')).toHaveCount(mainTabsBefore);
    } finally {
      await workspace.cleanup();
    }
  });

  test("Explorer visibility is per-tab, not per-workspace", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "explorer-sidebar-per-tab-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);

      const tabARow = page
        .locator('[data-testid^="workspace-tab-draft_"]')
        .filter({ visible: true })
        .first();
      await expect(tabARow).toBeVisible({ timeout: 30_000 });
      const tabATestId = await tabARow.getAttribute("data-testid");
      if (!tabATestId) throw new Error("Tab A has no data-testid");
      await selectWorkspaceTab(tabARow);
      await ensureExplorerSidebar(page);
      await expect(
        page.getByTestId("workspace-explorer-sidebar").filter({ visible: true }),
      ).toBeVisible();

      await createAgentTabFromMenu(page);
      const tabBRow = page
        .locator(`[data-testid^="workspace-tab-draft_"]:not([data-testid="${tabATestId}"])`)
        .filter({ visible: true })
        .first();
      await expect(tabBRow).toBeVisible({ timeout: 30_000 });
      await selectWorkspaceTab(tabBRow);

      await expect(
        page.getByTestId("workspace-explorer-sidebar").filter({ visible: true }),
      ).toHaveCount(0);

      await selectWorkspaceTab(tabARow);
      await expect(
        page.getByTestId("workspace-explorer-sidebar").filter({ visible: true }),
      ).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
