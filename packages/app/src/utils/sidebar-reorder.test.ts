import { describe, expect, it } from "vitest";

import {
  hasVisibleOrderChanged,
  memberOrderAfterMove,
  mergeWithRemainder,
} from "./sidebar-reorder";

describe("hasVisibleOrderChanged", () => {
  it("returns false when visible order is unchanged", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["a", "b", "c"],
      }),
    ).toBe(false);
  });

  it("returns true when visible items are reordered", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["b", "a", "c"],
      }),
    ).toBe(true);
  });

  it("returns true when a visible key is missing from current order", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b"],
        reorderedVisibleKeys: ["a", "c"],
      }),
    ).toBe(true);
  });
});

describe("mergeWithRemainder", () => {
  it("rewrites only the slots the visible keys occupy, leaving hidden keys in place", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["a", "x", "b", "y"],
        reorderedVisibleKeys: ["b", "a"],
      }),
    ).toEqual(["b", "x", "a", "y"]);
  });

  it("keeps unknown current keys when no visible keys are reordered", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["stale", "hidden"],
        reorderedVisibleKeys: [],
      }),
    ).toEqual(["stale", "hidden"]);
  });

  it("does not demote a hidden leading key when the visible rows are reordered", () => {
    // A host filter hides "hidden"; dragging the two visible rows must not move it to the tail.
    expect(
      mergeWithRemainder({
        currentOrder: ["hidden", "a", "b"],
        reorderedVisibleKeys: ["b", "a"],
      }),
    ).toEqual(["hidden", "b", "a"]);
  });

  it("keeps a hidden trailing key last rather than hoisting the visible rows over it", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["a", "b", "hidden"],
        reorderedVisibleKeys: ["b", "a"],
      }),
    ).toEqual(["b", "a", "hidden"]);
  });

  it("appends a visible key the stored order has never recorded", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["hidden", "b"],
        reorderedVisibleKeys: ["fresh", "b"],
      }),
    ).toEqual(["hidden", "fresh", "b"]);
  });
});

describe("memberOrderAfterMove", () => {
  const movedMemberKey = "srv:wks-b#/repo/moved";

  it("inserts the moved project where it was dropped in a remembered order", () => {
    expect(
      memberOrderAfterMove({
        storedOrder: ["srv:wks-b#/a", "srv:wks-b#/b", "srv:wks-b#/c"],
        baselineMemberKeys: [],
        movedMemberKey,
        dropOnMemberKey: "srv:wks-b#/b",
      }),
    ).toEqual(["srv:wks-b#/a", movedMemberKey, "srv:wks-b#/b", "srv:wks-b#/c"]);
  });

  it("seeds the order from the target's current rows when it has never been dragged", () => {
    // Without the seed there is nothing to insert into and the alphabetical baseline wins.
    expect(
      memberOrderAfterMove({
        storedOrder: [],
        baselineMemberKeys: ["srv:wks-b#/a", "srv:wks-b#/b"],
        movedMemberKey,
        dropOnMemberKey: "srv:wks-b#/a",
      }),
    ).toEqual([movedMemberKey, "srv:wks-b#/a", "srv:wks-b#/b"]);
  });

  it("appends for a drop on the bare workspace row, which names no slot", () => {
    expect(
      memberOrderAfterMove({
        storedOrder: ["srv:wks-b#/a", "srv:wks-b#/b"],
        baselineMemberKeys: [],
        movedMemberKey,
        dropOnMemberKey: null,
      }),
    ).toEqual(["srv:wks-b#/a", "srv:wks-b#/b", movedMemberKey]);
  });

  it("appends when the dropped-on row is gone by the time the move lands", () => {
    expect(
      memberOrderAfterMove({
        storedOrder: ["srv:wks-b#/a"],
        baselineMemberKeys: [],
        movedMemberKey,
        dropOnMemberKey: "srv:wks-b#/vanished",
      }),
    ).toEqual(["srv:wks-b#/a", movedMemberKey]);
  });

  it("does not duplicate the moved key when the target order already lists it", () => {
    expect(
      memberOrderAfterMove({
        storedOrder: [movedMemberKey, "srv:wks-b#/a"],
        baselineMemberKeys: [],
        movedMemberKey,
        dropOnMemberKey: "srv:wks-b#/a",
      }),
    ).toEqual([movedMemberKey, "srv:wks-b#/a"]);
  });
});
