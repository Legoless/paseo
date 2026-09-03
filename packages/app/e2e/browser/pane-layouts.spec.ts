import { test, expect } from "../support/fixtures";
import { gotoWorkspace, openNewTabMenuWithShortcut } from "../support/helpers/launcher";
import { expectComposerVisible } from "../support/helpers/composer";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

let workspace: SeededWorkspace;

test.beforeAll(async () => {
  workspace = await seedWorkspace({ repoPrefix: "pane-layouts-e2e-" });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

/** Opens the workspace header menu, which carries the shared workspace actions. */
async function openWorkspaceMenu(page: import("@playwright/test").Page): Promise<void> {
  const trigger = page
    .getByTestId("workspace-header-menu-trigger")
    .filter({ visible: true })
    .first();
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  await expect(page.getByTestId("workspace-header-menu").filter({ visible: true })).toBeVisible();
}

test.describe("Pane layouts", () => {
  test("the workspace menu opens a Pane layout page listing every built-in", async ({ page }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openWorkspaceMenu(page);

    const trigger = page
      .locator('[data-testid^="sidebar-workspace-menu-pane-layout-"]')
      .filter({ visible: true })
      .first();
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click();

    for (const id of [
      "single",
      "two-columns",
      "two-rows",
      "grid-2x2",
      "grid-2x5",
      "grid-2x7",
      "grid-3x7",
    ]) {
      await expect(page.getByTestId(`pane-layout-${id}`).filter({ visible: true })).toBeVisible();
    }

    // The grids name their own dimensions rather than sharing one "Grid" label.
    await expect(page.getByTestId("pane-layout-grid-3x7").filter({ visible: true })).toContainText(
      "3 × 7",
    );

    // The "add layouts in the host's layouts folder" hint is gone.
    await expect(page.getByTestId("pane-layout-empty")).toHaveCount(0);
  });

  test("applying Two columns splits the workspace into two panes", async ({ page }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    const panes = page.locator('[data-testid^="workspace-pane-"]').filter({ visible: true });
    const before = await panes.count();

    await openWorkspaceMenu(page);
    await page
      .locator('[data-testid^="sidebar-workspace-menu-pane-layout-"]')
      .filter({ visible: true })
      .first()
      .click();
    await page.getByTestId("pane-layout-two-columns").filter({ visible: true }).click();

    await expect(panes).toHaveCount(before + 1, { timeout: 10_000 });
  });
});

test.describe("A pane with no project claims none", () => {
  test("a new agent draft shows no branch and no git controls", async ({ page }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    // A seeded workspace opens on a New Agent draft that has not chosen a project yet.
    await expectComposerVisible(page);

    // It must not borrow the workspace's project, so neither the branch nor the project
    // actions that configure it are drawn.
    await expect(page.getByTestId("pane-branch-badge").filter({ visible: true })).toHaveCount(0);
    await expect(
      page.getByTestId("pane-project-commands-toggle").filter({ visible: true }),
    ).toHaveCount(0);
  });

  test("the launcher offers a project selector that starts on Home", async ({ page }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openNewTabMenuWithShortcut(page);

    const label = page
      .getByTestId("workspace-new-tab-project-selector-label")
      .filter({ visible: true })
      .first();
    await expect(label).toBeVisible({ timeout: 30_000 });
    await expect(label).toHaveText("Home");

    // A launcher pane has no project either, so it shows no branch.
    await expect(page.getByTestId("pane-branch-badge").filter({ visible: true })).toHaveCount(0);

    // The trigger names the real home path, which proves server_info.homeDirectory reached the
    // app rather than the label merely defaulting to "Home".
    const trigger = page
      .getByTestId("workspace-new-tab-project-selector-trigger")
      .filter({ visible: true })
      .first();
    await expect(trigger).toContainText("~");

    await trigger.click();
    const home = page
      .getByTestId("workspace-new-tab-project-selector-home")
      .filter({ visible: true });
    await expect(home).toBeVisible({ timeout: 10_000 });
    await expect(home).toContainText("~");
  });
});
