import { describe, expect, it } from "vitest";
import { resolveArtifactFileLocation } from "./open";

describe("resolveArtifactFileLocation", () => {
  it("opens local screenshot paths as file tabs", () => {
    expect(
      resolveArtifactFileLocation({
        source: "/tmp/paseo-codex-screenshot.png",
        workspaceRoot: "/Users/test/project",
      }),
    ).toEqual({ path: "/tmp/paseo-codex-screenshot.png" });
  });

  it("opens workspace-relative screenshots as file tabs", () => {
    expect(
      resolveArtifactFileLocation({
        source: "screenshots/output.png",
        workspaceRoot: "/Users/test/project",
      }),
    ).toEqual({ path: "screenshots/output.png" });
  });

  it("opens file URIs as file tabs", () => {
    expect(
      resolveArtifactFileLocation({
        source: "file:///tmp/paseo-codex-screenshot.png",
        workspaceRoot: "/Users/test/project",
      }),
    ).toEqual({ path: "/tmp/paseo-codex-screenshot.png" });
  });

  it("leaves remote and data images for the lightbox", () => {
    expect(
      resolveArtifactFileLocation({
        source: "https://example.com/shot.png",
        workspaceRoot: "/Users/test/project",
      }),
    ).toBeNull();
    expect(
      resolveArtifactFileLocation({
        source: "data:image/png;base64,abc",
        workspaceRoot: "/Users/test/project",
      }),
    ).toBeNull();
  });
});
