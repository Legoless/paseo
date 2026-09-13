import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import {
  ProjectCommandsSession,
  type ProjectCommandsSessionHost,
} from "./project-commands-session.js";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "../../workspace-registry.js";
import type { SessionOutboundMessage } from "../../messages.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "project-commands-session-test-")));
  tempDirs.push(root);
  return root;
}

function writeCommandsFile(root: string, contents: unknown): string {
  const dir = join(root, ".paseo-neo");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "commands.json");
  writeFileSync(filePath, typeof contents === "string" ? contents : JSON.stringify(contents));
  return filePath;
}

function projectRecord(rootPath: string, archivedAt: string | null = null): PersistedProjectRecord {
  return {
    projectId: `project:${rootPath}`,
    rootPath,
    kind: "git",
    displayName: "Project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt,
  } as PersistedProjectRecord;
}

function worktreeWorkspaceRecord(member: {
  cwd: string;
  mainRepoRoot: string | null;
}): PersistedWorkspaceRecord {
  return {
    workspaceId: `workspace:${member.cwd}`,
    displayName: "Workspace",
    title: null,
    members: [
      {
        projectId: "project:other",
        cwd: member.cwd,
        kind: "worktree",
        displayName: "Worktree",
        branch: "feature",
        worktreeRoot: member.cwd,
        baseBranch: "main",
        isPaseoOwnedWorktree: true,
        mainRepoRoot: member.mainRepoRoot,
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    autoArchivedChangeRequestUrl: null,
    pinnedAt: null,
  } as PersistedWorkspaceRecord;
}

function makeSubsystem(
  records: PersistedProjectRecord[],
  workspaces: PersistedWorkspaceRecord[] = [],
) {
  const emitted: SessionOutboundMessage[] = [];
  const host: ProjectCommandsSessionHost = { emit: (msg) => emitted.push(msg) };
  const subsystem = new ProjectCommandsSession({
    host,
    projectRegistry: { list: async () => records },
    workspaceRegistry: { list: async () => workspaces },
    logger: pino({ level: "silent" }),
  });
  return { subsystem, emitted };
}

async function requestCommands(
  subsystem: ProjectCommandsSession,
  cwd: string,
  requestId = "req-1",
): Promise<void> {
  await subsystem.handleCommandsProjectListRequest({
    type: "commands.project.list.request",
    requestId,
    cwd,
  });
}

describe("ProjectCommandsSession", () => {
  test("answers empty without error for an unknown cwd", async () => {
    const { subsystem, emitted } = makeSubsystem([]);

    await requestCommands(subsystem, makeRoot());

    expect(emitted).toEqual([
      {
        type: "commands.project.list.response",
        payload: { requestId: "req-1", commands: [], sourcePath: null, error: null },
      },
    ]);
  });

  test("answers empty without error when the project has no commands file", async () => {
    const root = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(root)]);

    await requestCommands(subsystem, root);

    expect(emitted).toEqual([
      {
        type: "commands.project.list.response",
        payload: { requestId: "req-1", commands: [], sourcePath: null, error: null },
      },
    ]);
  });

  test("answers empty without error for an archived project", async () => {
    const root = makeRoot();
    writeCommandsFile(root, { commands: [{ title: "Run tests", text: "npm test" }] });
    const { subsystem, emitted } = makeSubsystem([projectRecord(root, "2026-01-02T00:00:00.000Z")]);

    await requestCommands(subsystem, root);

    expect(emitted).toEqual([
      {
        type: "commands.project.list.response",
        payload: { requestId: "req-1", commands: [], sourcePath: null, error: null },
      },
    ]);
  });

  test("returns the commands of a known project root with the source path", async () => {
    const root = makeRoot();
    const sourcePath = writeCommandsFile(root, {
      commands: [
        { title: "Review PR", text: "Review the diff", shortcut: "Cmd+Shift+R" },
        { title: "Run tests", text: "npm test", target: "terminal", submit: false },
      ],
    });
    const { subsystem, emitted } = makeSubsystem([projectRecord(root)]);

    await requestCommands(subsystem, `${root}/`);

    expect(emitted).toEqual([
      {
        type: "commands.project.list.response",
        payload: {
          requestId: "req-1",
          commands: [
            {
              id: "review-pr",
              title: "Review PR",
              text: "Review the diff",
              target: "agent",
              submit: true,
              shortcut: "Cmd+Shift+R",
            },
            {
              id: "run-tests",
              title: "Run tests",
              text: "npm test",
              target: "terminal",
              submit: false,
            },
          ],
          sourcePath,
          error: null,
        },
      },
    ]);
  });

  test("reports an invalid file with its source path and a formatted error", async () => {
    const root = makeRoot();
    const sourcePath = writeCommandsFile(root, "{ not json");
    const { subsystem, emitted } = makeSubsystem([projectRecord(root)]);

    await requestCommands(subsystem, root);

    expect(emitted).toHaveLength(1);
    const [message] = emitted;
    if (message.type !== "commands.project.list.response") {
      throw new Error(`unexpected message type ${message.type}`);
    }
    expect(message.payload.requestId).toBe("req-1");
    expect(message.payload.commands).toEqual([]);
    expect(message.payload.sourcePath).toBe(sourcePath);
    expect(message.payload.error).toMatch(/^commands\.json: /);
  });

  test("resolves a worktree member cwd to its main repo root", async () => {
    const mainRoot = makeRoot();
    const worktreeRoot = makeRoot();
    const sourcePath = writeCommandsFile(mainRoot, {
      commands: [{ title: "Review PR", text: "Review the diff" }],
    });
    const { subsystem, emitted } = makeSubsystem(
      [],
      [worktreeWorkspaceRecord({ cwd: worktreeRoot, mainRepoRoot: mainRoot })],
    );

    await requestCommands(subsystem, worktreeRoot);

    expect(emitted).toEqual([
      {
        type: "commands.project.list.response",
        payload: {
          requestId: "req-1",
          commands: [
            {
              id: "review-pr",
              title: "Review PR",
              text: "Review the diff",
              target: "agent",
              submit: true,
            },
          ],
          sourcePath,
          error: null,
        },
      },
    ]);
  });
});
