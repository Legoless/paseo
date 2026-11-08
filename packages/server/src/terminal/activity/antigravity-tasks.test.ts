import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAntigravityDaemonTaskChecker,
  type AntigravityTrayTaskSummary,
} from "./antigravity-tasks.js";

interface TestConversationStep {
  step_index: number;
  type: "USER_INPUT" | "PLANNER_RESPONSE" | "GENERIC" | "SYSTEM_MESSAGE";
  status: "DONE" | "RUNNING" | "ERROR";
  created_at?: string;
  content?: string;
  tool_calls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
}

describe("createAntigravityDaemonTaskChecker", () => {
  const tempDirs: string[] = [];

  function createTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "paseo-agy-tasks-"));
    tempDirs.push(dir);
    return dir;
  }

  function writeHistory(
    cliHomeDir: string,
    entries: Array<{ conversationId: string; workspace: string; timestamp: number }>,
  ): void {
    mkdirSync(cliHomeDir, { recursive: true });
    const lines = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    writeFileSync(join(cliHomeDir, "history.jsonl"), lines, "utf8");
  }

  function writeTranscript(
    cliHomeDir: string,
    conversationId: string,
    steps: TestConversationStep[],
  ): string {
    const logsDir = join(cliHomeDir, "brain", conversationId, ".system_generated", "logs");
    mkdirSync(logsDir, { recursive: true });
    const transcriptPath = join(logsDir, "transcript.jsonl");
    const lines = steps.map((step) => JSON.stringify(step)).join("\n") + "\n";
    writeFileSync(transcriptPath, lines, "utf8");
    return transcriptPath;
  }

  function writeCompletionMessage(input: {
    cliHomeDir: string;
    conversationId: string;
    messageId: string;
    senderTaskId: string;
    undelivered?: boolean;
  }): void {
    const baseDir = join(
      input.cliHomeDir,
      "brain",
      input.conversationId,
      ".system_generated",
      "messages",
    );
    const targetDir = input.undelivered ? join(baseDir, "undelivered") : baseDir;
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, `${input.messageId}.json`),
      JSON.stringify({
        id: input.messageId,
        recipient: input.conversationId,
        sender: input.senderTaskId,
      }),
      "utf8",
    );
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns true for an IsDaemon background command and false for a non-daemon command or missing transcript", () => {
    const rootDir = createTempDir();
    const workspaceDir = join(rootDir, "kingdomrush-godot");
    const cliHomeDir = join(rootDir, ".gemini", "antigravity-cli");
    mkdirSync(workspaceDir, { recursive: true });

    const checkDaemonOnly = createAntigravityDaemonTaskChecker({
      getCwd: () => workspaceDir,
      cliHomeDir,
    });

    const godotTray: AntigravityTrayTaskSummary = {
      visibleTasks: [
        {
          startTime: "10:43:59",
          description: "./launch-godot.command",
          truncated: false,
        },
      ],
      taskCount: 1,
    };

    // Fail-safe when no transcript exists yet.
    expect(checkDaemonOnly(godotTray)).toBe(false);

    const daemonConvId = "a5f25ca9-f00d-4da4-ae48-a477fde38fda";
    writeHistory(cliHomeDir, [
      { conversationId: daemonConvId, workspace: workspaceDir, timestamp: 1000 },
    ]);
    writeTranscript(cliHomeDir, daemonConvId, [
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine: '"./launch-godot.command"',
              IsDaemon: "true",
              WaitMsBeforeAsync: "3000",
            },
          },
        ],
      },
      {
        step_index: 2,
        type: "GENERIC",
        status: "RUNNING",
        created_at: "2026-11-08T09:43:59Z",
        content: [
          "Created At: 2026-11-08T10:43:59+01:00",
          `Tool is running as a background task with task id: ${daemonConvId}/task-2`,
          "Task Description: ./launch-godot.command",
          `Task logs are available at: file://${cliHomeDir}/brain/${daemonConvId}/.system_generated/tasks/task-2.log`,
        ].join("\n"),
      },
    ]);

    expect(checkDaemonOnly(godotTray)).toBe(true);

    const testConvId = "b6f25ca9-f00d-4da4-ae48-a477fde38fdb";
    writeHistory(cliHomeDir, [
      { conversationId: daemonConvId, workspace: workspaceDir, timestamp: 1000 },
      { conversationId: testConvId, workspace: workspaceDir, timestamp: 2000 },
    ]);
    writeTranscript(cliHomeDir, testConvId, [
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine: '"npm run corpus:check"',
              WaitMsBeforeAsync: "5000",
            },
          },
        ],
      },
      {
        step_index: 2,
        type: "GENERIC",
        status: "RUNNING",
        content: [
          "Created At: 2026-11-08T09:34:08+01:00",
          `Tool is running as a background task with task id: ${testConvId}/task-2`,
          "Task Description: npm run corpus:check",
        ].join("\n"),
      },
    ]);

    expect(
      checkDaemonOnly({
        visibleTasks: [
          {
            startTime: "09:34:08",
            description: "npm run corpus:check",
            truncated: false,
          },
        ],
        taskCount: 1,
      }),
    ).toBe(false);

    // A second terminal in the same workspace still resolves its own conversation by tray row.
    expect(checkDaemonOnly(godotTray)).toBe(true);

    // Once the daemon process exits and writes its completion message, it is no longer open.
    writeCompletionMessage({
      cliHomeDir,
      conversationId: daemonConvId,
      messageId: "msg-1",
      senderTaskId: `${daemonConvId}/task-2`,
      undelivered: true,
    });
    expect(checkDaemonOnly(godotTray)).toBe(false);
  });

  it("stays false while a non-daemon task runs alongside an IsDaemon command and turns true once the non-daemon task finishes", () => {
    const rootDir = createTempDir();
    const workspaceDir = join(rootDir, "app-repo");
    const cliHomeDir = join(rootDir, ".gemini", "antigravity-cli");
    mkdirSync(workspaceDir, { recursive: true });

    const conversationId = "11111111-2222-3333-4444-555555555555";
    writeHistory(cliHomeDir, [{ conversationId, workspace: workspaceDir, timestamp: 1000 }]);
    const transcriptPath = writeTranscript(cliHomeDir, conversationId, [
      {
        step_index: 10,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        tool_calls: [
          {
            name: "read_file",
            args: { Path: '"/tmp/readme.md"' },
          },
          {
            name: "run_command",
            args: {
              CommandLine: '"npm run dev -- --port 3000 --host 127.0.0.1"',
              IsDaemon: "true",
              WaitMsBeforeAsync: "500",
            },
          },
          {
            name: "run_command",
            args: {
              CommandLine: '"npm run test:integration"',
              IsDaemon: "false",
              WaitMsBeforeAsync: "500",
            },
          },
        ],
      },
      {
        step_index: 11,
        type: "GENERIC",
        status: "DONE",
        content: "Created At: 2026-11-08T11:00:01+01:00\nShowing lines 1-10",
      },
      {
        step_index: 12,
        type: "GENERIC",
        status: "RUNNING",
        content: [
          "Created At: 2026-11-08T11:00:02+01:00",
          `Tool is running as a background task with task id: ${conversationId}/task-12`,
          "Task Description: npm run dev -- --port 3000 --host 127.0.0.1",
        ].join("\n"),
      },
      {
        step_index: 13,
        type: "GENERIC",
        status: "RUNNING",
        content: [
          "Created At: 2026-11-08T11:00:03+01:00",
          `Tool is running as a background task with task id: ${conversationId}/task-13`,
          "Task Description: npm run test:integration",
        ].join("\n"),
      },
    ]);

    const checkDaemonOnly = createAntigravityDaemonTaskChecker({
      getCwd: () => workspaceDir,
      cliHomeDir,
    });

    // Both rows visible -> false because task-13 is IsDaemon: false.
    expect(
      checkDaemonOnly({
        visibleTasks: [
          {
            startTime: "11:00:02",
            description: "npm run dev -- --port 3000",
            truncated: true,
          },
          {
            startTime: "11:00:03",
            description: "npm run test:integration",
            truncated: false,
          },
        ],
        taskCount: 2,
      }),
    ).toBe(false);

    // Even if only the daemon row is visible while taskCount is 2, hidden non-daemon work keeps it false.
    expect(
      checkDaemonOnly({
        visibleTasks: [
          {
            startTime: "11:00:02",
            description: "npm run dev -- --port 3000",
            truncated: true,
          },
        ],
        taskCount: 2,
      }),
    ).toBe(false);

    // Append wakeup delivery in transcript closing task-13 while task-12 stays running.
    appendFileSync(
      transcriptPath,
      JSON.stringify({
        step_index: 14,
        type: "SYSTEM_MESSAGE",
        status: "DONE",
        content: `<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-08T10:00:20Z sender=${conversationId}/task-13 priority=MESSAGE_PRIORITY_HIGH content=Task id "${conversationId}/task-13" finished with result:\nPASS`,
      }) + "\n",
      "utf8",
    );

    expect(
      checkDaemonOnly({
        visibleTasks: [
          {
            startTime: "11:00:02",
            description: "npm run dev -- --port 3000",
            truncated: true,
          },
        ],
        taskCount: 1,
      }),
    ).toBe(true);
  });

  it("handles footer-only counts, recurring IsDaemon crons, and explicit cancellations", () => {
    const rootDir = createTempDir();
    const workspaceDir = join(rootDir, "cron-repo");
    const cliHomeDir = join(rootDir, ".gemini", "antigravity-cli");
    mkdirSync(workspaceDir, { recursive: true });

    const conversationId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    writeHistory(cliHomeDir, [{ conversationId, workspace: workspaceDir, timestamp: 5000 }]);
    const transcriptPath = writeTranscript(cliHomeDir, conversationId, [
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        tool_calls: [
          {
            name: "schedule",
            args: {
              CronExpression: '"*/5 * * * *"',
              IsDaemon: "true",
              Prompt: '"Check deploy health"',
            },
          },
        ],
      },
      {
        step_index: 2,
        type: "GENERIC",
        status: "RUNNING",
        content: [
          "Created At: 2026-11-08T12:00:00+01:00",
          `Tool is running as a background task with task id: ${conversationId}/task-2`,
          "Task Description: Cron: */5 * * * *, Prompt: Check deploy health",
        ].join("\n"),
      },
      // A recurring cron fires [Message] without terminating itself.
      {
        step_index: 3,
        type: "SYSTEM_MESSAGE",
        status: "DONE",
        content: `<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-08T11:05:00Z sender=${conversationId}/task-2 priority=MESSAGE_PRIORITY_HIGH content=Check deploy health`,
      },
    ]);

    const checkDaemonOnly = createAntigravityDaemonTaskChecker({
      getCwd: () => workspaceDir,
      cliHomeDir,
    });

    expect(checkDaemonOnly({ visibleTasks: [], taskCount: 1 })).toBe(true);

    // Explicit cancellation closes the standing cron.
    appendFileSync(
      transcriptPath,
      JSON.stringify({
        step_index: 4,
        type: "GENERIC",
        status: "DONE",
        content: `Created At: 2026-11-08T12:06:00+01:00\nTask "${conversationId}/task-2" cancelled.`,
      }) + "\n",
      "utf8",
    );

    expect(checkDaemonOnly({ visibleTasks: [], taskCount: 1 })).toBe(false);
  });
});
