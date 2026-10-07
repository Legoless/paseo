import { localFileSourceToPath, markdownFilePathCandidates } from "@/attachments/utils";
import {
  resolveFilePreviewReadTarget,
  type FilePreviewReadTarget,
} from "@/file-explorer/preview-target";
import { isAbsolutePath } from "@/utils/path";

export type AssistantImageSourceResolution =
  | { kind: "direct"; uri: string }
  | {
      kind: "file_rpc";
      cwd: string;
      path: string;
      /** The destination as written, when percent-decoding changed the path that is opened. */
      literalPath?: string;
      /** Where a relative path is read when the workspace has no such file. */
      fallback?: FilePreviewReadTarget & { literalPath?: string };
    };

/**
 * The folder an agent's relative image paths may point into besides its workspace. Grok saves the
 * images it shows into its session folder and names them by session-relative path (`images/1.jpg`),
 * as its image tool instructs, so read from the workspace alone they are missing.
 *
 * ponytail: assumes the default `~/.grok` home and that Grok's folder encoding matches
 * encodeURIComponent; a `GROK_HOME` override or a cwd with `!'()*` misses. Publish the folder from
 * the daemon, which sees the provider env, if that matters.
 */
export function resolveAgentImageFallbackRoot(agent: {
  provider?: string | null;
  cwd?: string | null;
  runtimeInfo?: { sessionId?: string | null } | null;
  persistence?: { sessionId?: string | null } | null;
}): string | null {
  const cwd = agent.cwd?.trim();
  // A stored agent's pushed state carries no runtime info, but its persistence keeps the session.
  const sessionId = (agent.runtimeInfo?.sessionId ?? agent.persistence?.sessionId)?.trim();
  if (agent.provider !== "grok" || !cwd || !sessionId) {
    return null;
  }
  return `~/.grok/sessions/${encodeURIComponent(cwd)}/${sessionId}`;
}

export function resolveAssistantImageSource(input: {
  source: string;
  workspaceRoot?: string;
  fallbackRoot?: string;
}): AssistantImageSourceResolution | null {
  const source = input.source.trim();
  if (!source) {
    return null;
  }

  if (/^(https?:|data:|blob:)/i.test(source)) {
    return { kind: "direct", uri: source };
  }

  const literal = localFileSourceToPath(source);
  const path = markdownFilePathCandidates(literal)[0] ?? literal;
  const readTarget = resolveFilePreviewReadTarget({
    path,
    workspaceRoot: input.workspaceRoot,
  });
  if (!readTarget) {
    return null;
  }

  // Scoped to the fallback folder itself, so a relative path cannot climb out of it and a symlinked
  // home folder still passes the daemon's root check.
  const isRelative = !isAbsolutePath(path) && !path.startsWith("~");
  const relativeLiteral = literal.replace(/^\.[\\/]/, "");
  const relativePath = path.replace(/^\.[\\/]/, "");
  const fallback =
    input.fallbackRoot && isRelative
      ? {
          cwd: input.fallbackRoot,
          path: relativePath,
          ...(relativeLiteral !== relativePath ? { literalPath: relativeLiteral } : {}),
        }
      : null;
  return {
    kind: "file_rpc",
    cwd: readTarget.cwd,
    path: readTarget.path,
    ...(literal !== readTarget.path ? { literalPath: literal } : {}),
    ...(fallback ? { fallback } : {}),
  };
}
