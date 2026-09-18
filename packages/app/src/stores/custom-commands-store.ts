import { create } from "zustand";
import type { CustomCommand } from "@getpaseo/protocol/custom-commands";

/**
 * Daemon-served custom commands, mirrored here so the global keyboard handler can resolve them
 * without a fetch. The workspace commands dropdown is the fetcher: it writes project commands
 * (keyed `serverId:cwd`) and the daemon-config global commands (keyed `serverId`) on every
 * successful read. Runtime-only — never persisted; a relaunch refetches.
 */
export interface ProjectCommandsEntry {
  project: CustomCommand[];
  projectError: string | null;
  sourcePath: string | null;
}

export interface GlobalCommandsEntry {
  global: CustomCommand[];
  globalErrors: string[];
}

interface CustomCommandsState {
  projectByScopeKey: Record<string, ProjectCommandsEntry>;
  globalByServerId: Record<string, GlobalCommandsEntry>;
  setProjectCommands: (input: {
    serverId: string;
    cwd: string;
    project: CustomCommand[];
    projectError: string | null;
    sourcePath: string | null;
  }) => void;
  clearProjectCommands: (input: { serverId: string; cwd: string }) => void;
  setGlobalCommands: (input: {
    serverId: string;
    global: CustomCommand[];
    globalErrors: string[];
  }) => void;
}

export function customCommandsScopeKey(serverId: string, cwd: string): string {
  return `${serverId}:${cwd}`;
}

/** Project commands shadow global ones by id and always sort first. */
export function mergeCustomCommands(input: {
  project: CustomCommand[];
  global: CustomCommand[];
}): CustomCommand[] {
  const seen = new Set<string>();
  const merged: CustomCommand[] = [];
  for (const command of [...input.project, ...input.global]) {
    if (seen.has(command.id)) {
      continue;
    }
    seen.add(command.id);
    merged.push(command);
  }
  return merged;
}

const EMPTY_PROJECT_ENTRY: ProjectCommandsEntry = {
  project: [],
  projectError: null,
  sourcePath: null,
};
const EMPTY_GLOBAL_ENTRY: GlobalCommandsEntry = { global: [], globalErrors: [] };
const EMPTY_COMMANDS: CustomCommand[] = [];

export const useCustomCommandsStore = create<CustomCommandsState>()((set) => ({
  projectByScopeKey: {},
  globalByServerId: {},

  setProjectCommands: ({ serverId, cwd, project, projectError, sourcePath }) => {
    const scopeKey = customCommandsScopeKey(serverId, cwd);
    set((state) => ({
      projectByScopeKey: {
        ...state.projectByScopeKey,
        [scopeKey]: { project, projectError, sourcePath },
      },
    }));
  },

  clearProjectCommands: ({ serverId, cwd }) => {
    const scopeKey = customCommandsScopeKey(serverId, cwd);
    set((state) => {
      if (!(scopeKey in state.projectByScopeKey)) {
        return state;
      }
      const next = { ...state.projectByScopeKey };
      delete next[scopeKey];
      return { projectByScopeKey: next };
    });
  },

  setGlobalCommands: ({ serverId, global, globalErrors }) => {
    set((state) => ({
      globalByServerId: {
        ...state.globalByServerId,
        [serverId]: { global, globalErrors },
      },
    }));
  },
}));

export function selectProjectCommandsEntry(
  state: Pick<CustomCommandsState, "projectByScopeKey">,
  serverId: string,
  cwd: string | null,
): ProjectCommandsEntry {
  if (!cwd) {
    return EMPTY_PROJECT_ENTRY;
  }
  return state.projectByScopeKey[customCommandsScopeKey(serverId, cwd)] ?? EMPTY_PROJECT_ENTRY;
}

export function selectGlobalCommandsEntry(
  state: Pick<CustomCommandsState, "globalByServerId">,
  serverId: string,
): GlobalCommandsEntry {
  return state.globalByServerId[serverId] ?? EMPTY_GLOBAL_ENTRY;
}

/** The merged list the keyboard handler and the settings page resolve shortcuts against. */
export function selectMergedCustomCommands(
  state: Pick<CustomCommandsState, "projectByScopeKey" | "globalByServerId">,
  serverId: string,
  cwd: string | null,
): CustomCommand[] {
  const project = selectProjectCommandsEntry(state, serverId, cwd).project;
  const global = selectGlobalCommandsEntry(state, serverId).global;
  if (project.length === 0 && global.length === 0) {
    return EMPTY_COMMANDS;
  }
  return mergeCustomCommands({ project, global });
}
