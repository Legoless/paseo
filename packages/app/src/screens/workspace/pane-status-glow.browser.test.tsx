/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneStatusGlowLayer } from "./pane-status-glow-layer";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

beforeEach(() => vi.stubGlobal("React", React));

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

function mount(bucket: SidebarStateBucket | null, hasStarted = false): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<PaneStatusGlowLayer bucket={bucket} hasStarted={hasStarted} />));
  mounted.push({ root, container });
  return container;
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function glowLayer(container: HTMLDivElement): HTMLElement {
  const layer = container.querySelector('[data-testid="workspace-pane-status-glow"]');
  if (!(layer instanceof HTMLElement)) {
    throw new Error("pane status glow did not render");
  }
  return layer;
}

describe("PaneStatusGlowLayer", () => {
  it("stays off for never-started idle and missing status", () => {
    expect(mount("done").querySelector('[data-testid="workspace-pane-status-glow"]')).toBeNull();
    expect(mount(null).querySelector('[data-testid="workspace-pane-status-glow"]')).toBeNull();
  });

  it("keeps the finished glow after a started agent goes quiet", () => {
    const layer = glowLayer(mount("done", true));
    expect(layer.getAttribute("data-status-glow")).toBe("attention");
    expect(getComputedStyle(layer).borderTopColor).toBe("rgb(41, 159, 81)");
  });

  it.each([
    ["running", "rgb(38, 138, 224)"],
    ["needs_input", "rgb(179, 120, 36)"],
    ["failed", "rgb(241, 46, 47)"],
    ["attention", "rgb(41, 159, 81)"],
  ] as const)("paints the %s pane with the matching status color", (bucket, expectedColor) => {
    const layer = glowLayer(mount(bucket));
    expect(layer.getAttribute("data-status-glow")).toBe(bucket);
    expect(getComputedStyle(layer).borderTopColor).toBe(expectedColor);
  });
});
