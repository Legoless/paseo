import {
  useAddProjectFlowStore,
  type AddProjectFlowTargetWorkspace,
} from "@/stores/add-project-flow-store";

export function useOpenAddProject(): (
  preferredHostId?: string,
  options?: { targetWorkspace?: AddProjectFlowTargetWorkspace },
) => void {
  return useAddProjectFlowStore((state) => state.open);
}
