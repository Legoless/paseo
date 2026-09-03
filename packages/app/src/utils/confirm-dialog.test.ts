import { afterEach, describe, expect, it, vi } from "vitest";

type MockPlatform = "web" | "ios" | "android";

interface AlertButton {
  onPress?: () => void;
}

async function loadModuleForPlatform(platform: MockPlatform): Promise<{
  confirmDialog: typeof import("./confirm-dialog").confirmDialog;
  store: typeof import("@/stores/confirm-dialog-store");
  alertMock: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();

  const alertMock = vi.fn();
  vi.doMock("react-native", () => ({
    Alert: { alert: alertMock },
    Platform: { OS: platform },
  }));

  const module = await import("./confirm-dialog");
  const store = await import("@/stores/confirm-dialog-store");
  return { confirmDialog: module.confirmDialog, store, alertMock };
}

describe("confirmDialog", () => {
  afterEach(() => {
    vi.doUnmock("react-native");
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as { document?: unknown }).document;
  });

  it("hands the question to the in-app dialog on web instead of an OS alert", async () => {
    const blurMock = vi.fn();
    (globalThis as { document?: unknown }).document = {
      activeElement: { blur: blurMock },
    } as unknown as Document;

    const { confirmDialog, store, alertMock } = await loadModuleForPlatform("web");
    const pending = confirmDialog({
      title: "Switch project?",
      message: "This agent's conversation will be discarded.",
      confirmLabel: "Switch",
      cancelLabel: "Cancel",
      destructive: true,
    });

    const request = store.useConfirmDialogStore.getState().request;
    expect(alertMock).not.toHaveBeenCalled();
    expect(blurMock).toHaveBeenCalledTimes(1);
    expect(request).toMatchObject({
      title: "Switch project?",
      message: "This agent's conversation will be discarded.",
      confirmLabel: "Switch",
      cancelLabel: "Cancel",
      destructive: true,
    });

    store.useConfirmDialogStore.getState().settle(request?.id ?? -1, true);
    await expect(pending).resolves.toBe(true);
    expect(store.useConfirmDialogStore.getState().request).toBeNull();
  });

  it("resolves false when the dialog is declined", async () => {
    const { confirmDialog, store } = await loadModuleForPlatform("web");
    const pending = confirmDialog({ title: "Discard changes?", message: "They are lost." });

    const request = store.useConfirmDialogStore.getState().request;
    store.useConfirmDialogStore.getState().settle(request?.id ?? -1, false);
    await expect(pending).resolves.toBe(false);
  });

  it("declines a pending question when a second one replaces it", async () => {
    const { confirmDialog, store } = await loadModuleForPlatform("web");
    const first = confirmDialog({ title: "First", message: "One." });
    const second = confirmDialog({ title: "Second", message: "Two." });

    // Two stacked confirmations have no reading order, so the older one is answered as declined.
    await expect(first).resolves.toBe(false);
    const request = store.useConfirmDialogStore.getState().request;
    expect(request?.title).toBe("Second");

    store.useConfirmDialogStore.getState().settle(request?.id ?? -1, true);
    await expect(second).resolves.toBe(true);
  });

  it("ignores a settle aimed at a request that is no longer open", async () => {
    const { confirmDialog, store } = await loadModuleForPlatform("web");
    const pending = confirmDialog({ title: "Only", message: "One." });
    const request = store.useConfirmDialogStore.getState().request;

    store.useConfirmDialogStore.getState().settle(-99, true);
    expect(store.useConfirmDialogStore.getState().request).not.toBeNull();

    store.useConfirmDialogStore.getState().settle(request?.id ?? -1, true);
    await expect(pending).resolves.toBe(true);
  });

  it("uses native Alert on iOS/Android", async () => {
    const { confirmDialog, store, alertMock } = await loadModuleForPlatform("ios");
    alertMock.mockImplementation((_title: string, _message: string, buttons?: AlertButton[]) => {
      buttons?.[1]?.onPress?.();
    });

    const confirmed = await confirmDialog({
      title: "Restart host",
      message: "This will restart the daemon.",
      confirmLabel: "Restart",
      cancelLabel: "Cancel",
      destructive: true,
    });

    expect(confirmed).toBe(true);
    expect(alertMock).toHaveBeenCalled();
    expect(store.useConfirmDialogStore.getState().request).toBeNull();
  });
});
