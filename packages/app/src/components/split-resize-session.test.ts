/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginSplitterDrag,
  endSplitterDrag,
  isSplitResizeActive,
  noteWindowResizing,
  SPLIT_RESIZE_ROOT_ATTRIBUTE,
} from "./split-resize-session";

function rootHasFreeze(): boolean {
  return document.documentElement.getAttribute(SPLIT_RESIZE_ROOT_ATTRIBUTE) === "true";
}

afterEach(() => {
  endSplitterDrag();
  endSplitterDrag();
  vi.useFakeTimers();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.documentElement.removeAttribute(SPLIT_RESIZE_ROOT_ATTRIBUTE);
  document.documentElement.style.overflowX = "";
});

describe("split resize session", () => {
  it("freezes pane bodies for the duration of a splitter drag", () => {
    beginSplitterDrag();
    expect(isSplitResizeActive()).toBe(true);
    expect(rootHasFreeze()).toBe(true);
    expect(document.documentElement.style.overflowX).toBe("hidden");
    expect(document.getElementById("paseo-split-resize-styles")).not.toBeNull();

    endSplitterDrag();
    expect(isSplitResizeActive()).toBe(false);
    expect(rootHasFreeze()).toBe(false);
    expect(document.documentElement.style.overflowX).toBe("");
  });

  it("keeps the freeze until every nested drag ends", () => {
    beginSplitterDrag();
    beginSplitterDrag();
    endSplitterDrag();
    expect(isSplitResizeActive()).toBe(true);
    expect(rootHasFreeze()).toBe(true);
    endSplitterDrag();
    expect(isSplitResizeActive()).toBe(false);
    expect(rootHasFreeze()).toBe(false);
  });

  it("holds the freeze while the window is still being resized", () => {
    vi.useFakeTimers();
    noteWindowResizing();
    expect(isSplitResizeActive()).toBe(true);
    expect(rootHasFreeze()).toBe(true);
    vi.advanceTimersByTime(149);
    expect(isSplitResizeActive()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isSplitResizeActive()).toBe(false);
    expect(rootHasFreeze()).toBe(false);
  });
});
