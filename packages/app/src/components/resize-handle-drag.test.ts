import { afterEach, describe, expect, it, vi } from "vitest";
import { startResizeHandleDrag } from "@/components/resize-handle-drag";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startResizeHandleDrag", () => {
  it("previews the first move immediately and coalesces the rest onto one frame", () => {
    const preview = vi.fn();
    const commit = vi.fn();
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      pending.delete(id);
    });
    const drag = startResizeHandleDrag({
      sizes: [0.5, 0.5],
      index: 0,
      preview,
      commit,
    });

    drag.move(0.05);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0]?.[0][0]).toBeCloseTo(0.55, 10);
    expect(preview.mock.calls[0]?.[0][1]).toBeCloseTo(0.45, 10);

    drag.move(0.08);
    drag.move(0.1);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(1);

    const frame = [...pending.values()][0];
    pending.clear();
    frame?.(0);

    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview.mock.calls[1]?.[0][0]).toBeCloseTo(0.6, 10);
    expect(preview.mock.calls[1]?.[0][1]).toBeCloseTo(0.4, 10);
    expect(commit).not.toHaveBeenCalled();

    drag.finish();

    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]?.[0][0]).toBeCloseTo(0.6, 10);
    expect(commit.mock.calls[0]?.[0][1]).toBeCloseTo(0.4, 10);
  });

  it("commits the latest size without waiting for a pending frame", () => {
    const preview = vi.fn();
    const commit = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (_callback: FrameRequestCallback) => 1);
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const drag = startResizeHandleDrag({
      sizes: [0.5, 0.5],
      index: 0,
      preview,
      commit,
    });

    drag.move(0.05);
    drag.move(0.2);
    drag.finish();

    expect(cancel).toHaveBeenCalledWith(1);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]?.[0][0]).toBeCloseTo(0.7, 10);
  });
});
