import {
  addWorkspaceMemberDirectory,
  type WorkspaceMembersClient,
} from "@/workspaces/workspace-members";

/**
 * Completion branch of the add-project flow when it targets a workspace: the
 * picked directory joins the workspace as a project member instead of becoming
 * a standalone project.
 */

export type AddWorkspaceMemberCompletion = { ok: true } | { ok: false; message: string };

export function workspaceMemberErrorMessage(input: {
  errorCode: string | null;
  error: string | null;
}): string {
  if (input.errorCode === "duplicate_member") {
    return "This project is already in the workspace";
  }
  if (input.errorCode === "directory_not_found") {
    return "Directory not found";
  }
  return input.error ?? "Unable to add project to workspace";
}

export async function addWorkspaceMemberCompletion(input: {
  client: WorkspaceMembersClient | null;
  workspaceId: string;
  path: string;
}): Promise<AddWorkspaceMemberCompletion> {
  if (!input.client) {
    return { ok: false, message: "Host is unavailable" };
  }
  const result = await addWorkspaceMemberDirectory({
    client: input.client,
    workspaceId: input.workspaceId,
    source: { kind: "directory", path: input.path },
  });
  if (!result.ok) {
    return { ok: false, message: workspaceMemberErrorMessage(result) };
  }
  return { ok: true };
}
