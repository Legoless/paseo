import { computeResizeHandleSizes } from "@/components/resize-handle-sizes";

interface StartResizeHandleDragInput {
  sizes: number[];
  index: number;
  preview: (sizes: number[]) => void;
  commit: (sizes: number[]) => void;
}

export interface ResizeHandleDrag {
  move: (deltaRatio: number) => void;
  finish: () => void;
}

export function startResizeHandleDrag({
  sizes,
  index,
  preview,
  commit,
}: StartResizeHandleDragInput): ResizeHandleDrag {
  let pendingSizes: number[] | null = null;
  let previewed = false;
  let frame: number | null = null;

  function cancelPreviewFrame() {
    if (frame === null || typeof cancelAnimationFrame !== "function") {
      frame = null;
      return;
    }
    cancelAnimationFrame(frame);
    frame = null;
  }

  function flushPreview() {
    frame = null;
    if (pendingSizes) {
      preview(pendingSizes);
    }
  }

  return {
    move(deltaRatio) {
      pendingSizes = computeResizeHandleSizes({ sizes, index, deltaRatio });
      if (!previewed) {
        previewed = true;
        preview(pendingSizes);
        return;
      }
      if (typeof requestAnimationFrame !== "function") {
        preview(pendingSizes);
        return;
      }
      if (frame !== null) {
        return;
      }
      frame = requestAnimationFrame(flushPreview);
    },
    finish() {
      cancelPreviewFrame();
      if (pendingSizes) {
        commit(pendingSizes);
        pendingSizes = null;
      }
    },
  };
}
