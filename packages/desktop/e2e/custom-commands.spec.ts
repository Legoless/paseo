import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../../app/e2e/support/fixtures";
import { waitForTabBar } from "../../app/e2e/support/helpers/launcher";
import { seedWorkspace } from "../../app/e2e/support/helpers/seed-client";
import { installDesktopRuntime } from "./support/runtime";

test("enables empty commands from the tray, manages commands in settings and runs them", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await installDesktopRuntime(page, { serverId: process.env.E2E_SERVER_ID! });
  const workspace = await seedWorkspace({ repoPrefix: "commands-settings-", title: "Commands QA" });
  const commandsPath = path.join(process.env.E2E_PASEO_HOME!, "commands.json");
  const created = await workspace.client.createTerminal(
    workspace.repoPath,
    "Commands QA",
    undefined,
    { workspaceId: workspace.workspaceId },
  );
  if (!created.terminal) throw new Error(created.error ?? "Terminal creation failed");
  const terminalId = created.terminal.id;
  async function openWorkspace() {
    await page.goto(
      `http://localhost:${process.env.E2E_METRO_PORT}/h/${process.env.E2E_SERVER_ID}/workspace/${workspace.workspaceId}?open=${encodeURIComponent(`terminal:${terminalId}`)}`,
    );
    await waitForTabBar(page);
    await page
      .getByTestId(`workspace-tab-terminal_${terminalId}`)
      .filter({ visible: true })
      .first()
      .click();
  }

  try {
    await openWorkspace();
    const toggle = page
      .getByTestId("pane-project-commands-toggle")
      .filter({ visible: true })
      .first();
    const commands = page
      .getByTestId("workspace-commands-button")
      .filter({ visible: true })
      .first();
    await expect(commands).toBeVisible();
    await toggle.click({ button: "right" });
    const visibility = page
      .getByTestId("pane-project-commands-menu")
      .getByRole("menuitem", { name: "Commands", exact: true });
    await visibility.click();
    await expect(commands).toHaveCount(0);
    await page.keyboard.press("Escape");
    await toggle.click({ button: "right" });
    await visibility.click();
    await page.keyboard.press("Escape");
    await expect(commands).toBeVisible();
    await commands.click();
    await page.getByTestId("workspace-commands-settings").click();
    await expect(page.getByTestId("settings-commands")).toBeVisible();
    await page.getByTestId("command-add").click();
    await expect(page.getByTestId("command-save")).toBeDisabled();
    await page.getByTestId("command-name").fill("Write marker");
    await page.getByTestId("command-text").fill("printf commands-ok > command-result.txt");
    await page.getByTestId("command-target-terminal").click();
    await page.screenshot({ path: testInfo.outputPath("command-editor.png") });
    await page.getByTestId("command-save").click();
    await expect(page.getByTestId("command-editor")).toHaveCount(0);
    const saved = JSON.parse(await readFile(commandsPath, "utf8")).commands[0];
    expect(saved).toMatchObject({ title: "Write marker", target: "terminal", submit: true });
    const row = page.getByTestId(`settings-command-${saved.id}`);
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByTestId("command-name")).toHaveValue("Write marker");
    await page.getByTestId("command-name").fill("Write renamed marker");
    await page.getByTestId("command-save").click();
    await expect(row).toContainText("Write renamed marker");
    await expect(page.getByTestId("command-editor")).toHaveCount(0);
    await page.reload();
    await expect(row).toContainText("Write renamed marker");

    const projectCommandsDirectory = path.join(workspace.repoPath, ".paseo-neo");
    const projectCommandsPath = path.join(projectCommandsDirectory, "commands.json");
    await mkdir(projectCommandsDirectory, { recursive: true });
    await writeFile(
      projectCommandsPath,
      JSON.stringify({
        commands: [
          {
            id: "project-review",
            title: "Review project",
            text: "Review this project",
            submit: false,
          },
        ],
      }),
    );
    await openWorkspace();
    await page.getByTestId("workspace-commands-caret").filter({ visible: true }).first().click();
    await expect(page.getByTestId("workspace-commands-project-group").locator("svg")).toBeVisible();
    await expect(page.getByTestId("workspace-commands-global-group").locator("svg")).toBeVisible();
    await expect(page.getByTestId("workspace-command-project-review")).toContainText(
      "Review project",
    );
    await page.screenshot({ path: testInfo.outputPath("command-scope-icons.png") });
    await page.getByTestId(`workspace-command-${saved.id}`).click();
    await expect
      .poll(() =>
        readFile(path.join(workspace.repoPath, "command-result.txt"), "utf8").catch(() => ""),
      )
      .toBe("commands-ok");

    await page.getByTestId("workspace-commands-caret").filter({ visible: true }).first().click();
    await page.getByTestId("workspace-commands-settings").click();
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByTestId("command-name").fill("Unsaved draft");
    await writeFile(
      commandsPath,
      JSON.stringify({ commands: [{ ...saved, title: "Changed elsewhere" }] }),
    );
    await page.getByTestId("command-save").click();
    await expect(page.getByTestId("command-save-error")).toContainText("Commands changed");
    await expect(page.getByTestId("command-name")).toHaveValue("Unsaved draft");
    await page
      .getByTestId("command-editor")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(row).toContainText("Changed elsewhere");
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(row).toHaveCount(0);
    expect(JSON.parse(await readFile(commandsPath, "utf8")).commands).toEqual([]);
    await rm(projectCommandsPath);
    await openWorkspace();
    await commands.click();
    await expect(page.getByTestId("workspace-commands-settings")).toBeVisible();
  } finally {
    const terminals = await workspace.client.listTerminals(workspace.repoPath, undefined, {
      workspaceId: workspace.workspaceId,
    });
    for (const terminal of terminals.terminals) await workspace.client.killTerminal(terminal.id);
    await workspace.cleanup();
  }
});
