import { describe, expect, it, vi } from "vitest";

import {
  EMPTY_ISOLATED_TERMINAL_GUEST_BUDGET,
  ISOLATED_TERMINAL_GUEST_BUDGET,
  createIsolatedTerminalGuestBudget,
  removeIsolatedTerminalGuest,
  touchIsolatedTerminalGuest,
} from "./isolated-terminal-guest-budget";

describe("isolated terminal guest budget policy", () => {
  it("defaults to a fixed budget of 8 mounted guests", () => {
    expect(ISOLATED_TERMINAL_GUEST_BUDGET).toBe(8);
  });

  it("touching a guest makes it most-recently-used", () => {
    const first = touchIsolatedTerminalGuest(EMPTY_ISOLATED_TERMINAL_GUEST_BUDGET, "a");
    const second = touchIsolatedTerminalGuest(first.state, "b");
    const touched = touchIsolatedTerminalGuest(second.state, "a");
    expect(touched.state.order).toEqual(["a", "b"]);
    expect(touched.evicted).toEqual([]);
  });

  it("does not duplicate a guest that is touched again", () => {
    const state = touchIsolatedTerminalGuest(
      touchIsolatedTerminalGuest(EMPTY_ISOLATED_TERMINAL_GUEST_BUDGET, "a").state,
      "a",
    ).state;
    expect(state.order).toEqual(["a"]);
  });

  it("evicts the least-recently-used guest past the cap", () => {
    let state = EMPTY_ISOLATED_TERMINAL_GUEST_BUDGET;
    for (const key of ["a", "b", "c"]) {
      state = touchIsolatedTerminalGuest(state, key, 3).state;
    }
    const update = touchIsolatedTerminalGuest(state, "d", 3);
    expect(update.state.order).toEqual(["d", "c", "b"]);
    expect(update.evicted).toEqual(["a"]);
  });

  it("evicts in LRU order when several guests overflow at once", () => {
    let state = EMPTY_ISOLATED_TERMINAL_GUEST_BUDGET;
    for (const key of ["a", "b", "c", "d"]) {
      state = touchIsolatedTerminalGuest(state, key, 4).state;
    }
    const update = touchIsolatedTerminalGuest(state, "e", 2);
    expect(update.state.order).toEqual(["e", "d"]);
    expect(update.evicted).toEqual(["c", "b", "a"]);
  });

  it("keeps at least one guest even with a non-positive cap", () => {
    const update = touchIsolatedTerminalGuest(EMPTY_ISOLATED_TERMINAL_GUEST_BUDGET, "a", 0);
    expect(update.state.order).toEqual(["a"]);
    expect(update.evicted).toEqual([]);
  });

  it("removing a guest drops it from the order", () => {
    const state = touchIsolatedTerminalGuest(
      touchIsolatedTerminalGuest(EMPTY_ISOLATED_TERMINAL_GUEST_BUDGET, "a").state,
      "b",
    ).state;
    expect(removeIsolatedTerminalGuest(state, "a").order).toEqual(["b"]);
  });

  it("removing an unknown guest is a no-op", () => {
    const state = touchIsolatedTerminalGuest(EMPTY_ISOLATED_TERMINAL_GUEST_BUDGET, "a").state;
    expect(removeIsolatedTerminalGuest(state, "missing")).toBe(state);
  });
});

describe("isolated terminal guest budget store", () => {
  it("notifies subscribers with the evicted keys", () => {
    const budget = createIsolatedTerminalGuestBudget(2);
    const listener = vi.fn();
    budget.subscribe(listener);
    budget.present("a");
    budget.present("b");
    expect(listener).not.toHaveBeenCalled();
    budget.present("c");
    expect(listener).toHaveBeenCalledWith(["a"]);
  });

  it("returns the evicted keys from present", () => {
    const budget = createIsolatedTerminalGuestBudget(1);
    budget.present("a");
    expect(budget.present("b")).toEqual(["a"]);
  });

  it("releases guests so they no longer count against the cap", () => {
    const budget = createIsolatedTerminalGuestBudget(2);
    budget.present("a");
    budget.present("b");
    budget.release("a");
    expect(budget.present("c")).toEqual([]);
    expect(budget.snapshot()).toEqual(["c", "b"]);
  });

  it("stops notifying after unsubscribe", () => {
    const budget = createIsolatedTerminalGuestBudget(1);
    const listener = vi.fn();
    const unsubscribe = budget.subscribe(listener);
    unsubscribe();
    budget.present("a");
    budget.present("b");
    expect(listener).not.toHaveBeenCalled();
  });
});
