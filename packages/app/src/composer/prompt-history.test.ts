/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import { usePromptHistoryStore } from "@/stores/prompt-history-store";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem, UserMessageItem } from "@/types/stream";
import {
  canNavigateHistoryDown,
  canNavigateHistoryUp,
  collectUserPromptsFromStream,
  resolveAvailablePrompts,
  useComposerPromptHistory,
} from "./prompt-history";

function createUserMessage(text: string, id: string): UserMessageItem {
  return {
    kind: "user_message",
    id,
    text,
    timestamp: new Date(),
  };
}

describe("collectUserPromptsFromStream", () => {
  it("extracts text from user_message stream items across tail and head", () => {
    const tail: StreamItem[] = [
      createUserMessage("First prompt", "msg-1"),
      {
        kind: "thought",
        id: "thought-1",
        text: "thinking",
        status: "ready",
        timestamp: new Date(),
      },
      createUserMessage("Second prompt", "msg-2"),
    ];
    const head: StreamItem[] = [createUserMessage("Third prompt", "msg-3")];

    const result = collectUserPromptsFromStream(tail, head);
    expect(result).toEqual(["First prompt", "Second prompt", "Third prompt"]);
  });

  it("skips non-user messages and whitespace-only text", () => {
    const tail: StreamItem[] = [
      createUserMessage("   ", "msg-1"),
      createUserMessage("", "msg-2"),
      createUserMessage("Valid prompt", "msg-3"),
    ];

    const result = collectUserPromptsFromStream(tail, []);
    expect(result).toEqual(["Valid prompt"]);
  });

  it("deduplicates consecutive identical prompts but keeps non-consecutive duplicates", () => {
    const tail: StreamItem[] = [
      createUserMessage("test", "msg-1"),
      createUserMessage("test", "msg-2"),
      createUserMessage("build", "msg-3"),
      createUserMessage("test", "msg-4"),
    ];

    const result = collectUserPromptsFromStream(tail, []);
    expect(result).toEqual(["test", "build", "test"]);
  });
});

describe("resolveAvailablePrompts", () => {
  it("prefers session prompts if available", () => {
    const session = ["session 1", "session 2"];
    const global = ["global 1", "global 2"];

    expect(resolveAvailablePrompts(session, global)).toEqual(["session 1", "session 2"]);
  });

  it("falls back to global prompts if session prompts is empty", () => {
    const session: string[] = [];
    const global = ["global 1", "global 2"];

    expect(resolveAvailablePrompts(session, global)).toEqual(["global 1", "global 2"]);
  });
});

describe("canNavigateHistoryUp", () => {
  it("returns true when already navigating", () => {
    const input = { text: "any text", selection: { start: 4, end: 4 } };
    expect(canNavigateHistoryUp(input, true)).toBe(true);
  });

  it("returns true when input is empty or whitespace", () => {
    expect(canNavigateHistoryUp({ text: "", selection: { start: 0, end: 0 } }, false)).toBe(true);
    expect(canNavigateHistoryUp({ text: "   ", selection: { start: 3, end: 3 } }, false)).toBe(
      true,
    );
  });

  it("returns true when cursor is at the very beginning", () => {
    const input = { text: "line 1\nline 2", selection: { start: 0, end: 0 } };
    expect(canNavigateHistoryUp(input, false)).toBe(true);
  });

  it("returns true when single line and cursor is at the end", () => {
    const input = { text: "single line", selection: { start: 11, end: 11 } };
    expect(canNavigateHistoryUp(input, false)).toBe(true);
  });

  it("returns false when single line and cursor is in the middle", () => {
    const input = { text: "single line", selection: { start: 4, end: 4 } };
    expect(canNavigateHistoryUp(input, false)).toBe(false);
  });

  it("returns false when multiline and cursor is on subsequent lines", () => {
    const input = { text: "line 1\nline 2", selection: { start: 9, end: 9 } };
    expect(canNavigateHistoryUp(input, false)).toBe(false);
  });

  it("returns false when text has a non-collapsed selection", () => {
    const input = { text: "single line", selection: { start: 0, end: 6 } };
    expect(canNavigateHistoryUp(input, false)).toBe(false);
  });
});

