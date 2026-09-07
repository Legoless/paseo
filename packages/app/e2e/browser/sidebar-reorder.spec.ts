import type { Locator } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";

async function rowTestIds(rows: Locator) {
  return rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-testid")),
  );
}

async function visibleBoundingBox(row: Locator) {
  const box = await row.boundingBox();
  if (!box) throw new Error("Expected a visible draggable row");
  return box;
}

async function pressProjectRow(rows: Locator) {
  await rows.page().mouse.down();
}

async function pressWorkspaceRow(rows: Locator) {
  const solidScrimStop = rows
    .nth(0)
    .getByTestId("sidebar-workspace-trailing-scrim")
    .locator("stop")
    .nth(1);
  const hoverScrimColor = await solidScrimStop.getAttribute("stop-color");
  await rows.page().mouse.down();
  await expect.poll(() => solidScrimStop.getAttribute("stop-color")).not.toBe(hoverScrimColor);
}

async function quickDragFirstRowAfterSecond(
  rows: Locator,
  pressRow: (rows: Locator) => Promise<void>,
) {
  await expect(rows).toHaveCount(2);
  const before = await rowTestIds(rows);
  const sourceBox = await visibleBoundingBox(rows.nth(0));
  const targetBox = await visibleBoundingBox(rows.nth(1));

  const page = rows.page();
  const source = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const target = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };

  await page.mouse.move(source.x, source.y);
  const trailingScrim = rows.nth(0).getByTestId("sidebar-workspace-trailing-scrim");
  await pressRow(rows);
  await page.mouse.move(source.x, source.y + 7);
  await expect(trailingScrim).toHaveCount(0);
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.up();

  await expect.poll(() => rowTestIds(rows)).toEqual([before[1], before[0]]);
}

/**
 * Drags one row onto another that lives in a different list. Unlike
 * {@link quickDragFirstRowAfterSecond} the assertion is the caller's: a cross-list drop is a
 * daemon round trip, so what proves it landed is the target's rows, not a swap in place.
 */
async function dragRowOnto(
  source: Locator,
  target: Locator,
  pressRow: (row: Locator) => Promise<void>,
) {
  const sourceBox = await visibleBoundingBox(source);
  const targetBox = await visibleBoundingBox(target);
  const page = source.page();

  const from = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const to = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };

  await page.mouse.move(from.x, from.y);
  await pressRow(source);
  // Clear the 6px activation distance before travelling, so the drag is picked up.
  await page.mouse.move(from.x, from.y + 7);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test("workspaces and pinned chats reorder with an immediate mouse drag", async ({ page }) => {
  const firstProject = await seedWorkspace({ repoPrefix: "sidebar-reorder-first-" });
  const secondProject = await seedWorkspace({ repoPrefix: "sidebar-reorder-second-" });

  try {
    const secondWorkspace = await firstProject.client.createWorkspace({
      source: {
        kind: "directory",
        path: firstProject.repoPath,
        projectId: firstProject.projectId,
      },
      title: "Second workspace",
    });
    if (!secondWorkspace.workspace) {
      throw new Error(secondWorkspace.error ?? "Failed to seed a second workspace");
    }

    await gotoAppShell(page);

    const firstWorkspaceTestId = `sidebar-workspace-row-${getServerId()}:${firstProject.workspaceId}`;
    const secondWorkspaceTestId = `sidebar-workspace-row-${getServerId()}:${secondWorkspace.workspace.id}`;
    await quickDragFirstRowAfterSecond(
      page.locator(
        `[data-testid="${firstWorkspaceTestId}"], [data-testid="${secondWorkspaceTestId}"]`,
      ),
      pressWorkspaceRow,
    );

    await firstProject.client.setWorkspacePinned(firstProject.workspaceId, true);
    await secondProject.client.setWorkspacePinned(secondProject.workspaceId, true);
    const secondProjectWorkspaceTestId = `sidebar-workspace-row-${getServerId()}:${secondProject.workspaceId}`;
    await quickDragFirstRowAfterSecond(
      page.locator(
        `[data-testid="${firstWorkspaceTestId}"], [data-testid="${secondProjectWorkspaceTestId}"]`,
      ),
      pressWorkspaceRow,
    );
  } finally {
    await firstProject.cleanup();
    await secondProject.cleanup();
  }
});

test("agents reorder within one project and persist across reload", async ({ page }) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-agent-reorder-",
    title: "First agent",
  });

  try {
    const secondAgent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.cwd,
      workspaceId: workspace.workspaceId,
      title: "Second agent",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    await gotoAppShell(page);

    const firstTestId = `sidebar-agent-row-${workspace.agentId}`;
    const secondTestId = `sidebar-agent-row-${secondAgent.id}`;
    const rows = page.locator(`[data-testid="${firstTestId}"], [data-testid="${secondTestId}"]`);
    await expect(rows).toHaveCount(2);
    await quickDragFirstRowAfterSecond(rows, pressProjectRow);
    const reordered = await rowTestIds(rows);

    await page.reload();
    await expect(rows).toHaveCount(2);
    await expect.poll(() => rowTestIds(rows)).toEqual(reordered);
  } finally {
    await workspace.cleanup();
  }
});

