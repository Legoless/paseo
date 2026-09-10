// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { TitlebarDragRegion } from "./titlebar-drag-region";
import * as layout from "@/constants/layout";
import * as platform from "@/constants/platform";

describe("TitlebarDragRegion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when not in Electron runtime", () => {
    vi.spyOn(platform, "isNative", "get").mockReturnValue(false);
    vi.spyOn(layout, "getIsElectronRuntime").mockReturnValue(false);

    const { container } = render(<TitlebarDragRegion />);
    expect(container.firstChild).toBeNull();
  });

  it("omits the top-edge resizer on macOS to avoid non-draggable dead zones", () => {
    vi.spyOn(platform, "isNative", "get").mockReturnValue(false);
    vi.spyOn(layout, "getIsElectronRuntime").mockReturnValue(true);
    vi.spyOn(layout, "getIsElectronRuntimeMac").mockReturnValue(true);

    const { container } = render(<TitlebarDragRegion />);
    const divs = container.querySelectorAll("div");
    // On macOS, only the drag overlay should be rendered (1 div with drag region, 0 resizers)
    expect(divs).toHaveLength(1);
    const region =
      divs[0].style.getPropertyValue("-webkit-app-region") ||
      (divs[0].style as unknown as { WebkitAppRegion?: string }).WebkitAppRegion;
    expect(region).toBe("drag");
  });

  it("includes the top-edge resizer on non-macOS (Windows/Linux) for window resizing", () => {
    vi.spyOn(platform, "isNative", "get").mockReturnValue(false);
    vi.spyOn(layout, "getIsElectronRuntime").mockReturnValue(true);
    vi.spyOn(layout, "getIsElectronRuntimeMac").mockReturnValue(false);

    const { container } = render(<TitlebarDragRegion />);
    const divs = container.querySelectorAll("div");
    // On Windows/Linux, both the drag overlay and the top resizer should be rendered
    expect(divs).toHaveLength(2);
    const dragRegion =
      divs[0].style.getPropertyValue("-webkit-app-region") ||
      (divs[0].style as unknown as { WebkitAppRegion?: string }).WebkitAppRegion;
    expect(dragRegion).toBe("drag");

    const resizerRegion =
      divs[1].style.getPropertyValue("-webkit-app-region") ||
      (divs[1].style as unknown as { WebkitAppRegion?: string }).WebkitAppRegion;
    expect(resizerRegion).toBe("no-drag");
    expect(divs[1].style.height).toBe("4px");
  });
});
