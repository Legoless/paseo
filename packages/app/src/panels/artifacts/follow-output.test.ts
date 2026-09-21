import { describe, expect, it } from "vitest";
import { distanceFromBottom, resolveArtifactFollowOutput } from "./follow-output";

describe("resolveArtifactFollowOutput", () => {
  it("unpins after an upward scroll away from the tail", () => {
    expect(
      resolveArtifactFollowOutput({
        following: true,
        distanceFromBottom: 80,
        scrolledUp: true,
      }),
    ).toBe(false);
  });

  it("pins again when the viewport returns to the tail", () => {
    expect(
      resolveArtifactFollowOutput({
        following: false,
        distanceFromBottom: 12,
        scrolledUp: false,
      }),
    ).toBe(true);
  });

  it("stays pinned while new content grows at the bottom", () => {
    expect(
      resolveArtifactFollowOutput({
        following: true,
        distanceFromBottom: 0,
        scrolledUp: false,
      }),
    ).toBe(true);
  });
});

describe("distanceFromBottom", () => {
  it("measures remaining room below the viewport", () => {
    expect(
      distanceFromBottom({
        contentHeight: 800,
        viewportHeight: 400,
        offsetY: 350,
      }),
    ).toBe(50);
  });
});
