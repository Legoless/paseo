import { useSessionStore } from "@/stores/session-store";

/**
 * Feature gate for custom commands. Absent on daemons before the gate existed, which reads
 * exactly like "host has no commands": hide the dropdown, bind no shortcuts.
 */
export function useCustomCommandsSupported(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.customCommands === true,
  );
}
