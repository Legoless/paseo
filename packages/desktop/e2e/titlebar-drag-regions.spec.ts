import { test, expect } from "../../app/e2e/support/fixtures";
import { gotoAppShell } from "../../app/e2e/support/helpers/app";

test.describe("Titlebar drag regions", () => {
  // Chromium keeps a no-drag rect even where a scroll container clips it, so a button scrolled
  // under the titlebar blocked window dragging at that spot.
  test("scrolled chat content never claims no-drag; titlebar controls keep it", async ({
    page,
  }) => {
    await gotoAppShell(page);

    const regions = await page.evaluate(() => {
      const host = document.createElement("div");
      host.innerHTML = `
        <div data-testid="agent-chat-scroll">
          <button id="chat-button"></button>
          <div role="button" id="chat-badge"></div>
        </div>
        <button id="titlebar-button"></button>
        <div data-testid="workspace-tabs-row" id="tabs-row">
          <div data-testid="workspace-tab-agent_1" id="tab-chip"></div>
        </div>`;
      document.body.append(host);
      const region = (id: string) =>
        getComputedStyle(document.getElementById(id)!).getPropertyValue("-webkit-app-region");
      const result = {
        chatButton: region("chat-button"),
        chatBadge: region("chat-badge"),
        tabsRow: region("tabs-row"),
        titlebarButton: region("titlebar-button"),
        tabChip: region("tab-chip"),
      };
      host.remove();
      return result;
    });

    expect(regions.chatButton).not.toBe("no-drag");
    expect(regions.chatBadge).not.toBe("no-drag");
    expect(regions.tabsRow).not.toBe("no-drag");
    expect(regions.titlebarButton).toBe("no-drag");
    expect(regions.tabChip).toBe("no-drag");
  });
});
