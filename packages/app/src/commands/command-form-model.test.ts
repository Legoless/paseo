import { describe, expect, it } from "vitest";
import { openCommandForm } from "./command-form-model";

const command = { id: "stable-id", title: "", text: "", target: "agent" as const, submit: true };

describe("command editor", () => {
  it("requires a title and text, preserves multiline text and identity when saving", async () => {
    const model = openCommandForm(command);
    expect(model.getState().canSubmit).toBe(false);
    model.set("title", " Review ");
    model.set("text", "  Review this diff\nThen suggest tests\n");
    model.set("target", "terminal");
    model.set("submit", false);
    model.set("shortcut", "Cmd+Shift+R");
    expect(model.getState().canSubmit).toBe(true);
    const saved: unknown[] = [];
    expect(
      await model.save(async (value) => {
        saved.push(value);
      }, "Failed"),
    ).toBe(true);
    expect(saved).toEqual([
      {
        id: "stable-id",
        title: "Review",
        text: "  Review this diff\nThen suggest tests\n",
        target: "terminal",
        submit: false,
        shortcut: "Cmd+Shift+R",
      },
    ]);
  });

  it("rejects invalid shortcuts and allows clearing a shortcut", () => {
    const model = openCommandForm({ ...command, title: "Review", text: "Review the diff" });
    model.set("shortcut", "NotAModifier+R");
    expect(model.getState().shortcutValid).toBe(false);
    expect(model.getState().canSubmit).toBe(false);
    model.set("shortcut", "");
    expect(model.getState().canSubmit).toBe(true);
  });

  it("blocks duplicate saves and preserves the draft on failure so it can be retried", async () => {
    const model = openCommandForm({ ...command, title: "Review", text: "Review the diff" });
    let rejectSave!: (error: Error) => void;
    const save = model.save(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
      "Failed",
    );
    expect(model.getState().pending).toBe(true);
    expect(
      await model.save(async () => {
        throw new Error("must not run");
      }, "Failed"),
    ).toBe(false);
    rejectSave(new Error("Host disconnected"));
    expect(await save).toBe(false);
    expect(model.getState().error).toBe("Host disconnected");
    expect(model.getState().command.text).toBe("Review the diff");
    expect(await model.save(async () => {}, "Failed")).toBe(true);
    expect(model.getState().error).toBeNull();
  });
});
