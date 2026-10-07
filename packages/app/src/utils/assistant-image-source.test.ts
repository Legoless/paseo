import { describe, expect, it } from "vitest";

import {
  resolveAgentImageFallbackRoot,
  resolveAssistantImageSource,
} from "./assistant-image-source";

describe("resolveAssistantImageSource", () => {
  it("passes through direct image URIs", () => {
    expect(resolveAssistantImageSource({ source: "https://example.com/image.png" })).toEqual({
      kind: "direct",
      uri: "https://example.com/image.png",
    });
    expect(resolveAssistantImageSource({ source: "data:image/png;base64,abc" })).toEqual({
      kind: "direct",
      uri: "data:image/png;base64,abc",
    });
  });

  it("opens a percent-encoded relative destination as the filesystem path", () => {
    expect(
      resolveAssistantImageSource({
        source: "posts/Porsche%20911%20GT3/generated-instagram-samples/02_side_hotel.jpg",
        workspaceRoot: "/Users/legoless/Projects/legoless/Instagram",
        fallbackRoot: "~/.grok/sessions/%2FUsers%2Flegoless%2FProjects/session",
      }),
    ).toEqual({
      kind: "file_rpc",
      cwd: "/Users/legoless/Projects/legoless/Instagram",
      path: "posts/Porsche 911 GT3/generated-instagram-samples/02_side_hotel.jpg",
      literalPath: "posts/Porsche%20911%20GT3/generated-instagram-samples/02_side_hotel.jpg",
      fallback: {
        cwd: "~/.grok/sessions/%2FUsers%2Flegoless%2FProjects/session",
        path: "posts/Porsche 911 GT3/generated-instagram-samples/02_side_hotel.jpg",
        literalPath: "posts/Porsche%20911%20GT3/generated-instagram-samples/02_side_hotel.jpg",
      },
    });
  });

  it("keeps a Grok session directory's encoded slashes", () => {
    const source = "~/.grok/sessions/%2FUsers%2Ftest/images/1.jpg";
    expect(
      resolveAssistantImageSource({
        source,
        workspaceRoot: "/Users/test/project",
      }),
    ).toEqual({
      kind: "file_rpc",
      cwd: "~",
      path: source,
    });
  });

  it("uses the workspace root for relative paths", () => {
    expect(
      resolveAssistantImageSource({
        source: "screenshots/output.png",
        workspaceRoot: "/Users/test/project",
      }),
    ).toEqual({
      kind: "file_rpc",
      cwd: "/Users/test/project",
      path: "screenshots/output.png",
    });
  });

  it("uses the workspace root for absolute paths inside the workspace", () => {
    expect(
      resolveAssistantImageSource({
        source: "/Users/test/project/screenshots/output.png",
        workspaceRoot: "/Users/test/project",
      }),
    ).toEqual({
      kind: "file_rpc",
      cwd: "/Users/test/project",
      path: "/Users/test/project/screenshots/output.png",
    });
  });

  it("falls back to filesystem root for absolute paths outside the workspace", () => {
    expect(
      resolveAssistantImageSource({
        source: "/tmp/paseo-codex-screenshot.png",
        workspaceRoot: "/Users/test/project",
      }),
    ).toEqual({
      kind: "file_rpc",
      cwd: "/",
      path: "/tmp/paseo-codex-screenshot.png",
    });
  });

  it("uses the same home-root target as file previews for tilde paths", () => {
    expect(
      resolveAssistantImageSource({
        source: "~/.paseo/screenshots/output.png",
        workspaceRoot: "/Users/test/project",
      }),
    ).toEqual({
      kind: "file_rpc",
      cwd: "~",
      path: "~/.paseo/screenshots/output.png",
    });
  });

  it("normalizes file URIs into file RPC requests", () => {
    expect(
      resolveAssistantImageSource({
        source: "file:///tmp/paseo-codex-screenshot.png",
        workspaceRoot: "/Users/test/project",
      }),
    ).toEqual({
      kind: "file_rpc",
      cwd: "/",
      path: "/tmp/paseo-codex-screenshot.png",
    });
  });

  it("normalizes markdown-encoded Windows paths into file RPC requests", () => {
    expect(
      resolveAssistantImageSource({
        source: "C:%5CUsers%5Chanse%5CAppData%5CLocal%5CTemp%5Cpaseo-attachments%5Cimage.png",
        workspaceRoot: "C:/Users/hanse/eatingkat",
      }),
    ).toEqual({
      kind: "file_rpc",
      cwd: "C:/",
      path: "C:/Users/hanse/AppData/Local/Temp/paseo-attachments/image.png",
    });
  });

  it("falls back to the drive root for Windows absolute paths", () => {
    expect(
      resolveAssistantImageSource({
        source: "C:/Users/test/Desktop/screenshot.png",
        workspaceRoot: "D:/repo",
      }),
    ).toEqual({
      kind: "file_rpc",
      cwd: "C:/",
      path: "C:/Users/test/Desktop/screenshot.png",
    });
  });
});

describe("Grok session-relative images", () => {
  const cwd = "/Users/test/Celestine";
  const sessionRoot = `~/.grok/sessions/${encodeURIComponent(cwd)}/01a0f1b8`;

  it("roots a Grok agent's relative images in its session folder", () => {
    expect(
      resolveAgentImageFallbackRoot({
        provider: "grok",
        cwd,
        runtimeInfo: { sessionId: "01a0f1b8" },
      }),
    ).toBe("~/.grok/sessions/%2FUsers%2Ftest%2FCelestine/01a0f1b8");
    expect(
      resolveAgentImageFallbackRoot({
        provider: "claude",
        cwd,
        runtimeInfo: { sessionId: "01a0f1b8" },
      }),
    ).toBe(null);
    expect(resolveAgentImageFallbackRoot({ provider: "grok", cwd, runtimeInfo: null })).toBe(null);
  });

  it("finds the session through persistence when runtime info is gone", () => {
    expect(
      resolveAgentImageFallbackRoot({
        provider: "grok",
        cwd,
        runtimeInfo: undefined,
        persistence: { sessionId: "01a0f1b8" },
      }),
    ).toBe(sessionRoot);
  });

  it("reads a relative image from the workspace first and the session folder second", () => {
    expect(
      resolveAssistantImageSource({
        source: "./images/celestine-paywall.png",
        workspaceRoot: cwd,
        fallbackRoot: sessionRoot,
      }),
    ).toEqual({
      kind: "file_rpc",
      cwd,
      path: "./images/celestine-paywall.png",
      fallback: { cwd: sessionRoot, path: "images/celestine-paywall.png" },
    });
  });

  it("leaves absolute and home paths where they point", () => {
    expect(
      resolveAssistantImageSource({
        source: "/tmp/celestine-paywall.png",
        workspaceRoot: cwd,
        fallbackRoot: sessionRoot,
      }),
    ).toEqual({ kind: "file_rpc", cwd: "/", path: "/tmp/celestine-paywall.png" });
    expect(
      resolveAssistantImageSource({
        source: "~/shots/paywall.png",
        workspaceRoot: cwd,
        fallbackRoot: sessionRoot,
      }),
    ).toEqual({ kind: "file_rpc", cwd: "~", path: "~/shots/paywall.png" });
  });
});
