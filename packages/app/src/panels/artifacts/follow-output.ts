export const ARTIFACT_NEAR_BOTTOM_THRESHOLD = 48;

export function distanceFromBottom(input: {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
}): number {
  return Math.max(0, input.contentHeight - input.viewportHeight - input.offsetY);
}

export function resolveArtifactFollowOutput(input: {
  following: boolean;
  distanceFromBottom: number;
  scrolledUp: boolean;
  threshold?: number;
}): boolean {
  const threshold = input.threshold ?? ARTIFACT_NEAR_BOTTOM_THRESHOLD;
  if (input.following && input.scrolledUp && input.distanceFromBottom > threshold) {
    return false;
  }
  if (!input.following && input.distanceFromBottom <= threshold) {
    return true;
  }
  return input.following;
}
