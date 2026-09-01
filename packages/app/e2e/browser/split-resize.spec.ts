import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

interface Axis {
  /** The divider the case drags, named after what it separates. */
  label: string;
  /** Screen axis the divider slides along. */
  main: "x" | "y";
  /** Screen axis the sibling dividers are spread along, used to order them. */
  cross: "x" | "y";
  /** Command center actions that build two parallel dividers. */
  build: string[];
}

const AXES: Axis[] = [
  {
    label: "row",
    main: "y",
    cross: "x",
    build: ["Split pane right", "Split pane down", "Focus pane left", "Split pane down"],
  },
  {
    label: "column",
    main: "x",
    cross: "y",
    build: ["Split pane down", "Split pane right", "Focus pane up", "Split pane right"],
  },
];

/** Root row [column[P, row[N2, N3]] | N1]: the nested divider sits inside a pane the drag resizes. */
const NESTED_BUILD = ["Split pane right", "Focus pane left", "Split pane down", "Split pane right"];

interface Divider {
  x: number;
  y: number;
  length: number;
}

function dividerSelector(axis: "x" | "y"): string {
  return `[data-split-resize-axis="${axis}"]`;
}

async function dividers(page: Page, axis: "x" | "y"): Promise<Divider[]> {
  const handles = await page.locator(dividerSelector(axis)).all();
  const found: Divider[] = [];
  for (const handle of handles) {
    const box = await handle.boundingBox();
    if (!box) {
      throw new Error("A divider is not laid out");
    }
    found.push({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      length: axis === "x" ? box.height : box.width,
    });
  }
  return found;
}

/** Dividers on this axis ordered along the cross axis, so index 0 is the leftmost or topmost. */
async function orderedDividers(page: Page, axis: Axis): Promise<Divider[]> {
  const found = await dividers(page, axis.main);
  return found.sort((first, second) => first[axis.cross] - second[axis.cross]);
}

function pointAt(axis: "x" | "y", from: Divider, travelled: number): [number, number] {
  return axis === "x" ? [from.x + travelled, from.y] : [from.x, from.y + travelled];
}

async function dragAlongAxis(
  page: Page,
  axis: "x" | "y",
  from: Divider,
  delta: number,
): Promise<void> {
  await page.mouse.move(...pointAt(axis, from, 0));
  await page.mouse.down();
  await page.mouse.move(...pointAt(axis, from, delta / 2), { steps: 4 });
  await page.mouse.move(...pointAt(axis, from, delta), { steps: 4 });
  await page.mouse.up();
}

function gap(axis: Axis, centers: Divider[]): number {
  return Math.abs(centers[0][axis.main] - centers[1][axis.main]);
}

async function openWorkspace(page: Page, prefix: string, build: string[]) {
  const workspace = await seedWorkspace({ repoPrefix: prefix });
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWorkspace(page, workspace.workspaceId);
  await waitForWorkspaceTabsVisible(page);
  for (const action of build) {
    await runWorkspaceActionFromCommandCenter(page, action);
  }
  return workspace;
}

test.describe("Split resize", () => {
  for (const axis of AXES) {
    test(`a ${axis.label} divider snaps onto the ${axis.label} divider beside it`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const workspace = await openWorkspace(page, `split-resize-snap-${axis.label}-`, axis.build);

      try {
        await expect(page.locator(dividerSelector(axis.main))).toHaveCount(2, { timeout: 30_000 });

        await test.step("the first divider moves clear of the second", async () => {
          await dragAlongAxis(page, axis.main, (await orderedDividers(page, axis))[0], -120);
          expect(gap(axis, await orderedDividers(page, axis))).toBeGreaterThan(100);
        });

        await test.step("stopping 4px short of it snaps them level", async () => {
          const misaligned = await orderedDividers(page, axis);
          const remaining = misaligned[0][axis.main] - misaligned[1][axis.main];
          await dragAlongAxis(page, axis.main, misaligned[1], remaining + 4);
          expect(gap(axis, await orderedDividers(page, axis))).toBeLessThan(1);
        });

        await test.step("shift places a divider inside the snap zone", async () => {
          const aligned = await orderedDividers(page, axis);
          await page.keyboard.down("Shift");
          try {
            await dragAlongAxis(page, axis.main, aligned[1], 4);
          } finally {
            await page.keyboard.up("Shift");
          }
          expect(gap(axis, await orderedDividers(page, axis))).toBeGreaterThan(2);
        });
      } finally {
        await workspace.cleanup();
      }
    });
  }

  // The workspace keeps a hidden pane for the explorer sidebar, so a group's stored fractions do
  // not sum to 1 and flex is renormalized over the visible children. A handle that ignores that
  // moves its divider faster than the pointer, which also lands every snap short of its target.
  test("a divider tracks the cursor in a group that holds a hidden pane", async ({ page }) => {
    test.setTimeout(90_000);
    const workspace = await openWorkspace(page, "split-resize-tracking-", ["Split pane right"]);

    try {
      const [before] = await dividers(page, "x");
      await dragAlongAxis(page, "x", before, 100);
      const [after] = await dividers(page, "x");

      expect(after.x - before.x).toBeCloseTo(100, 0);
    } finally {
      await workspace.cleanup();
    }
  });

  test("a divider inside the resized pane is not a snap target", async ({ page }) => {
    test.setTimeout(90_000);
    const workspace = await openWorkspace(page, "split-resize-nested-", NESTED_BUILD);

    try {
      await expect(page.locator(dividerSelector("x"))).toHaveCount(2, { timeout: 30_000 });
      const found = await dividers(page, "x");
      // The outer divider spans the whole workspace; the nested one only spans its column.
      const [outer, inner] = found.sort((first, second) => second.length - first.length);
      const offset = inner.x - outer.x;

      // Walk the outer divider across the spot the nested one started at, sampling inside the
      // capture zone on both sides. The nested divider travels with the drag, so the two can never
      // come level and the drag must not stall on the way past.
      await page.mouse.move(...pointAt("x", outer, 0));
      await page.mouse.down();
      const travel: number[] = [];
      for (const delta of [offset - 5, offset + 5]) {
        await page.mouse.move(...pointAt("x", outer, delta), { steps: 2 });
        travel.push((await dividers(page, "x")).sort((a, b) => b.length - a.length)[0].x);
      }
      await page.mouse.up();

      expect(travel[1] - travel[0]).toBeGreaterThan(6);
    } finally {
      await workspace.cleanup();
    }
  });
});
