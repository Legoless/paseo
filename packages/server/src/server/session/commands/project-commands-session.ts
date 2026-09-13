import { realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../../workspace-registry.js";
import {
  CUSTOM_COMMANDS_FILENAME,
  PROJECT_PASEO_DIRNAME,
  readCustomCommandsFile,
} from "../../custom-commands.js";

export interface ProjectCommandsSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface ProjectCommandsSessionOptions {
  host: ProjectCommandsSessionHost;
  projectRegistry: Pick<ProjectRegistry, "list">;
  workspaceRegistry: Pick<WorkspaceRegistry, "list">;
  logger: pino.Logger;
}

/**
 * Serves a project's `.paseo-neo/commands.json` to clients. Resolves the request's pane cwd
 * against the known (non-archived) project roots — accepting a trailing slash or a symlink via
 * realpath — and, when the cwd is a known worktree member, against that worktree's main checkout,
 * which is where the project's commands file lives. An unknown cwd is an empty answer, not an
 * error: panes can point at directories the daemon has never registered.
 */
export class ProjectCommandsSession {
  private readonly host: ProjectCommandsSessionHost;
  private readonly projectRegistry: Pick<ProjectRegistry, "list">;
  private readonly workspaceRegistry: Pick<WorkspaceRegistry, "list">;
  private readonly logger: pino.Logger;

  constructor(options: ProjectCommandsSessionOptions) {
    this.host = options.host;
    this.projectRegistry = options.projectRegistry;
    this.workspaceRegistry = options.workspaceRegistry;
    this.logger = options.logger;
  }

  async handleCommandsProjectListRequest(
    msg: Extract<SessionInboundMessage, { type: "commands.project.list.request" }>,
  ): Promise<void> {
    const projectRoot = await this.resolveKnownProjectRoot(msg.cwd);
    if (!projectRoot) {
      this.host.emit({
        type: "commands.project.list.response",
        payload: { requestId: msg.requestId, commands: [], sourcePath: null, error: null },
      });
      return;
    }

    const sourcePath = join(projectRoot, PROJECT_PASEO_DIRNAME, CUSTOM_COMMANDS_FILENAME);
    const result = readCustomCommandsFile(sourcePath);
    switch (result.status) {
      case "missing":
        this.host.emit({
          type: "commands.project.list.response",
          payload: { requestId: msg.requestId, commands: [], sourcePath: null, error: null },
        });
        return;
      case "invalid":
        this.logger.warn(
          { sourcePath, requestId: msg.requestId, error: result.error },
          "Project commands file is unusable",
        );
        this.host.emit({
          type: "commands.project.list.response",
          payload: { requestId: msg.requestId, commands: [], sourcePath, error: result.error },
        });
        return;
      case "loaded":
        this.host.emit({
          type: "commands.project.list.response",
          payload: {
            requestId: msg.requestId,
            commands: result.commands,
            sourcePath,
            error: null,
          },
        });
        return;
    }
  }

  private async resolveKnownProjectRoot(cwd: string): Promise<string | null> {
    const requestedRoot = canonicalizeConfigRoot(cwd);
    const projects = await this.projectRegistry.list();
    for (const project of projects) {
      if (project.archivedAt !== null) {
        continue;
      }
      const projectRoot = canonicalizeConfigRoot(project.rootPath);
      if (requestedRoot === projectRoot) {
        return projectRoot;
      }
    }
    for (const workspace of await this.workspaceRegistry.list()) {
      if (workspace.archivedAt !== null) {
        continue;
      }
      for (const member of workspace.members) {
        if (member.mainRepoRoot === null) {
          continue;
        }
        const memberRoots = [member.cwd, member.worktreeRoot]
          .filter((root): root is string => root !== null)
          .map(canonicalizeConfigRoot);
        if (memberRoots.includes(requestedRoot)) {
          return canonicalizeConfigRoot(member.mainRepoRoot);
        }
      }
    }
    return null;
  }
}

function canonicalizeConfigRoot(root: string): string {
  const resolved = resolve(root);
  try {
    return stripTrailingPathSeparators(realpathSync(resolved));
  } catch {
    return stripTrailingPathSeparators(resolved);
  }
}

function stripTrailingPathSeparators(path: string): string {
  let normalized = path;
  while (normalized.length > 1 && normalized.endsWith(sep)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