test("project members reorder within one workspace and persist across reload", async ({ page }) => {
  const firstProject = await seedWorkspace({ repoPrefix: "sidebar-member-reorder-first-" });
  const secondProject = await seedWorkspace({ repoPrefix: "sidebar-member-reorder-second-" });

  try {
    const added = await firstProject.client.addWorkspaceMember(firstProject.workspaceId, {
      kind: "directory",
      path: secondProject.repoPath,
      projectId: secondProject.projectId,
    });
    if (!added.workspace) throw new Error(added.error ?? "Failed to add workspace member");
    await gotoAppShell(page);

    const serverId = getServerId();
    const firstTestId = `sidebar-member-row-${serverId}:${firstProject.workspaceId}#${firstProject.repoPath}`;
    const secondTestId = `sidebar-member-row-${serverId}:${firstProject.workspaceId}#${secondProject.repoPath}`;
    const rows = page.locator(`[data-testid="${firstTestId}"], [data-testid="${secondTestId}"]`);
    await expect(rows).toHaveCount(2);
    await quickDragFirstRowAfterSecond(rows, pressProjectRow);
    const reordered = await rowTestIds(rows);

    await page.reload();
    await expect(rows).toHaveCount(2);
    await expect.poll(() => rowTestIds(rows)).toEqual(reordered);
  } finally {
    await firstProject.cleanup();
    await secondProject.cleanup();
  }
});

test("a project drags from one workspace to another, taking its agent along", async ({ page }) => {
  const project = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-member-move-",
    title: "Moving agent",
  });

  try {
    // A separate repo, so the target workspace does not already hold the dragged project.
    const target = await seedWorkspace({
      repoPrefix: "sidebar-member-move-target-",
      title: "Move target",
    });

    try {
      // The source keeps a second project, so moving the first does not leave it projectless —
      // a projectless workspace files itself under a synthetic project the seed never cleans up.
      const added = await project.client.addWorkspaceMember(project.workspaceId, {
        kind: "directory",
        path: target.repoPath,
        projectId: target.projectId,
      });
      if (!added.workspace) throw new Error(added.error ?? "Failed to add the second member");

      await gotoAppShell(page);
      const serverId = getServerId();
      const memberRow = page.getByTestId(
        `sidebar-member-row-${serverId}:${project.workspaceId}#${project.cwd}`,
      );
      const targetWorkspaceRow = page.getByTestId(
        `sidebar-workspace-row-${serverId}:${target.workspaceId}`,
      );
      await expect(memberRow).toBeVisible();
      await expect(targetWorkspaceRow).toBeVisible();

      // A member row has no trailing scrim, so it presses like the other project rows.
      await dragRowOnto(memberRow, targetWorkspaceRow, pressProjectRow);

      // The membership — and the agent under it — now hangs off the target workspace.
      await expect(
        page.getByTestId(`sidebar-member-row-${serverId}:${target.workspaceId}#${project.cwd}`),
      ).toBeVisible();
      await expect(memberRow).toHaveCount(0);
      await expect(page.getByTestId(`sidebar-agent-row-${project.agentId}`)).toBeVisible();
    } finally {
      await target.cleanup();
    }
  } finally {
    await project.cleanup();
  }
});

test("an agent drags to the same project in another workspace, and stays put elsewhere", async ({
  page,
}) => {
  const project = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-agent-move-",
    title: "Travelling agent",
  });

  try {
    // The same directory mounted in a second workspace is the only shape R3 allows.
    const mirror = await project.client.createWorkspace({
      source: { kind: "directory", path: project.cwd },
      title: "Mirror workspace",
    });
    if (!mirror.workspace) {
      throw new Error(mirror.error ?? "Failed to seed the mirror workspace");
    }
    const stranger = await seedWorkspace({ repoPrefix: "sidebar-agent-move-stranger-" });

    try {
      await gotoAppShell(page);
      const serverId = getServerId();
      const agentRow = page.getByTestId(`sidebar-agent-row-${project.agentId}`);
      const mirrorMemberRow = page.getByTestId(
        `sidebar-member-row-${serverId}:${mirror.workspace.id}#${project.cwd}`,
      );
      const strangerMemberRow = page.getByTestId(
        `sidebar-member-row-${serverId}:${stranger.workspaceId}#${stranger.repoPath}`,
      );
      await expect(agentRow).toBeVisible();
      await expect(mirrorMemberRow).toBeVisible();
      await expect(strangerMemberRow).toBeVisible();

      // A different project refuses the drop: the agent never leaves its own project.
      await dragRowOnto(agentRow, strangerMemberRow, pressProjectRow);
      await expect(
        page.getByTestId(`sidebar-agent-list-${serverId}:${project.workspaceId}#${project.cwd}`),
      ).toContainText("Travelling agent");

      // The same project in the other workspace accepts it.
      await dragRowOnto(agentRow, mirrorMemberRow, pressProjectRow);
      await expect
        .poll(() =>
          page
            .getByTestId(`sidebar-agent-list-${serverId}:${mirror.workspace!.id}#${project.cwd}`)
            .getByTestId(`sidebar-agent-row-${project.agentId}`)
            .count(),
        )
        .toBe(1);
    } finally {
      await stranger.cleanup();
    }
  } finally {
    await project.cleanup();
  }
});
