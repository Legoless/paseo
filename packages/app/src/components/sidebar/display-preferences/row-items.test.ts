import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_ROW_ITEMS,
  isChecksHiddenByLegacyRowItem,
  parseSidebarRowItems,
} from "./row-items";

describe("parseSidebarRowItems", () => {
  it.each([[true], [false]])("ignores the removed services item when stored as %s", (services) => {
    expect(parseSidebarRowItems({ services, host: false })).toEqual({
      branch: false,
      project: false,
      host: false,
      changeRequest: true,
      labels: true,
    });
  });

  it("shows operational metadata but hides identity badges by default", () => {
    expect(DEFAULT_SIDEBAR_ROW_ITEMS).toEqual({
      branch: false,
      project: false,
      host: true,
      changeRequest: true,
      labels: true,
    });
  });

  it("applies stored overrides", () => {
    expect(parseSidebarRowItems({ branch: true, labels: false })).toEqual({
      ...DEFAULT_SIDEBAR_ROW_ITEMS,
      branch: true,
      labels: false,
    });
  });

  it("leaves items absent from storage at their default", () => {
    // An absent key takes the item's explicit product default.
    expect(parseSidebarRowItems({ host: false })).toEqual({
      ...DEFAULT_SIDEBAR_ROW_ITEMS,
      host: false,
    });
  });

  it("ignores unknown keys and non-boolean values", () => {
    expect(
      parseSidebarRowItems({ checks: false, nonsense: false, branch: null, host: false }),
    ).toEqual({ ...DEFAULT_SIDEBAR_ROW_ITEMS, host: false });
  });

  it.each([[null], [undefined], ["diff"], [42], [["services"]]])(
    "falls back to defaults for %s",
    (value) => {
      expect(parseSidebarRowItems(value)).toEqual(DEFAULT_SIDEBAR_ROW_ITEMS);
    },
  );

  it.each([[true], [false]])("ignores the removed scripts item when stored as %s", (scripts) => {
    expect(parseSidebarRowItems({ scripts, host: false })).toEqual({
      ...DEFAULT_SIDEBAR_ROW_ITEMS,
      host: false,
    });
  });

  it("ignores both removed item names when stored together", () => {
    expect(parseSidebarRowItems({ scripts: false, services: true })).toEqual(
      DEFAULT_SIDEBAR_ROW_ITEMS,
    );
  });

  it("does not hand back the shared default object", () => {
    const parsed = parseSidebarRowItems({ host: false });
    expect(parsed).not.toBe(DEFAULT_SIDEBAR_ROW_ITEMS);
    expect(DEFAULT_SIDEBAR_ROW_ITEMS.host).toBe(true);
  });
});

describe("isChecksHiddenByLegacyRowItem", () => {
  it("reports the one stored shape that means checks were switched off", () => {
    expect(isChecksHiddenByLegacyRowItem({ checks: false })).toBe(true);
  });

  it.each([[{ checks: true }], [{ services: false }], [{}], [null], ["checks"], [["checks"]]])(
    "leaves %s to the new setting's default",
    (value) => {
      expect(isChecksHiddenByLegacyRowItem(value)).toBe(false);
    },
  );
});
