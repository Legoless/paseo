import path from "node:path";
import { test, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  closeMobileAgentSidebar,
  expectMobileAgentSidebarHidden,
  expectMobileAgentSidebarVisible,
  openMobileAgentSidebar,
  pinWorkspaceFromSidebar,
} from "../support/helpers/sidebar";
import { seedWorkspace } from "../support/helpers/seed-client";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expectWorkspaceHeader } from "../support/helpers/workspace-ui";
import { getServerId } from "../support/helpers/server-id";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { escapeRegex } from "../support/helpers/regex";
import { openFilesPanel } from "../support/helpers/workspace-tabs";

const GITHUB_REMOTE_URL = "https://github.com/test-owner/test-repo.git";

function getWorkspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

async function openWorkspaceFromSidebar(
  page: import("@playwright/test").Page,
  workspaceId: string,
) {
  const row = page.getByTestId(getWorkspaceRowTestId(workspaceId));
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
  return row;
}

async function waitForSidebarProject(page: import("@playwright/test").Page, projectName: string) {
  const row = page
    .getByRole("button", {
      name: new RegExp(escapeRegex(projectName), "i"),
    })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function waitForSidebarWorkspace(page: import("@playwright/test").Page, workspaceId: string) {
  const row = page.getByTestId(getWorkspaceRowTestId(workspaceId));
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function openWorkspaceHoverCard(page: import("@playwright/test").Page, workspaceId: string) {
  const row = await waitForSidebarWorkspace(page, workspaceId);
  await row.hover();

  const hoverCard = page.getByTestId("workspace-hover-card");
  await expect(hoverCard).toBeVisible({ timeout: 30_000 });
  return hoverCard;
}

async function openAgentHoverCard(page: import("@playwright/test").Page, agentId: string) {
  const row = page.getByTestId(`sidebar-agent-row-${agentId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  const title = await row.getAttribute("aria-label");
  if (!title) throw new Error(`Agent row ${agentId} has no accessible label`);
  await row.hover();

  const hoverCard = page.getByRole("menu", { name: title, exact: true });
  await expect(hoverCard).toBeVisible({ timeout: 30_000 });
  return hoverCard;
}

interface PaseoOwnedWorktree {
  agentId: string;
  worktreeSlug: string;
}

async function withPaseoOwnedWorktree(
  run: (workspace: PaseoOwnedWorktree) => Promise<void>,
): Promise<void> {
  const project = await seedWorkspace({ repoPrefix: "sidebar-hover-owned-worktree-" });
  const worktreeSlug = "hover-card-owned-worktree";

  try {
    const created = await project.client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: project.repoPath,
        projectId: project.projectId,
        worktreeSlug,
      },
    });
    if (!created.workspace) {
      throw new Error(created.error ?? "Failed to create Paseo-owned worktree");
    }
    expect(path.basename(created.workspace.workspaceDirectory)).toBe(worktreeSlug);
    const agent = await project.client.createAgent({
      provider: "mock",
      cwd: created.workspace.workspaceDirectory,
      workspaceId: created.workspace.id,
      title: "Worktree hover agent",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });

    await run({
      agentId: agent.id,
      worktreeSlug,
    });
  } finally {
    await project.cleanup();
  }
}

test.describe("Sidebar workspace list", () => {
  test("project with GitHub remote shows its selected folder name in sidebar", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-remote-",
      repo: { withRemote: true, originUrl: GITHUB_REMOTE_URL },
    });

    try {
      const projectName = path.basename(workspace.repoPath);
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await waitForSidebarWorkspace(page, workspace.workspaceId);

      const projectRow = page
        .locator('[data-testid^="sidebar-project-row-"]')
        .filter({ hasText: projectName })
        .first();

      await expect(projectRow).toBeVisible({ timeout: 30_000 });
      await expect(projectRow).not.toContainText("test-owner/test-repo");
    } finally {
      await workspace.cleanup();
    }
  });

  test("non-git project shows directory name", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-directory-", git: false });

    try {
      await gotoAppShell(page);

      const directoryName = path.basename(workspace.repoPath);
      const projectRow = await waitForSidebarProject(page, directoryName);
      await expect(projectRow).toContainText(directoryName);
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace header uses the selected folder name instead of its GitHub remote", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-header-",
      repo: { withRemote: true, originUrl: GITHUB_REMOTE_URL },
    });

    try {
      const projectName = path.basename(workspace.repoPath);
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await waitForSidebarWorkspace(page, workspace.workspaceId);
      await openWorkspaceFromSidebar(page, workspace.workspaceId);

      await expectWorkspaceHeader(page, {
        title: workspace.workspaceName,
        subtitle: projectName,
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("git project shows branch name in workspace row", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-branch-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));

      expect(workspace.workspaceName).toBe("main");
      await expect(await waitForSidebarWorkspace(page, workspace.workspaceId)).toContainText(
        "main",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace hover card counts only agent tabs and projects", async ({ page }) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-hover-counts-",
      title: "First counted agent",
    });

    try {
      const secondAgent = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.cwd,
        workspaceId: workspace.workspaceId,
        title: "Second counted agent",
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      await gotoAppShell(page);
      await page.getByTestId(`sidebar-agent-row-${workspace.agentId}`).click();
      await page.getByTestId(`sidebar-agent-row-${secondAgent.id}`).click();
      await openFilesPanel(page);

      const hoverCard = await openWorkspaceHoverCard(page, workspace.workspaceId);
      await expect(page.getByTestId("hover-card-workspace-tabs")).toHaveText("Open tabs: 2");
      await expect(page.getByTestId("hover-card-workspace-projects")).toHaveText("Projects: 1");
      await expect(hoverCard).not.toContainText("localhost");
    } finally {
      await workspace.cleanup();
    }
  });

  test("agent hover card shows host as metadata", async ({ page }) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-agent-hover-host-",
      title: "Hover agent",
    });

    try {
      const secondAgent = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.cwd,
        workspaceId: workspace.workspaceId,
        title: "Second hover agent",
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      await gotoAppShell(page);
      const firstHoverCard = await openAgentHoverCard(page, workspace.agentId);
      await expect(firstHoverCard.getByTestId("hover-card-agent-name")).toHaveText("Hover agent");

      const hoverCard = await openAgentHoverCard(page, secondAgent.id);
      await expect(hoverCard.getByTestId("hover-card-agent-name")).toHaveText("Second hover agent");
      await expect(hoverCard.getByTestId("hover-card-agent-host")).toHaveText("localhost");
      await expect(hoverCard).not.toContainText(/\b(Online|Connecting|Offline|Error|Idle)\b/);

      const memberRow = page.locator('[data-testid^="sidebar-member-row-"]').first();
      const memberKebab = page.locator('[data-testid^="sidebar-member-kebab-"]').first();
      await page.mouse.move(800, 500);
      await memberRow.focus();
      await expect(memberKebab).toBeVisible();
      await memberRow.hover();
      await expect(memberKebab).toBeVisible();
      const memberRowBox = await memberRow.boundingBox();
      const memberKebabBox = await memberKebab.boundingBox();
      expect(memberRowBox).not.toBeNull();
      expect(memberKebabBox).not.toBeNull();
      expect(
        Math.abs(memberRowBox!.x + memberRowBox!.width - memberKebabBox!.x - memberKebabBox!.width),
      ).toBeLessThanOrEqual(12);

      const agentRow = page.getByTestId(`sidebar-agent-row-${secondAgent.id}`);
      const agentKebab = page.getByTestId(`sidebar-agent-kebab-${secondAgent.id}`);
      await page.mouse.move(800, 500);
      await agentRow.focus();
      await expect(agentKebab).toBeVisible();
      await agentRow.hover();
      await expect(agentKebab).toBeVisible();
      const agentRowBox = await agentRow.boundingBox();
      const agentKebabBox = await agentKebab.boundingBox();
      expect(agentRowBox).not.toBeNull();
      expect(agentKebabBox).not.toBeNull();
      expect(
        Math.abs(agentRowBox!.x + agentRowBox!.width - agentKebabBox!.x - agentKebabBox!.width),
      ).toBeLessThanOrEqual(12);

      await agentKebab.click();
      await expect(page.getByTestId(`sidebar-agent-dropdown-${secondAgent.id}`)).toBeVisible();
      await expect(page.getByTestId(`sidebar-agent-menu-open-${secondAgent.id}`)).toBeVisible();
      await expect(
        page.getByTestId(`sidebar-agent-menu-copy-path-${secondAgent.id}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`sidebar-agent-menu-copy-branch-${secondAgent.id}`),
      ).toBeVisible();
      await expect(page.getByTestId(`sidebar-agent-menu-archive-${secondAgent.id}`)).toBeVisible();
      await expect(page.getByTestId("agent-hover-card")).toHaveCount(0);
      await page.keyboard.press("Escape");

      await agentRow.click({ button: "right" });
      await expect(page.getByTestId(`sidebar-agent-context-menu-${secondAgent.id}`)).toBeVisible();
      await expect(page.getByTestId("agent-hover-card")).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });

  test("Paseo-owned worktree agent hover card shows the agent directory name", async ({ page }) => {
    await withPaseoOwnedWorktree(async ({ agentId, worktreeSlug }) => {
      await gotoAppShell(page);
      await openAgentHoverCard(page, agentId);

      await expect(page.getByTestId("hover-card-agent-cwd")).toHaveText(worktreeSlug);
    });
  });
});

