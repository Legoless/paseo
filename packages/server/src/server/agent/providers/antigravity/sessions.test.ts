import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listAgyImportableSessions } from "./sessions.js";

describe("listAgyImportableSessions", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("lists the latest prompt per conversation for a workspace", async () => {
    const homeDir = join(tmpdir(), `agy-home-${Date.now()}`);
    dirs.push(homeDir);
    mkdirSync(join(homeDir, ".gemini", "antigravity-cli"), { recursive: true });
    writeFileSync(
      join(homeDir, ".gemini", "antigravity-cli", "history.jsonl"),
      [
        JSON.stringify({
          display: "old prompt",
          timestamp: 100,
          workspace: "/work/a",
          conversationId: "conv-1",
        }),
        JSON.stringify({
          display: "other workspace",
          timestamp: 200,
          workspace: "/work/b",
          conversationId: "conv-2",
        }),
        JSON.stringify({
          display: "latest prompt",
          timestamp: 300,
          workspace: "/work/a",
          conversationId: "conv-1",
        }),
        JSON.stringify({
          display: "missing id",
          timestamp: 400,
          workspace: "/work/a",
        }),
      ].join("\n"),
    );

    const sessions = await listAgyImportableSessions({
      homeDir,
      cwd: "/work/a",
      limit: 10,
    });
    expect(sessions).toEqual([
      {
        providerHandleId: "conv-1",
        cwd: "/work/a",
        title: "latest prompt",
        firstPromptPreview: "latest prompt",
        lastPromptPreview: "latest prompt",
        lastActivityAt: new Date(300),
      },
    ]);
  });

  it("returns an empty list when history is missing", async () => {
    const homeDir = join(tmpdir(), `agy-home-missing-${Date.now()}`);
    dirs.push(homeDir);
    await expect(listAgyImportableSessions({ homeDir, cwd: "/work/a" })).resolves.toEqual([]);
  });
});