describe("canNavigateHistoryDown", () => {
  it("returns true only when navigating history", () => {
    expect(canNavigateHistoryDown(true)).toBe(true);
    expect(canNavigateHistoryDown(false)).toBe(false);
  });
});

describe("useComposerPromptHistory", () => {
  const SERVER_ID = "srv-1";
  const AGENT_ID = "agent-1";

  beforeEach(() => {
    usePromptHistoryStore.getState().clear();
    useSessionStore.getState().clearSession(SERVER_ID);
    useSessionStore.getState().initializeSession(SERVER_ID, null);
  });

  it("navigates through prompt history on ArrowUp and ArrowDown", () => {
    const replaceUserInput = vi.fn();

    // Populate stream with prompts
    useSessionStore.getState().setAgentStreamState(SERVER_ID, AGENT_ID, {
      tail: [createUserMessage("first prompt", "m1"), createUserMessage("second prompt", "m2")],
      head: [createUserMessage("third prompt", "m3")],
    });

    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    const preventDefault = vi.fn();

    // 1st ArrowUp: loads most recent ("third prompt")
    let handled = false;
    act(() => {
      handled = result.current.onKeyPress({
        key: "ArrowUp",
        preventDefault,
        input: { text: "", selection: { start: 0, end: 0 } },
      });
    });
    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(replaceUserInput).toHaveBeenLastCalledWith("third prompt", { start: 12, end: 12 });

    // 2nd ArrowUp: loads "second prompt"
    act(() => {
      handled = result.current.onKeyPress({
        key: "ArrowUp",
        preventDefault,
        input: { text: "third prompt", selection: { start: 12, end: 12 } },
      });
    });
    expect(handled).toBe(true);
    expect(replaceUserInput).toHaveBeenLastCalledWith("second prompt", { start: 13, end: 13 });

    // 3rd ArrowUp: loads "first prompt"
    act(() => {
      handled = result.current.onKeyPress({
        key: "ArrowUp",
        preventDefault,
        input: { text: "second prompt", selection: { start: 13, end: 13 } },
      });
    });
    expect(handled).toBe(true);
    expect(replaceUserInput).toHaveBeenLastCalledWith("first prompt", { start: 12, end: 12 });

    // 4th ArrowUp: stays at oldest
    act(() => {
      handled = result.current.onKeyPress({
        key: "ArrowUp",
        preventDefault,
        input: { text: "first prompt", selection: { start: 12, end: 12 } },
      });
    });
    expect(handled).toBe(true);
    expect(replaceUserInput).toHaveBeenLastCalledWith("first prompt", { start: 12, end: 12 });

    // 1st ArrowDown: loads "second prompt"
    act(() => {
      handled = result.current.onKeyPress({
        key: "ArrowDown",
        preventDefault,
        input: { text: "first prompt", selection: { start: 12, end: 12 } },
      });
    });
    expect(handled).toBe(true);
    expect(replaceUserInput).toHaveBeenLastCalledWith("second prompt", { start: 13, end: 13 });

    // 2nd ArrowDown: loads "third prompt"
    act(() => {
      handled = result.current.onKeyPress({
        key: "ArrowDown",
        preventDefault,
        input: { text: "second prompt", selection: { start: 13, end: 13 } },
      });
    });
    expect(handled).toBe(true);
    expect(replaceUserInput).toHaveBeenLastCalledWith("third prompt", { start: 12, end: 12 });

    // 3rd ArrowDown: restores draft ("") and exits navigation
    act(() => {
      handled = result.current.onKeyPress({
        key: "ArrowDown",
        preventDefault,
        input: { text: "third prompt", selection: { start: 12, end: 12 } },
      });
    });
    expect(handled).toBe(true);
    expect(replaceUserInput).toHaveBeenLastCalledWith("", { start: 0, end: 0 });

    // 4th ArrowDown: not navigating anymore, returns false
    act(() => {
      handled = result.current.onKeyPress({
        key: "ArrowDown",
        preventDefault,
        input: { text: "", selection: { start: 0, end: 0 } },
      });
    });
    expect(handled).toBe(false);
  });

  it("restores the original draft when user had typed something before ArrowUp", () => {
    const replaceUserInput = vi.fn();
    useSessionStore.getState().setAgentStreamState(SERVER_ID, AGENT_ID, {
      tail: [createUserMessage("existing prompt", "m1")],
    });

    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    const preventDefault = vi.fn();

    // User had typed "draft text"
    act(() => {
      result.current.onKeyPress({
        key: "ArrowUp",
        preventDefault,
        input: { text: "draft text", selection: { start: 10, end: 10 } },
      });
    });
    expect(replaceUserInput).toHaveBeenLastCalledWith("existing prompt", { start: 15, end: 15 });

    // ArrowDown restores "draft text"
    act(() => {
      result.current.onKeyPress({
        key: "ArrowDown",
        preventDefault,
        input: { text: "existing prompt", selection: { start: 15, end: 15 } },
      });
    });
    expect(replaceUserInput).toHaveBeenLastCalledWith("draft text", { start: 10, end: 10 });
  });

  it("restores the draft when Escape is pressed while navigating", () => {
    const replaceUserInput = vi.fn();
    useSessionStore.getState().setAgentStreamState(SERVER_ID, AGENT_ID, {
      tail: [createUserMessage("prompt", "m1")],
    });

    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    const preventDefault = vi.fn();

    act(() => {
      result.current.onKeyPress({
        key: "ArrowUp",
        preventDefault,
        input: { text: "my draft", selection: { start: 8, end: 8 } },
      });
    });

    let handled = false;
    act(() => {
      handled = result.current.onKeyPress({
        key: "Escape",
        preventDefault,
        input: { text: "prompt", selection: { start: 6, end: 6 } },
      });
    });

    expect(handled).toBe(true);
    expect(replaceUserInput).toHaveBeenLastCalledWith("my draft", { start: 8, end: 8 });
  });

  it("preserves transient edits made to a history entry while navigating", () => {
    const replaceUserInput = vi.fn();
    useSessionStore.getState().setAgentStreamState(SERVER_ID, AGENT_ID, {
      tail: [createUserMessage("older", "m1"), createUserMessage("newer", "m2")],
    });

    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    const preventDefault = vi.fn();

    // ArrowUp -> "newer"
    act(() => {
      result.current.onKeyPress({
        key: "ArrowUp",
        preventDefault,
        input: { text: "", selection: { start: 0, end: 0 } },
      });
    });
    expect(replaceUserInput).toHaveBeenLastCalledWith("newer", { start: 5, end: 5 });

    // User edits "newer" to "newer modified"
    act(() => {
      result.current.onTextChange("newer modified");
    });

    // ArrowUp -> "older"
    act(() => {
      result.current.onKeyPress({
        key: "ArrowUp",
        preventDefault,
        input: { text: "newer modified", selection: { start: 14, end: 14 } },
      });
    });
    expect(replaceUserInput).toHaveBeenLastCalledWith("older", { start: 5, end: 5 });

    // ArrowDown -> "newer modified" (transient edit preserved!)
    act(() => {
      result.current.onKeyPress({
        key: "ArrowDown",
        preventDefault,
        input: { text: "older", selection: { start: 5, end: 5 } },
      });
    });
    expect(replaceUserInput).toHaveBeenLastCalledWith("newer modified", { start: 14, end: 14 });
  });

  it("records submitted prompt and resets history state", () => {
    const replaceUserInput = vi.fn();
    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    act(() => {
      result.current.recordSubmittedPrompt("newly sent prompt");
    });

    expect(usePromptHistoryStore.getState().prompts).toContain("newly sent prompt");
  });

  it("ignores modifier keys such as Shift, Alt, Meta, Ctrl", () => {
    const replaceUserInput = vi.fn();
    usePromptHistoryStore.getState().addPrompt("prompt");

    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    const preventDefault = vi.fn();

    expect(
      result.current.onKeyPress({
        key: "ArrowUp",
        preventDefault,
        input: { text: "", selection: { start: 0, end: 0 } },
        shiftKey: true,
      }),
    ).toBe(false);

    expect(
      result.current.onKeyPress({
        key: "ArrowUp",
        preventDefault,
        input: { text: "", selection: { start: 0, end: 0 } },
        metaKey: true,
      }),
    ).toBe(false);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(replaceUserInput).not.toHaveBeenCalled();
  });
});
