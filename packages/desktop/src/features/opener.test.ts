import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createExternalUrlOpener, createFilePathOpener } from "./opener";

describe("desktop opener", () => {
  it("passes a canonical web URL to its external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    await open("https://example.com/docs#install");

    expect(opened).toEqual(["https://example.com/docs#install"]);
  });

  it("does not hand non-web or relative URLs to the external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    for (const input of [
      "file:///private/data",
      "javascript:alert(1)",
      "paseo://settings",
      "/docs",
      null,
    ]) {
      await expect(open(input)).rejects.toThrow("Only HTTP(S) URLs can open externally.");
    }

    expect(opened).toEqual([]);
  });

  it("passes files of any type to the default application with their exact filenames", async () => {
    const opened: string[] = [];
    const open = createFilePathOpener({
      open: async (filePath) => {
        opened.push(filePath);
        return "";
      },
    });
    const paths = [
      join(tmpdir(), "model.ldr"),
      join(tmpdir(), "report.md"),
      join(tmpdir(), "original model.custom-extension"),
      join(tmpdir(), "model #1.ldr "),
    ];

    for (const filePath of paths) await open(filePath);

    expect(opened).toEqual(paths);
  });

  it("expands home shorthand before opening a local file", async () => {
    const opened: string[] = [];
    const open = createFilePathOpener({
      open: async (filePath) => {
        opened.push(filePath);
        return "";
      },
    });

    await open("~/Models/original model.ldr");
    await open("~");

    expect(opened).toEqual([join(homedir(), "Models", "original model.ldr"), homedir()]);
  });

  it("does not hand URLs, relative paths, or invalid inputs to the default application", async () => {
    const opened: string[] = [];
    const open = createFilePathOpener({
      open: async (filePath) => {
        opened.push(filePath);
        return "";
      },
    });

    for (const input of [
      "",
      " ",
      "file:///private/model.ldr",
      "https://example.com/model.ldr",
      "javascript:alert(1)",
      "source/report.md",
      "~someone/model.ldr",
      join(tmpdir(), "model\0.ldr"),
      null,
    ]) {
      await expect(open(input)).rejects.toThrow(
        "Only absolute local paths can open in the default application.",
      );
    }

    expect(opened).toEqual([]);
  });

  it("rejects the default application's failure instead of reporting success", async () => {
    const open = createFilePathOpener({
      open: async () => "No application is registered for model.ldr",
    });

    await expect(open(join(tmpdir(), "model.ldr"))).rejects.toThrow(
      "No application is registered for model.ldr",
    );
  });
});
