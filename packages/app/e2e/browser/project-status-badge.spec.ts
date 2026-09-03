import { test } from "../support/fixtures";
import {
  expandStatusProject,
  expectCollapsedProjectStatus,
  expectProjectStatusHidden,
  openAndCollapseStatusProject,
  seedStatusProject,
  startNeedsInputWorkspace,
  startWorkingWorkspace,
} from "../helpers/project-status-badge";

test("a collapsed project surfaces its most urgent hidden workspace status", async ({ page }) => {
  test.setTimeout(120_000);
  const project = await seedStatusProject();

  try {
    await openAndCollapseStatusProject(page, project);
    await expectProjectStatusHidden(page, project);

    await startWorkingWorkspace(project);
    await expectCollapsedProjectStatus(page, project, "Working");

    await startNeedsInputWorkspace(project);
    await expectCollapsedProjectStatus(page, project, "Needs input");

    await expandStatusProject(page, project);
    // Expanding hands the status down to the rows underneath. The project badge is what this
    // covers; a workspace row carries no status of its own, so there is nothing to assert there.
    await expectProjectStatusHidden(page, project);
  } finally {
    await project.seed.cleanup().catch(() => undefined);
  }
});
