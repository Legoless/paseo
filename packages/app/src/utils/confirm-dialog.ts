import { Alert } from "react-native";
import { isNative } from "@/constants/platform";
import { requestConfirmDialog } from "@/stores/confirm-dialog-store";

export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

async function showNativeConfirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  const confirmLabel = input.confirmLabel ?? "Confirm";
  const cancelLabel = input.cancelLabel ?? "Cancel";

  return new Promise<boolean>((resolve) => {
    Alert.alert(
      input.title,
      input.message,
      [
        {
          text: cancelLabel,
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: confirmLabel,
          style: input.destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve(false),
      },
    );
  });
}

function blurActiveWebElement(): void {
  if (isNative) {
    return;
  }
  const activeElement = (globalThis as { document?: Document }).document?.activeElement;
  (activeElement as HTMLElement | null)?.blur?.();
}

/**
 * Asks the user to confirm, and resolves false on every way of declining, dismissal included.
 *
 * iOS and Android get `Alert.alert`, which is the platform's own confirmation and the one users
 * expect there. Desktop and browser get the app's dialog instead of the OS alert box or
 * `window.confirm`: those paint outside the window in someone else's design language, and
 * `window.confirm` silently drops the button labels the caller wrote.
 */
export async function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  if (isNative) {
    return showNativeConfirmDialog(input);
  }
  blurActiveWebElement();
  return requestConfirmDialog(input);
}

export const __private__ = {
  blurActiveWebElement,
};
