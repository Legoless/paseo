import { resolveAssistantImageSource } from "@/utils/assistant-image-source";
import { normalizeWorkspaceFileLocation, type WorkspaceFileLocation } from "@/workspace/file-open";

export function resolveArtifactFileLocation(input: {
  source: string;
  workspaceRoot: string;
  fallbackRoot?: string;
}): WorkspaceFileLocation | null {
  const resolution = resolveAssistantImageSource(input);
  // With a fallback the image may live outside the workspace, where a file tab cannot follow; the
  // viewer shows whichever file actually loaded.
  if (resolution?.kind !== "file_rpc" || resolution.fallback) {
    return null;
  }
  return normalizeWorkspaceFileLocation({ path: resolution.path });
}
