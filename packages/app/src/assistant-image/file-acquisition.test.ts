import { describe, expect, it } from "vitest";
import type { AttachmentMetadata } from "@/attachments/types";
import {
  createAssistantImageFileAcquisition,
  type AssistantImageFileAcquisitionPort,
} from "./file-acquisition";

class MemoryFileAcquisitionPort implements AssistantImageFileAcquisitionPort {
  readonly reads: Array<{ cwd: string; path: string }> = [];

  constructor(private readonly missing: ReadonlySet<string> = new Set()) {}

  async readFile(cwd: string, path: string) {
    this.reads.push({ cwd, path });
    if (this.missing.has(path)) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return {
      kind: "image" as const,
      path,
      mime: "image/png",
      size: 4,
      modifiedAt: "1",
      bytes: new Uint8Array([1, 2, 3, 4]),
    };
  }

  async persist(input: { id: string; mimeType: string; fileName: string | null }) {
    return {
      id: input.id,
      mimeType: input.mimeType,
      storageType: "web-indexeddb" as const,
      storageKey: input.id,
      fileName: input.fileName,
      byteSize: 4,
      createdAt: 1,
    } satisfies AttachmentMetadata;
  }
}

describe("assistant image file acquisition", () => {
  it("recreates the same acquisition with a live port after reconnect", async () => {
    const common = {
      resolution: { kind: "file_rpc" as const, cwd: "/workspace", path: "reconnect.png" },
      serverId: "server",
      occurrenceKey: "agent:message:reconnect-image",
      unavailableMessage: "Image unavailable",
    };
    const disconnected = createAssistantImageFileAcquisition({ ...common, port: null });
    const connectedPort = new MemoryFileAcquisitionPort();
    const connected = createAssistantImageFileAcquisition({ ...common, port: connectedPort });

    expect(disconnected?.key).toBe(connected?.key);
    await expect(disconnected?.locate()).rejects.toThrow("Image unavailable");
    await expect(connected?.locate()).resolves.toMatchObject({ mimeType: "image/png" });
    expect(connectedPort.reads).toEqual([{ cwd: "/workspace", path: "reconnect.png" }]);
  });

  const withFallback = {
    resolution: {
      kind: "file_rpc" as const,
      cwd: "/workspace",
      path: "images/paywall.png",
      fallback: { cwd: "~", path: "~/.grok/sessions/%2Fworkspace/s1/images/paywall.png" },
    },
    serverId: "server",
    occurrenceKey: "agent:message:grok-image",
    unavailableMessage: "Image unavailable",
  };

  it("reads the fallback when the workspace has no such image", async () => {
    const port = new MemoryFileAcquisitionPort(new Set(["images/paywall.png"]));
    const acquisition = createAssistantImageFileAcquisition({ ...withFallback, port });

    await expect(acquisition?.locate()).resolves.toMatchObject({ fileName: "paywall.png" });
    expect(port.reads).toEqual([
      { cwd: "/workspace", path: "images/paywall.png" },
      { cwd: "~", path: "~/.grok/sessions/%2Fworkspace/s1/images/paywall.png" },
    ]);
  });

  it("keeps the workspace image when it exists", async () => {
    const port = new MemoryFileAcquisitionPort();
    await createAssistantImageFileAcquisition({ ...withFallback, port })?.locate();
    expect(port.reads).toEqual([{ cwd: "/workspace", path: "images/paywall.png" }]);
  });

  it("reports the workspace error when neither has the image", async () => {
    const port = new MemoryFileAcquisitionPort(
      new Set(["images/paywall.png", "~/.grok/sessions/%2Fworkspace/s1/images/paywall.png"]),
    );
    await expect(
      createAssistantImageFileAcquisition({ ...withFallback, port })?.locate(),
    ).rejects.toThrow("ENOENT: no such file or directory, open 'images/paywall.png'");
  });
});
