import type { FileReadResult } from "@getpaseo/client/internal/daemon-client";
import type { AttachmentMetadata } from "@/attachments/types";
import { getFileNameFromPath } from "@/attachments/utils";
import type { AssistantImageSourceResolution } from "@/utils/assistant-image-source";
import {
  createAssistantImageFileAcquisitionKey,
  createAssistantImageFilePreviewAttachmentId,
} from "./acquisition-cache";

export interface AssistantImageFileAcquisitionPort {
  readFile(cwd: string, path: string): Promise<FileReadResult>;
  persist(input: {
    id: string;
    bytes: Uint8Array;
    mimeType: string;
    fileName: string | null;
  }): Promise<AttachmentMetadata>;
}

export interface AssistantImageAcquisition {
  key: string;
  locate: () => Promise<AttachmentMetadata>;
}

export function createAssistantImageFileAcquisition(input: {
  port: AssistantImageFileAcquisitionPort | null;
  resolution: AssistantImageSourceResolution | null;
  serverId?: string;
  occurrenceKey: string;
  unavailableMessage: string;
}): AssistantImageAcquisition | null {
  if (input.resolution?.kind !== "file_rpc") {
    return null;
  }
  const { port, resolution } = input;
  return {
    key: createAssistantImageFileAcquisitionKey({
      serverId: input.serverId,
      occurrenceKey: input.occurrenceKey,
      cwd: resolution.cwd,
      path: resolution.path,
    }),
    locate: async () => {
      if (!port) {
        throw new Error(input.unavailableMessage);
      }
      const readImage = async (target: { cwd: string; path: string }) => {
        const read = await port.readFile(target.cwd, target.path);
        if (read.kind !== "image") {
          throw new Error(input.unavailableMessage);
        }
        return read;
      };
      let file: Awaited<ReturnType<typeof readImage>>;
      try {
        file = await readImage(resolution);
      } catch (error) {
        // The workspace wins; the fallback only fills in a file the workspace does not have. The
        // tradeoff: a workspace file at the same relative path shadows the fallback's. When both
        // miss, the workspace's error is the one worth showing.
        if (!resolution.fallback) throw error;
        file = await readImage(resolution.fallback).catch(() => {
          throw error;
        });
      }
      return await port.persist({
        id: createAssistantImageFilePreviewAttachmentId({
          serverId: input.serverId,
          occurrenceKey: input.occurrenceKey,
          mimeType: file.mime,
          path: file.path || resolution.path,
          size: file.size,
          modifiedAt: file.modifiedAt,
          contentLength: file.bytes.byteLength,
        }),
        bytes: file.bytes,
        mimeType: file.mime,
        fileName: getFileNameFromPath(file.path || resolution.path),
      });
    },
  };
}
