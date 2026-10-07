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

  it("reads a markdown path whose spaces were percent-encoded", async () => {
    const encoded = "posts/Porsche%20911%20GT3/generated-instagram-samples/02_side_hotel.jpg";
    const decoded = "posts/Porsche 911 GT3/generated-instagram-samples/02_side_hotel.jpg";
    const port = new MemoryFileAcquisitionPort(new Set([encoded]));
    const acquisition = createAssistantImageFileAcquisition({
      port,
      resolution: {
        kind: "file_rpc",
        cwd: "/Users/legoless/Projects/legoless/Instagram",
        path: encoded,
      },
      serverId: "server",
      occurrenceKey: "agent:message:gt3",
      unavailableMessage: "Image unavailable",
    });

    await expect(acquisition?.locate()).resolves.toMatchObject({ fileName: "02_side_hotel.jpg" });
    expect(port.reads).toEqual([
      { cwd: "/Users/legoless/Projects/legoless/Instagram", path: decoded },
    ]);
  });

  it("decodes a space even when another segment has a bare percent", async () => {
    const encoded = "posts/Porsche%20911%20GT3/100% done.jpg";
    const decoded = "posts/Porsche 911 GT3/100% done.jpg";
    const port = new MemoryFileAcquisitionPort(new Set([encoded]));
    await expect(
      createAssistantImageFileAcquisition({
        port,
        resolution: { kind: "file_rpc", cwd: "/workspace", path: encoded },
        serverId: "server",
        occurrenceKey: "agent:message:gt3-bare-percent",
        unavailableMessage: "Image unavailable",
      })?.locate(),
    ).resolves.toMatchObject({ fileName: "100% done.jpg" });
    expect(port.reads).toEqual([{ cwd: "/workspace", path: decoded }]);
  });

  it("reports the decoded path when every spelling is missing", async () => {
    const encoded = "posts/Porsche%20911%20GT3/missing.jpg";
    const decoded = "posts/Porsche 911 GT3/missing.jpg";
    const port = new MemoryFileAcquisitionPort(new Set([encoded, decoded]));
    await expect(
      createAssistantImageFileAcquisition({
        port,
        resolution: { kind: "file_rpc", cwd: "/workspace", path: encoded },
        serverId: "server",
        occurrenceKey: "agent:message:gt3-missing",
        unavailableMessage: "Image unavailable",
      })?.locate(),
    ).rejects.toThrow(`ENOENT: no such file or directory, open '${decoded}'`);
    expect(port.reads).toEqual([
      { cwd: "/workspace", path: decoded },
      { cwd: "/workspace", path: encoded },
    ]);
  });

  it("keeps a filename that literally contains %20", async () => {
    const path = "/tmp/image%20with%20literal%20percent.png";
    const decoded = "/tmp/image with literal percent.png";
    const port = new MemoryFileAcquisitionPort(new Set([decoded]));
    await createAssistantImageFileAcquisition({
      port,
      resolution: { kind: "file_rpc", cwd: "/", path },
      serverId: "server",
      occurrenceKey: "agent:message:literal-percent",
      unavailableMessage: "Image unavailable",
    })?.locate();
    expect(port.reads).toEqual([
      { cwd: "/", path: decoded },
      { cwd: "/", path },
    ]);
  });

  it("does not decode an encoded slash or a dot segment into another path", async () => {
    const sessionPath = "~/.grok/sessions/%2Fworkspace/s1/images/paywall.png";
    const traversalPath = "posts/%2e%2e/secret.jpg";
    const port = new MemoryFileAcquisitionPort(new Set([sessionPath, traversalPath]));

    await expect(
      createAssistantImageFileAcquisition({
        port,
        resolution: { kind: "file_rpc", cwd: "~", path: sessionPath },
        serverId: "server",
        occurrenceKey: "agent:message:session-slashes",
        unavailableMessage: "Image unavailable",
      })?.locate(),
    ).rejects.toThrow(`ENOENT: no such file or directory, open '${sessionPath}'`);
    await expect(
      createAssistantImageFileAcquisition({
        port,
        resolution: { kind: "file_rpc", cwd: "/workspace", path: traversalPath },
        serverId: "server",
        occurrenceKey: "agent:message:dot-segment",
        unavailableMessage: "Image unavailable",
      })?.locate(),
    ).rejects.toThrow(`ENOENT: no such file or directory, open '${traversalPath}'`);
    expect(port.reads).toEqual([
      { cwd: "~", path: sessionPath },
      { cwd: "/workspace", path: traversalPath },
    ]);
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
