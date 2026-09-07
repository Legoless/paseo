import type { ComboboxOptionModel } from "@/components/ui/combobox-options";
import type { WorkspaceMemberDescriptor } from "@/stores/session-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { shortenPath } from "@/utils/shorten-path";

export interface WorkspaceProjectPickerOption {
  cwd: string;
  label: string;
  path: string;
}

export function hasWorkspaceProjectRecord(member: WorkspaceMemberDescriptor): boolean {
  return member.projectDisplayName !== member.projectId;
}

export function buildWorkspaceProjectPickerOptions(
  members: WorkspaceMemberDescriptor[],
): WorkspaceProjectPickerOption[] {
  return members.filter(hasWorkspaceProjectRecord).map((member) => ({
    cwd: member.workspaceDirectory,
    label: member.projectCustomName ?? member.projectDisplayName,
    path: shortenPath(member.workspaceDirectory),
  }));
}

export function orderWorkspaceProjectPickerOptions(
  options: WorkspaceProjectPickerOption[],
  memberOrder: readonly string[],
): WorkspaceProjectPickerOption[] {
  if (options.length <= 1 || memberOrder.length === 0) return options;
  const keyByCwd = new Map(options.map((option) => [option.cwd, option]));
  const storedOrder = memberOrder
    .map((key) => key.slice(key.indexOf("#") + 1))
    .filter((cwd) => keyByCwd.has(cwd));
  if (storedOrder.length === 0) return options;
  const storedSet = new Set(storedOrder);
  const unstored = options.filter((option) => !storedSet.has(option.cwd));
  return [
    ...unstored,
    ...storedOrder.flatMap((cwd) => {
      const option = keyByCwd.get(cwd);
      return option ? [option] : [];
    }),
  ];
}

export function useWorkspaceMemberOrder(
  serverId: string | null,
  workspaceId: string | null,
): readonly string[] | null {
  return useSidebarOrderStore((state) => {
    if (!serverId?.trim() || !workspaceId?.trim()) return null;
    return state.memberOrderByWorkspace[`${serverId}:${workspaceId}`] ?? null;
  });
}

export function toWorkspaceProjectComboboxOptions(
  options: WorkspaceProjectPickerOption[],
): ComboboxOptionModel[] {
  return options.map((option) => ({
    id: option.cwd,
    label: option.label,
    description: option.path,
    kind: "directory" as const,
  }));
}
