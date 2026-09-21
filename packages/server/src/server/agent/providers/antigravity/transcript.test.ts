import { describe, expect, it } from "vitest";
import { convertAgyTranscriptSteps, extractAgyUserRequest } from "./transcript.js";

describe("extractAgyUserRequest", () => {
  it("pulls the USER_REQUEST body out of wrapped transcript content", () => {
    expect(
      extractAgyUserRequest(
        "<USER_REQUEST>\nCan you run lego tart vm\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nnow\n</ADDITIONAL_METADATA>",
      ),
    ).toBe("Can you run lego tart vm");
  });
});

describe("convertAgyTranscriptSteps", () => {
  it("replays user, reasoning, tool, and assistant steps", () => {
    const events = convertAgyTranscriptSteps("antigravity", [
      {
        step_index: 0,
        type: "USER_INPUT",
        created_at: "2026-09-21T07:05:33Z",
        content: "<USER_REQUEST>\nList files\n</USER_REQUEST>",
      },
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        thinking: "Looking around.\n",
        tool_calls: [{ name: "run_command", args: { CommandLine: '"ls"' } }],
      },
      {
        step_index: 2,
        type: "GENERIC",
        content: "README.md\n",
      },
      {
        step_index: 3,
        type: "PLANNER_RESPONSE",
        content: "The directory has a README.",
      },
    ]);

    expect(events).toMatchObject([
      { type: "timeline", item: { type: "user_message", text: "List files" } },
      { type: "timeline", item: { type: "reasoning", text: "Looking around.\n" } },
      {
        type: "timeline",
        item: {
          type: "tool_call",
          name: "run_command",
          status: "running",
          detail: { type: "shell", command: "ls" },
        },
      },
      {
        type: "timeline",
        item: {
          type: "tool_call",
          name: "run_command",
          status: "completed",
          detail: { type: "shell", command: "ls", output: "README.md\n" },
        },
      },
      {
        type: "timeline",
        item: { type: "assistant_message", text: "The directory has a README." },
      },
    ]);
  });
});
