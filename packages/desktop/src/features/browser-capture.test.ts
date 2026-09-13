import { describe, expect, it, vi } from "vitest";
import {
  createBrowserCaptureService,
  type BrowserCaptureGuest,
  type BrowserCaptureImage,
} from "./browser-capture.js";

function image(dataUrl = "data:image/png;base64,capture"): BrowserCaptureImage {
  return { isEmpty: () => false, toDataURL: () => dataUrl };
}

function harness(guest: BrowserCaptureGuest | null = null) {
  const clipboard = {
    write: vi.fn(async (_entries: Record<string, string | Uint8Array>) => {}),
    writeText: vi.fn(async (_text: string) => {}),
  };
  const warn = vi.fn();
  return {
    clipboard,
    warn,
    service: createBrowserCaptureService({
      findGuest: () => guest,
      clipboard,
      warn,
    }),
  };
}

describe("browser capture service", () => {
  it("validates and rounds guest-relative bounds before capture", async () => {
    const capturePage = vi.fn(async () => image());
    const { service } = harness({ isDestroyed: () => false, capturePage });

    await expect(
      service.capture({
        browserId: "browser-1",
        hostWebContentsId: 42,
        rect: { x: -2.4, y: 8.6, width: 20.2, height: 10.8 },
      }),
    ).resolves.toBe("data:image/png;base64,capture");
    expect(capturePage).toHaveBeenCalledWith({ x: 0, y: 9, width: 20, height: 11 });
  });

  it("rejects invalid or unavailable captures without touching the guest", async () => {
    const capturePage = vi.fn(async () => image());
    const { service } = harness({ isDestroyed: () => false, capturePage });

    await expect(
      service.capture({ browserId: "browser-1", hostWebContentsId: 42, rect: { width: 0 } }),
    ).resolves.toBeNull();
    expect(capturePage).not.toHaveBeenCalled();
  });

  it("writes text and a decoded image to the clipboard atomically", async () => {
    const { service, clipboard } = harness();
    await expect(
      service.copy({ text: "button", imageDataUrl: "data:image/png;base64,aGVsbG8=" }),
    ).resolves.toBe(true);
    const entries = clipboard.write.mock.calls[0][0];
    expect(entries["text/plain"]).toBe("button");
    expect(Buffer.from(entries["image/png"] as ArrayBuffer).toString()).toBe("hello");
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("writes image-only and text-only payloads through the matching clipboard path", async () => {
    const { service, clipboard } = harness();

    await expect(service.copy({ imageDataUrl: "data:image/jpeg;base64,aGVsbG8=" })).resolves.toBe(
      true,
    );
    const imageEntries = clipboard.write.mock.calls[0][0];
    expect(Object.keys(imageEntries)).toEqual(["image/jpeg"]);
    expect(Buffer.from(imageEntries["image/jpeg"] as ArrayBuffer).toString()).toBe("hello");

    await expect(service.copy({ text: "just text" })).resolves.toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith("just text");
  });

  it("refuses empty payloads and drops undecodable images", async () => {
    const { service, clipboard, warn } = harness();

    await expect(service.copy({})).resolves.toBe(false);
    await expect(service.copy({ imageDataUrl: "data:image/png;base64," })).resolves.toBe(false);
    expect(clipboard.write).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
