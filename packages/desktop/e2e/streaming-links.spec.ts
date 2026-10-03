import { test, expect } from "../../app/e2e/support/fixtures";
import { withStreamingMarkdown } from "../../app/e2e/support/helpers/streaming-markdown";
import { openAgentRoute } from "../../app/e2e/support/helpers/mock-agent";
import { seedWorkspace } from "../../app/e2e/support/helpers/seed-client";
import { installDesktopRuntime } from "./support/runtime";

test("only complete streamed paths and URLs become clickable", async ({ page }, testInfo) => {
  await installDesktopRuntime(page, { serverId: process.env.E2E_SERVER_ID! });
  const file = "/tmp/abcdef/report.html";
  const inlineUrl = "https://example.com/inline";
  const bareUrl = "https://example.com/bare";
  const response = `File \`${file}\` then code \`${inlineUrl}\` then bare ${bareUrl}`;
  await withStreamingMarkdown(
    page,
    testInfo,
    async (agent) => {
      await agent.client.sendAgentMessage(agent.agentId, "Show the links.");
      await agent.client.waitForFinish(agent.agentId, 30_000);
      const message = page.getByTestId("assistant-message").last();
      await agent.stream.showThrough("File `/tmp/abcdef");
      await expect(message).toContainText("/tmp/abcdef");
      await expect(message.locator("a")).toHaveCount(0);

      const filePrefix = `File \`${file}\``;
      await agent.stream.showThrough(filePrefix);
      await expect(
        message.getByRole("link", { name: file, exact: true }).and(message.locator("a")),
      ).toHaveAttribute("href", file);
      await agent.stream.showThrough(`${filePrefix} then code \`https://example`);
      await expect(message).toContainText("https://example");
      await expect(message.locator("a")).toHaveCount(1);

      const inlinePrefix = `${filePrefix} then code \`${inlineUrl}\``;
      await agent.stream.showThrough(inlinePrefix);
      await expect(
        message.getByRole("link", { name: inlineUrl, exact: true }).and(message.locator("a")),
      ).toHaveAttribute("href", inlineUrl);
      await agent.stream.showThrough(`${inlinePrefix} then bare https://example.com/`);
      await expect(message).toContainText("bare https://example.com/");
      await expect(message.locator("a")).toHaveCount(2);
      await agent.stream.showThrough(response);
      await expect(message).toContainText(`bare ${bareUrl}`);
      await expect(message.locator("a")).toHaveCount(2);
      agent.stream.release();
      await expect(
        message.getByRole("link", { name: bareUrl, exact: true }).and(message.locator("a")),
      ).toHaveAttribute("href", bareUrl);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        message.getByRole("link", { name: file, exact: true }).and(message.locator("a")),
      ).toHaveAttribute("href", file);
      await expect(
        message.getByRole("link", { name: inlineUrl, exact: true }).and(message.locator("a")),
      ).toHaveAttribute("href", inlineUrl);
      await expect(
        message.getByRole("link", { name: bareUrl, exact: true }).and(message.locator("a")),
      ).toHaveAttribute("href", bareUrl);
    },
    response,
  );
});

