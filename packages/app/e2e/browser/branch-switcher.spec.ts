import { expect, test, type Page } from "../support/fixtures";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { gotoAppShell } from "../support/helpers/app";
import {
  expectNoBranchSwitcherInWorkspaceHeader,
  expectWorkspaceBranch,
  openChangesPanel,
  switchBranchFromChangesPanel,
} from "../support/helpers/branch-switcher";
import { seedWorkspace, type SeedDaemonClient } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { createTempDirectory, readWorktreeBranchInfo } from "../support/helpers/workspace";
import { clickNewTerminal, gotoWorkspace } from "../support/helpers/launcher";
import { selectWorkspaceTab } from "../support/helpers/workspace-tabs";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

async function renameWorkspaceViaSidebar(
  page: Page,
  input: { workspaceId: string; title: string },
): Promise<void> {
  const serverId = getServerId();
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${input.workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();

  const kebab = page.getByTestId(`sidebar-workspace-kebab-${serverId}:${input.workspaceId}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  const renameItem = page.getByTestId(
    `sidebar-workspace-menu-rename-${serverId}:${input.workspaceId}`,
  );
  await expect(renameItem).toBeVisible({ timeout: 10_000 });
  await renameItem.click();

  const modalPrefix = `sidebar-workspace-rename-modal-${serverId}:${input.workspaceId}`;
  const renameInput = page.getByTestId(`${modalPrefix}-input`);
  await expect(renameInput).toBeVisible({ timeout: 10_000 });
  await renameInput.fill(input.title);
  await page.getByTestId(`${modalPrefix}-submit`).click();
  await expect(renameInput).toHaveCount(0, { timeout: 15_000 });
}

function terminalCwds(terminals: Array<{ cwd: string }>): string[] {
  return terminals.map((terminal) => terminal.cwd);
}

async function reportTerminalDirectory(
  client: SeedDaemonClient,
  input: { workspaceId: string; terminalId: string; cwd: string },
): Promise<void> {
  await client.subscribeTerminal(input.terminalId);
  // Report the actual shell directory on every test host, including shells without OSC7 hooks.
  client.sendTerminalInput(input.terminalId, {
    type: "input",
    data: "node -e \"process.stdout.write(String.fromCharCode(27)+']7;file://localhost'+require('node:url').pathToFileURL(process.cwd()).pathname+String.fromCharCode(7)+String.fromCharCode(27)+']633;D;0'+String.fromCharCode(7))\"\n",
  });
  await expect
    .poll(
      async () =>
        (await client.listTerminals(undefined, undefined, { workspaceId: input.workspaceId }))
          .terminals,
    )
    .toMatchObject([{ id: input.terminalId, shellCwd: input.cwd }]);
}

test.describe("Branch switcher", () => {
  // The first test after a spec-file switch can fail while the shared daemon
  // releases stale sessions from the previous spec; one retry stabilizes it.
  test.describe.configure({ retries: 1 });

  test("a custom workspace title stays in the header while the diff panel switches the real branch", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const serverId = getServerId();
    const workspace = await seedWorkspace({
      repoPrefix: "branch-coherence-",
      repo: { branches: ["main", "dev"] },
    });

    try {
      expect(workspace.workspaceName).toBe("main");

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: workspace.workspaceId });

      const customTitle = "Payments Refactor";
      await renameWorkspaceViaSidebar(page, {
        workspaceId: workspace.workspaceId,
        title: customTitle,
      });

      // The header shows the custom title verbatim (a plain static title), never a
      // branch name, and the branch switcher does not live in the header.
      const headerTitle = page
        .getByTestId("workspace-header-title")
        .filter({ visible: true })
        .first();
      await expect(headerTitle).toHaveText(customTitle, { timeout: 30_000 });
      await expectNoBranchSwitcherInWorkspaceHeader(page);

      // The diff panel's switcher tracks the real branch ("main"), not the title,
      // and switching it checks out the real branch on disk.
      await openChangesPanel(page);
      await expectWorkspaceBranch(page, "main");
      await switchBranchFromChangesPanel(page, { from: "main", to: "dev" });
      await expectWorkspaceBranch(page, "dev");

      // The custom title is unaffected by the branch switch.
      await expect(headerTitle).toHaveText(customTitle, { timeout: 30_000 });

      await expect
        .poll(
          async () =>
            (await readWorktreeBranchInfo({ worktreePath: workspace.repoPath })).currentBranch,
          { timeout: 30_000 },
        )
        .toBe("dev");
    } finally {
      await workspace.cleanup();
    }
  });

  test("the pane branch pill switches branches and confirms before moving a terminal into a worktree", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({
      repoPrefix: "pane-branch-worktree-",
      repo: { branches: ["main", "dev", "feature/worktree"] },
    });
    const external = await createTempDirectory("pane-external-worktree-");
    const externalWorktreePath = join(external.path, "checkout");
    try {
      execFileSync("git", ["worktree", "add", externalWorktreePath, "-b", "feature/external"], {
        cwd: workspace.repoPath,
      });
      const created = await workspace.client.createWorkspace({
        source: {
          kind: "worktree",
          cwd: workspace.repoPath,
          projectId: workspace.projectId,
          action: "checkout",
          refName: "feature/worktree",
        },
      });
      expect(created.error).toBeNull();
      expect(created.workspace).not.toBeNull();
      const worktreePath = created.workspace!.workspaceDirectory;

      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewTerminal(page);
      const pill = page.getByTestId("pane-branch-badge").filter({ visible: true }).first();
      await expect(pill).toHaveText("main");
      const initialTerminals = await workspace.client.listTerminals(undefined, undefined, {
        workspaceId: workspace.workspaceId,
      });
      expect(initialTerminals.terminals).toHaveLength(1);
      await reportTerminalDirectory(workspace.client, {
        workspaceId: workspace.workspaceId,
        terminalId: initialTerminals.terminals[0]!.id,
        cwd: workspace.repoPath,
      });
      await pill.click();
      const branchOption = page.getByTestId("pane-branch-option-branch:dev");
      await expect(branchOption).toBeVisible();
      await expect(
        page.getByTestId(`pane-branch-option-worktree:${externalWorktreePath}`),
      ).toContainText("feature/external");
      await branchOption.click();
      await expect(pill).toHaveText("dev");
      await expect
        .poll(
          async () =>
            (await readWorktreeBranchInfo({ worktreePath: workspace.repoPath })).currentBranch,
        )
        .toBe("dev");

      await pill.click();
      const worktreeOption = page.getByTestId(`pane-branch-option-worktree:${worktreePath}`);
      await expect(worktreeOption).toContainText("feature/worktree");
      await worktreeOption.click();
      await page.getByTestId("confirm-dialog-cancel").click();
      await expect(pill).toHaveText("dev");
      const sourceBefore = (await workspace.client.fetchWorkspaces()).entries.find(
        (entry) => entry.id === workspace.workspaceId,
      );
      expect(sourceBefore).toMatchObject({
        members: [{ workspaceDirectory: workspace.repoPath }],
      });
      const before = await workspace.client.listTerminals(undefined, undefined, {
        workspaceId: workspace.workspaceId,
      });
      expect(terminalCwds(before.terminals)).toEqual([workspace.repoPath]);

      await pill.click();
      await worktreeOption.click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(pill).toHaveText("feature/worktree");
      await expect(
        page.getByTestId("pane-project-badge-label").filter({ visible: true }).first(),
      ).toContainText(workspace.projectDisplayName);
      await expect
        .poll(
          async () =>
            (
              await workspace.client.listTerminals(undefined, undefined, {
                workspaceId: workspace.workspaceId,
              })
            ).terminals,
        )
        .toMatchObject([{ cwd: worktreePath }]);
      const sourceAfter = (await workspace.client.fetchWorkspaces()).entries.find(
        (entry) => entry.id === workspace.workspaceId,
      );
      expect(sourceAfter).toMatchObject({
        members: [
          { workspaceDirectory: workspace.repoPath },
          { workspaceDirectory: worktreePath, projectId: workspace.projectId },
        ],
      });
    } finally {
      await workspace.client.archiveWorkspace(workspace.workspaceId);
      await workspace.cleanup();
      await external.cleanup();
    }
  });

  test("a terminal's reported worktree directory updates pane context without recreating the shell", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const workspace = await seedWorkspace({
      repoPrefix: "pane-shell-directory-",
      repo: { branches: ["main"] },
    });
    const external = await createTempDirectory("pane-shell-worktree-");
    const worktreePath = join(external.path, "checkout");
    try {
      execFileSync("git", ["worktree", "add", worktreePath, "-b", "feature/current-worktree"], {
        cwd: workspace.repoPath,
      });
      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewTerminal(page);
      const pill = page.getByTestId("pane-branch-badge").filter({ visible: true }).first();
      await expect(pill).toHaveText("main");
      const surface = page.getByTestId("terminal-surface").filter({ visible: true }).first();
      await expect(surface).toBeVisible();
      const originalSurface = await surface.elementHandle();
      expect(originalSurface).not.toBeNull();
      const before = await workspace.client.listTerminals(undefined, undefined, {
        workspaceId: workspace.workspaceId,
      });
      expect(before.terminals).toHaveLength(1);
      const terminalId = before.terminals[0]!.id;
      await workspace.client.subscribeTerminal(terminalId);
      workspace.client.sendTerminalInput(terminalId, {
        type: "input",
        data: `cd "${worktreePath}"\n`,
      });
      await reportTerminalDirectory(workspace.client, {
        workspaceId: workspace.workspaceId,
        terminalId,
        cwd: worktreePath,
      });
      await expect(pill).toHaveText("feature/current-worktree");
      await expect(
        page.getByTestId("pane-project-badge-label").filter({ visible: true }).first(),
      ).toContainText(workspace.projectDisplayName);
      await expect
        .poll(
          async () =>
            (
              await workspace.client.listTerminals(undefined, undefined, {
                workspaceId: workspace.workspaceId,
              })
            ).terminals,
        )
        .toMatchObject([{ id: terminalId, cwd: workspace.repoPath, shellCwd: worktreePath }]);
      expect(await originalSurface!.evaluate((element) => element.isConnected)).toBe(true);
      const source = (await workspace.client.fetchWorkspaces()).entries.find(
        (entry) => entry.id === workspace.workspaceId,
      );
      expect(source).toMatchObject({ members: [{ workspaceDirectory: workspace.repoPath }] });
    } finally {
      await workspace.client.archiveWorkspace(workspace.workspaceId);
      await workspace.cleanup();
      await external.cleanup();
    }
  });

  test("terminal branch actions wait for the first directory report", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "pane-unreported-shell-",
      repo: { branches: ["main"] },
    });
    try {
      const created = await workspace.client.createTerminal(
        workspace.repoPath,
        "Directory report",
        undefined,
        {
          workspaceId: workspace.workspaceId,
          command: process.execPath,
          args: [
            "-e",
            "process.stdin.setEncoding('utf8'); process.stdin.on('data',()=>process.stdout.write(String.fromCharCode(27)+']7;file://localhost'+require('node:url').pathToFileURL(process.cwd()).pathname+String.fromCharCode(7)+String.fromCharCode(27)+']633;D;0'+String.fromCharCode(7)));",
          ],
        },
      );
      expect(created.error).toBeNull();
      expect(created.terminal).not.toBeNull();
      const terminalId = created.terminal!.id;
      await gotoWorkspace(page, workspace.workspaceId);
      const tab = page
        .getByTestId(`workspace-tab-terminal_${terminalId}`)
        .filter({ visible: true })
        .first();
      await expect(tab).toBeVisible();
      await selectWorkspaceTab(tab);
      const pill = page.getByTestId("pane-branch-badge").filter({ visible: true }).first();
      await expect(pill).toHaveText("main");
      await pill.click();
      await expect(page.getByTestId("pane-branch-picker-unreported-shell")).toBeVisible();
      await expect(page.locator('[data-testid^="pane-branch-option-"]')).toHaveCount(0);
      await page.keyboard.press("Escape");

      await workspace.client.subscribeTerminal(terminalId);
      workspace.client.sendTerminalInput(terminalId, { type: "input", data: "report\n" });
      await expect
        .poll(
          async () =>
            (
              await workspace.client.listTerminals(undefined, undefined, {
                workspaceId: workspace.workspaceId,
              })
            ).terminals,
        )
        .toMatchObject([{ id: terminalId, shellCwd: workspace.repoPath }]);
      await pill.click();
      await expect(page.getByTestId("pane-branch-option-branch:main")).toBeVisible();
      await expect(page.getByTestId("pane-branch-picker-unreported-shell")).toHaveCount(0);
    } finally {
      await workspace.client.archiveWorkspace(workspace.workspaceId);
      await workspace.cleanup();
    }
  });
});
