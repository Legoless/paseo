import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useQueryClient } from "@tanstack/react-query";
import type { CustomCommand } from "@getpaseo/protocol/custom-commands";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { openCommandForm } from "@/commands/command-form-model";
import { daemonConfigQueryKey } from "@/data/daemon-config";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useCustomCommandsStore } from "@/stores/custom-commands-store";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { SettingsSection } from "@/components/settings";

const EMPTY_COMMANDS: CustomCommand[] = [];

function CommandEditor({
  initial,
  onSave,
  onClose,
}: {
  initial: CustomCommand;
  onSave: (command: CustomCommand) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const [model] = useState(() => openCommandForm(initial));
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const header = useMemo(
    () => ({ title: t(initial.title ? "settings.commands.edit" : "settings.commands.add") }),
    [initial.title, t],
  );
  const setTitle = useCallback((value: string) => model.set("title", value), [model]);
  const setText = useCallback((value: string) => model.set("text", value), [model]);
  const setTarget = useCallback(
    (value: CustomCommand["target"]) => model.set("target", value),
    [model],
  );
  const setSubmit = useCallback((value: boolean) => model.set("submit", value), [model]);
  const setShortcut = useCallback((value: string) => model.set("shortcut", value), [model]);
  const close = useCallback(() => {
    if (!model.getState().pending) onClose();
  }, [model, onClose]);
  const save = useCallback(() => {
    void model.save(onSave, t("common.errors.unableToSave")).then((saved) => {
      if (saved) onClose();
      return saved;
    });
  }, [model, onSave, onClose, t]);
  const targets = useMemo(
    () => [
      {
        value: "agent" as const,
        label: t("settings.commands.agent"),
        disabled: state.pending,
        testID: "command-target-agent",
      },
      {
        value: "terminal" as const,
        label: t("settings.commands.terminal"),
        disabled: state.pending,
        testID: "command-target-terminal",
      },
    ],
    [t, state.pending],
  );
  return (
    <AdaptiveModalSheet
      visible
      header={header}
      onClose={close}
      desktopMaxWidth={520}
      testID="command-editor"
    >
      <View style={styles.form}>
        <Field label={t("settings.commands.name")}>
          <FormTextInput
            size={size}
            initialValue={initial.title}
            onChangeText={setTitle}
            autoFocus
            editable={!state.pending}
            accessibilityLabel={t("settings.commands.name")}
            testID="command-name"
          />
        </Field>
        <Field label={t("settings.commands.text")}>
          <FormTextInput
            size={size}
            initialValue={initial.text}
            onChangeText={setText}
            multiline
            numberOfLines={5}
            style={styles.commandText}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!state.pending}
            accessibilityLabel={t("settings.commands.text")}
            testID="command-text"
          />
        </Field>
        <Field label={t("settings.commands.target")}>
          <SegmentedControl
            size={size}
            options={targets}
            value={state.command.target}
            onValueChange={setTarget}
          />
        </Field>
        <View style={styles.toggleRow}>
          <Text style={settingsStyles.rowTitle}>{t("settings.commands.submit")}</Text>
          <Switch
            value={state.command.submit}
            onValueChange={setSubmit}
            disabled={state.pending}
            accessibilityLabel={t("settings.commands.submit")}
            testID="command-submit-toggle"
          />
        </View>
        <Field
          label={t("settings.commands.shortcut")}
          error={state.shortcutValid ? null : t("settings.commands.invalidShortcut")}
        >
          <FormTextInput
            size={size}
            initialValue={initial.shortcut ?? ""}
            onChangeText={setShortcut}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!state.pending}
            placeholder="Cmd+Shift+R"
            accessibilityLabel={t("settings.commands.shortcut")}
            testID="command-shortcut"
          />
        </Field>
        {state.error ? (
          <Alert
            variant="error"
            title={t("common.errors.unableToSave")}
            description={state.error}
            testID="command-save-error"
          />
        ) : null}
        <View style={styles.actions}>
          <Button variant="secondary" size={size} onPress={close} disabled={state.pending}>
            {t("common.actions.cancel")}
          </Button>
          <Button size={size} onPress={save} disabled={!state.canSubmit} testID="command-save">
            {state.pending ? t("renameModal.saving") : t("settings.commands.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

function CommandRow({
  command,
  pending,
  onEdit,
  onDelete,
}: {
  command: CustomCommand;
  pending: boolean;
  onEdit: (command: CustomCommand) => void;
  onDelete: (command: CustomCommand) => void;
}) {
  const { t } = useTranslation();
  const edit = useCallback(() => onEdit(command), [onEdit, command]);
  const remove = useCallback(() => onDelete(command), [onDelete, command]);
  return (
    <View style={settingsStyles.row} testID={`settings-command-${command.id}`}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{command.title}</Text>
        <Text style={settingsStyles.rowHint} numberOfLines={2}>
          {command.text}
        </Text>
        <Text style={settingsStyles.rowHint}>{t(`settings.commands.${command.target}`)}</Text>
      </View>
      <View style={styles.actions}>
        <Button size="sm" variant="outline" onPress={edit} disabled={pending}>
          {t("settings.commands.editAction")}
        </Button>
        <Button size="sm" variant="outline" onPress={remove} disabled={pending}>
          {t("settings.commands.delete")}
        </Button>
      </View>
    </View>
  );
}

export function HostCommandsPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "customCommandsEditing");
  const client = useHostRuntimeClient(serverId);
  const { config, isLoading } = useDaemonConfig(serverId);
  const queryClient = useQueryClient();
  const commands = config?.customCommands ?? EMPTY_COMMANDS;
  const [editor, setEditor] = useState<{
    command: CustomCommand;
    commands: CustomCommand[];
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openEditor = useCallback(
    (command: CustomCommand) => setEditor({ command, commands }),
    [commands],
  );
  const add = useCallback(
    () =>
      openEditor({ id: crypto.randomUUID(), title: "", text: "", target: "agent", submit: true }),
    [openEditor],
  );
  const closeEditor = useCallback(() => setEditor(null), []);
  const saveCommands = useCallback(
    async (next: CustomCommand[], expected: CustomCommand[]) => {
      if (!client || !connected) throw new Error(t("workspace.terminal.hostDisconnected"));
      const result = await client.setGlobalCommands(next, expected);
      queryClient.setQueryData(daemonConfigQueryKey(serverId), result.config);
      useCustomCommandsStore.getState().setGlobalCommands({
        serverId,
        global: result.config.customCommands ?? [],
        globalErrors: [],
      });
    },
    [client, connected, queryClient, serverId, t],
  );
  const save = useCallback(
    async (command: CustomCommand) => {
      if (!editor) return;
      const exists = editor.commands.some((entry) => entry.id === command.id);
      await saveCommands(
        exists
          ? editor.commands.map((entry) => (entry.id === command.id ? command : entry))
          : [...editor.commands, command],
        editor.commands,
      );
    },
    [editor, saveCommands],
  );
  const remove = useCallback(
    (command: CustomCommand) => {
      void (async () => {
        if (
          !(await confirmDialog({
            title: t("settings.commands.deleteTitle", { name: command.title }),
            message: t("settings.commands.deleteMessage"),
            confirmLabel: t("settings.commands.delete"),
            cancelLabel: t("common.actions.cancel"),
            destructive: true,
          }))
        )
          return;
        setPending(true);
        setError(null);
        try {
          await saveCommands(
            commands.filter((entry) => entry.id !== command.id),
            commands,
          );
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : t("common.errors.unableToSave"));
        } finally {
          setPending(false);
        }
      })();
    },
    [commands, saveCommands, t],
  );
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: daemonConfigQueryKey(serverId) });
  }, [queryClient, serverId]);

  const hasFileErrors = Boolean(config?.customCommandErrors?.length);
  const addButton = useMemo(
    () => (
      <Button
        size="sm"
        onPress={add}
        disabled={pending || hasFileErrors || !connected}
        testID="command-add"
      >
        {t("settings.commands.add")}
      </Button>
    ),
    [add, pending, hasFileErrors, connected, t],
  );
  if (!connected && !editor) return <Alert title={t("workspace.terminal.hostDisconnected")} />;
  if (!supported && !editor) return <Alert title={t("settings.commands.updateHost")} />;
  if (isLoading && !editor)
    return <Text style={settingsStyles.rowHint}>{t("common.loading")}</Text>;
  if (!config && !editor)
    return (
      <Alert variant="error" title={t("settings.commands.loadError")}>
        <Button onPress={refresh}>{t("common.actions.retry")}</Button>
      </Alert>
    );
  const fileErrors = config?.customCommandErrors ?? [];
  return (
    <SettingsSection
      title={t("workspace.commands.title")}
      testID="settings-commands"
      trailing={addButton}
    >
      {error ? (
        <Alert variant="error" title={t("common.errors.unableToSave")} description={error} />
      ) : null}
      {fileErrors.map((message) => (
        <Alert
          key={message}
          variant="error"
          title={t("settings.commands.loadError")}
          description={message}
        />
      ))}
      <View style={settingsStyles.card}>
        {commands.length === 0 ? (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t("settings.commands.empty")}</Text>
          </View>
        ) : null}
        {commands.map((command) => (
          <CommandRow
            key={command.id}
            command={command}
            pending={pending || !connected}
            onEdit={openEditor}
            onDelete={remove}
          />
        ))}
      </View>
      {pending ? <Text style={settingsStyles.rowHint}>{t("renameModal.saving")}</Text> : null}
      {editor ? (
        <CommandEditor
          key={editor.command.id}
          initial={editor.command}
          onSave={save}
          onClose={closeEditor}
        />
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing[4], paddingBottom: theme.spacing[2] },
  commandText: { minHeight: theme.spacing[24], textAlignVertical: "top" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
