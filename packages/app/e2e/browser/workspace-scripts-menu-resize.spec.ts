import { test, expect } from "../support/fixtures";
import { createTempGitRepo } from "../support/helpers/workspace";
import {
  closeWorkspaceScriptsMenu,
  connectWorkspaceSetupClient,
  createWorkspaceThroughDaemon,
  openWorkspaceScriptsMenu,
  seedProjectForWorkspaceSetup,
  startWorkspaceScriptFromMenu,
  waitForWorkspaceSetupProgress,
} from "../support/helpers/workspace-setup";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import { getServerId } from "../support/helpers/server-id";
import { openSidebarDisplayPage } from "../support/helpers/sidebar";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";

test("running services resize the Scripts menu without appearing in the sidebar", async ({
  page,
  e2eWorkerClient,
}) => {
  const client = await connectWorkspaceSetupClient();
  const repo = await createTempGitRepo("script-menu-resize-", {
    paseoConfig: {
      worktree: {
        setup: ["sh -c 'echo setup complete'"],
      },
      scripts: {
        web: {
          type: "service",
          command:
            "node -e \"const http = require('http'); const s = http.createServer((q,r) => r.end('ok')); s.listen(process.env.PORT || 3000, () => console.log('listening on ' + s.address().port))\"",
        },
      },
    },
  });
  let workspaceId: string | null = null;

  try {
    await seedProjectForWorkspaceSetup(client, repo.path);
    const completed = waitForWorkspaceSetupProgress(
      client,
      (payload) => payload.status === "completed" && payload.detail.log.includes("setup complete"),
    );
    const workspace = await createWorkspaceThroughDaemon(client, {
      cwd: repo.path,
      worktreeSlug: `script-menu-resize-${Date.now()}`,
    });
    workspaceId = workspace.id;
    await completed;

    await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
    await waitForWorkspaceTabsVisible(page);
    await openWorkspaceScriptsMenu(page);

    const menu = page.getByTestId("workspace-scripts-menu");
    const before = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    });

    await startWorkspaceScriptFromMenu(page, "web");
    await expect(menu).toContainText("localhost:", { timeout: 15_000 });

    const after = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const firstChild = element.firstElementChild;
      const childRect = firstChild?.getBoundingClientRect();
      return {
        height: rect.height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        childHeight: childRect?.height ?? 0,
      };
    });

    expect(after.height).toBeGreaterThan(before.height);
    expect(after.scrollHeight).toBeLessThanOrEqual(after.clientHeight + 1);
    expect(after.childHeight).toBeGreaterThan(before.height);

    await closeWorkspaceScriptsMenu(page);
    const workspaceRow = page
      .getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.id}`)
      .filter({ visible: true });
    await expect(workspaceRow).toBeVisible();
    await expect(workspaceRow.getByText("web", { exact: true })).toHaveCount(0);
    await expect(workspaceRow.getByTestId(/^workspace-service/)).toHaveCount(0);
    await expect(workspaceRow).not.toHaveAccessibleName(/Service web (running|unhealthy)/);

    await openSidebarDisplayPage(page, "sidebar-display-show");
    await expect(page.getByTestId("sidebar-row-item-branch")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Services", exact: true })).toHaveCount(0);
  } finally {
    try {
      if (workspaceId) {
        const archived = await e2eWorkerClient.archiveWorkspace(workspaceId);
        expect(archived.error).toBeNull();
      }
    } finally {
      await client.close();
      await repo.cleanup();
    }
  }
});
