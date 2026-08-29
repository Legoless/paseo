import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";

export interface WorkspaceMemberAddDirectorySource {
  kind: "directory";
  path: string;
  projectId?: string;
}

export interface WorkspaceMembersClient {
  addWorkspaceMember: DaemonClient["addWorkspaceMember"];
  removeWorkspaceMember: DaemonClient["removeWorkspaceMember"];
}

export type WorkspaceMemberOperationResult =
  | { ok: true; workspace: WorkspaceDescriptorPayload }
  | { ok: false; errorCode: string | null; error: string | null };

export async function addWorkspaceMemberDirectory(input: {
  client: WorkspaceMembersClient;
  workspaceId: string;
  source: WorkspaceMemberAddDirectorySource;
}): Promise<WorkspaceMemberOperationResult> {
  const payload = await input.client.addWorkspaceMember(input.workspaceId, input.source);
  if (payload.error || !payload.workspace) {
    return { ok: false, errorCode: payload.errorCode ?? null, error: payload.error };
  }
  return { ok: true, workspace: payload.workspace };
}

export async function removeWorkspaceMember(input: {
  client: WorkspaceMembersClient;
  workspaceId: string;
  cwd: string;
}): Promise<WorkspaceMemberOperationResult> {
  const payload = await input.client.removeWorkspaceMember(input.workspaceId, input.cwd);
  if (payload.error || !payload.workspace) {
    return { ok: false, errorCode: payload.errorCode ?? null, error: payload.error };
  }
  return { ok: true, workspace: payload.workspace };
}
