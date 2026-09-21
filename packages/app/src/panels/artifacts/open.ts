import { resolveAssistantImageSource } from "@/utils/assistant-image-source";
import { normalizeWorkspaceFileLocation, type WorkspaceFileLocation } from "@/workspace/file-open";

export function resolveArtifactFileLocation(input: {
  source: string;
  workspaceRoot: string;
}): WorkspaceFileLocation | null {
  const resolution = resolveAssistantImageSource({
    source: input.source,
    workspaceRoot: input.workspaceRoot,
  });
  if (resolution?.kind !== "file_rpc") {
    return null;
  }
  return normalizeWorkspaceFileLocation({ path: resolution.path });
}
