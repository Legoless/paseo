import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useConfirmDialogStore, type ConfirmDialogRequest } from "@/stores/confirm-dialog-store";

function ConfirmDialog({ request }: { request: ConfirmDialogRequest }) {
  const { t } = useTranslation();
  const settle = useConfirmDialogStore((state) => state.settle);
  const header = useMemo<SheetHeader>(() => ({ title: request.title }), [request.title]);
  // Dismissing without choosing is a decline: every caller reads false as "leave it alone".
  const handleCancel = useCallback(() => settle(request.id, false), [request.id, settle]);
  const handleConfirm = useCallback(() => settle(request.id, true), [request.id, settle]);

  return (
    <AdaptiveModalSheet
      visible
      header={header}
      onClose={handleCancel}
      desktopMaxWidth={420}
      testID="confirm-dialog"
    >
      <View style={styles.body}>
        <Text style={styles.message} testID="confirm-dialog-message">
          {request.message}
        </Text>
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            style={styles.actionButton}
            onPress={handleCancel}
            testID="confirm-dialog-cancel"
          >
            {request.cancelLabel ?? t("common.actions.cancel")}
          </Button>
          <Button
            variant={request.destructive === true ? "destructive" : "default"}
            size="sm"
            style={styles.actionButton}
            onPress={handleConfirm}
            testID="confirm-dialog-confirm"
          >
            {request.confirmLabel ?? t("common.actions.confirm")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

/**
 * Renders whatever `confirmDialog()` is currently asking. Mounted once at the app root because the
 * callers are plain async handlers with no React tree of their own — and because the confirmation
 * has to outlive the menu, popover or pane that triggered it.
 *
 * Keyed on the request id so a replacement dialog mounts fresh instead of inheriting the old one's
 * animation state.
 */
export function ConfirmDialogHost() {
  const request = useConfirmDialogStore((state) => state.request);
  if (!request) {
    return null;
  }
  return <ConfirmDialog key={request.id} request={request} />;
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.45,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