test.describe("Mobile sidebar panelState transition", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("showMobileAgent open and close transition", async ({ page }) => {
    await gotoAppShell(page);
    await expectMobileAgentSidebarHidden(page);
    await openMobileAgentSidebar(page);
    await expectMobileAgentSidebarVisible(page);
    await closeMobileAgentSidebar(page);
    await expectMobileAgentSidebarHidden(page);
  });

  test("keeps a pinned workspace rendered while the retained sidebar is closed", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-retained-pin-" });

    try {
      await gotoAppShell(page);
      await openMobileAgentSidebar(page);
      await expectMobileAgentSidebarVisible(page);

      const row = page.getByTestId(getWorkspaceRowTestId(workspace.workspaceId));
      await expect(row).toBeVisible({ timeout: 30_000 });
      await pinWorkspaceFromSidebar(page, workspace.workspaceId);
      await expect(page.getByTestId("sidebar-pinned-section")).toBeVisible();

      await closeMobileAgentSidebar(page);
      await expectMobileAgentSidebarHidden(page);

      await expect(row).toHaveCount(1);
    } finally {
      await workspace.cleanup();
    }
  });
});

test.describe("Half-screen desktop layout", () => {
  test.use({ viewport: { width: 751, height: 982 } });

  test("keeps the sidebar scroll position across close and reopen", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-retained-scroll-" });

    try {
      let lastWorkspaceId = workspace.workspaceId;
      for (let index = 0; index < 24; index += 1) {
        const created = await workspace.client.createWorkspace({
          source: {
            kind: "directory",
            path: workspace.repoPath,
            projectId: workspace.projectId,
          },
          title: `Retained sidebar ${index + 1}`,
        });
        if (!created.workspace) {
          throw new Error(created.error ?? "Failed to fill the retained sidebar");
        }
        lastWorkspaceId = created.workspace.id;
      }

      await gotoAppShell(page);
      await page
        .getByTestId(`sidebar-project-show-more-${projectEquivalenceViewKey(workspace.projectKey)}`)
        .click();
      await waitForSidebarWorkspace(page, lastWorkspaceId);

      const sidebarScroll = page.getByTestId("sidebar-project-workspace-list-scroll");
      const scrollTop = await sidebarScroll.evaluate((element) => {
        element.scrollTop = 160;
        return element.scrollTop;
      });
      expect(scrollTop).toBe(160);

      await page.getByTestId("menu-button").click();
      await expect(page.getByTestId("sidebar-global-new-workspace")).not.toBeVisible();

      await page.getByTestId("menu-button").click();
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
      await expect(sidebarScroll).toHaveJSProperty("scrollTop", scrollTop);
    } finally {
      await workspace.cleanup();
    }
  });

  test("keeps the pinned sidebar at half of a 14-inch Mac display", async ({ page }) => {
    await gotoAppShell(page);
    await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
    await expect(page.getByTestId("agent-list-backdrop")).not.toBeVisible();
  });

  test("keeps the left toggle center-owned without left window controls", async ({ page }) => {
    await gotoAppShell(page);

    const openToggle = page.getByTestId("menu-button");
    const openIcon = openToggle.locator("svg").first();
    await expect(openIcon).toBeVisible();
    const openBounds = await openIcon.boundingBox();
    expect(openBounds).not.toBeNull();
    expect(openBounds?.x).toBeGreaterThan(12);

    await openToggle.click();
    await expect(page.getByTestId("sidebar-global-new-workspace")).not.toBeVisible();

    const closedToggle = page.getByTestId("menu-button");
    const closedIcon = closedToggle.locator("svg").first();
    await expect(closedIcon).toBeVisible();
    const closedBounds = await closedIcon.boundingBox();
    expect(closedBounds).not.toBeNull();
    expect(closedBounds?.x).toBeCloseTo(9, 0);
    expect(closedBounds?.y).toBe(openBounds?.y);
  });

  test("yields app navigation to the settings split", async ({ page }) => {
    await gotoAppShell(page);
    await page.getByTestId("sidebar-settings").click();

    await expect(page.getByTestId("settings-sidebar")).toBeVisible();
    await expect(page.getByTestId("settings-detail-pane")).toBeVisible();
    await expect(page.getByTestId("sidebar-settings")).not.toBeVisible();
  });

  test("keeps app navigation beside the Explorer pane", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-half-screen-explorer-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));
      await openWorkspaceFromSidebar(page, workspace.workspaceId);

      await openFilesPanel(page);
      const explorerToggle = page.getByTestId("workspace-explorer-toggle").first();
      await expect(
        page.getByTestId("explorer-sidebar-tab-files").filter({ visible: true }),
      ).toBeVisible();
      await expect(explorerToggle).toHaveAccessibleName("Close Explorer sidebar");
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
      await expect(page.getByTestId("explorer-sidebar-tab-rail")).toBeVisible();
      await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(1);

      await explorerToggle.click();
      await expect(
        page.getByTestId("explorer-sidebar-tab-files").filter({ visible: true }),
      ).toHaveCount(0);
      await expect(explorerToggle).toHaveAccessibleName("Open Explorer sidebar");
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