test("chat file links keep their originating project in a multi-project workspace", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await installDesktopRuntime(page, { serverId: process.env.E2E_SERVER_ID! });
  const relativePath = "source/report.md";
  const primary = await seedWorkspace({
    repoPrefix: "chat-links-primary-",
    repo: { files: [{ path: relativePath, content: "# Primary report\n" }] },
  });
  const secondary = await seedWorkspace({
    repoPrefix: "chat-links-secondary-",
    repo: { files: [{ path: relativePath, content: "# Secondary report\n" }] },
  });
  try {
    const member = await primary.client.addWorkspaceMember(primary.workspaceId, {
      kind: "directory",
      path: secondary.repoPath,
      projectId: secondary.projectId,
    });
    if (!member.workspace) throw new Error(member.error ?? "Failed to add secondary project");
    const secondaryPath = `${secondary.repoPath}/${relativePath}`;
    const secondaryAgent = await primary.client.createAgent({
      provider: "mock",
      cwd: secondary.repoPath,
      workspaceId: primary.workspaceId,
      title: "Secondary links",
      modeId: "load-test",
      model: "e2e-fast-stream",
      initialPrompt: "Show the report.",
      featureValues: {
        mockAssistantResponse: `[Absolute report](${secondaryPath}) and \`${relativePath}\`.`,
      },
    });
    await primary.client.waitForFinish(secondaryAgent.id, 30_000);
    await openAgentRoute(page, { workspaceId: primary.workspaceId, agentId: secondaryAgent.id });
    const message = page.getByTestId("assistant-message").filter({ visible: true }).last();
    const filePane = page.getByTestId("workspace-file-pane").filter({ visible: true });
    await message
      .getByRole("link", { name: "Absolute report", exact: true })
      .and(message.locator("a"))
      .click();
    await expect(filePane.getByText("Secondary report", { exact: true })).toBeVisible();
    await expect(
      page.getByTestId(`workspace-tab-file_${secondaryPath}`).filter({ visible: true }),
    ).toHaveCount(1);

    await page
      .getByTestId(`workspace-tab-agent_${secondaryAgent.id}`)
      .filter({ visible: true })
      .click();
    await message
      .getByRole("link", { name: relativePath, exact: true })
      .and(message.locator("a"))
      .click();
    await expect(filePane.getByText("Secondary report", { exact: true })).toBeVisible();
    await expect(
      page.getByTestId(`workspace-tab-file_${secondaryPath}`).filter({ visible: true }),
    ).toHaveCount(1);

    const primaryAgent = await primary.client.createAgent({
      provider: "mock",
      cwd: primary.repoPath,
      workspaceId: primary.workspaceId,
      title: "Primary links",
      modeId: "load-test",
      model: "e2e-fast-stream",
      initialPrompt: "Show the report.",
      featureValues: { mockAssistantResponse: `\`${relativePath}\`` },
    });
    await primary.client.waitForFinish(primaryAgent.id, 30_000);
    await page
      .getByTestId(`workspace-tab-agent_${primaryAgent.id}`)
      .filter({ visible: true })
      .click();
    await message
      .getByRole("link", { name: relativePath, exact: true })
      .and(message.locator("a"))
      .click();
    await expect(filePane.getByText("Primary report", { exact: true })).toBeVisible();
    await expect(
      page
        .getByTestId(`workspace-tab-file_${primary.repoPath}/${relativePath}`)
        .filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      page.getByTestId(`workspace-tab-file_${secondaryPath}`).filter({ visible: true }),
    ).toHaveCount(1);
    await page.getByTestId(`workspace-tab-file_${secondaryPath}`).filter({ visible: true }).click();
    await expect(filePane.getByText("Secondary report", { exact: true })).toBeVisible();
    await testInfo.attach("multi-project-chat-files", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await secondary.cleanup();
    await primary.cleanup();
  }
});

test("reference links across paragraphs retain the first destination after reload", async ({
  page,
}, testInfo) => {
  await installDesktopRuntime(page, { serverId: process.env.E2E_SERVER_ID! });
  const response =
    "First [guide][docs].\n\nSecond [guide again][docs].\n\n[docs]: https://example.com/first\n\n[docs]: https://example.com/wrong";
  await withStreamingMarkdown(
    page,
    testInfo,
    async (agent) => {
      await agent.client.sendAgentMessage(agent.agentId, "Show the references.");
      await agent.client.waitForFinish(agent.agentId, 30_000);
      agent.stream.release();
      const message = page.getByTestId("assistant-message").last();
      for (const name of ["guide", "guide again"]) {
        await expect(
          message.getByRole("link", { name, exact: true }).and(message.locator("a")),
        ).toHaveAttribute("href", "https://example.com/first");
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      for (const name of ["guide", "guide again"]) {
        await expect(
          message.getByRole("link", { name, exact: true }).and(message.locator("a")),
        ).toHaveAttribute("href", "https://example.com/first");
      }
    },
    response,
  );
});
