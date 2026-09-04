import { useCallback, useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRouter, type Href } from "expo-router";
import { FolderOpen, Inbox, LayoutGrid, Plug, Smartphone } from "lucide-react-native";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { useCreateProjectlessWorkspace } from "@/hooks/use-create-projectless-workspace";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useOpenProject } from "@/hooks/use-open-project";
import { useHostChooser } from "@/hosts/host-chooser";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import {
  buildHostAgentDetailRoute,
  buildNewWorkspaceRoute,
  buildSettingsHostSectionRoute,
} from "@/utils/host-routes";

/**
 * The ways to start work, shared by the home screen and by a workspace with
 * nothing open. A workspace that has run out of tabs is in the same position as
 * a fresh install — it needs somewhere to go — so it gets the same grid rather
 * than a dead-end message.
 *
 * Owns the sheets its tiles open, so a caller only has to place it.
 */
export function HomeTiles() {
  const { t } = useTranslation();
  const router = useRouter();
  const openProjectPicker = useOpenAddProject();
  const createProjectlessWorkspace = useCreateProjectlessWorkspace();
  const chooseHost = useHostChooser();
  const localServerId = useLocalDaemonServerId();
  const [importServerId, setImportServerId] = useState<string | null>(null);
  const importClient = useHostRuntimeClient(importServerId ?? "");
  const openImportedProject = useOpenProject(importServerId);
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);
  const [isImportSheetOpen, setIsImportSheetOpen] = useState(false);

  const handleOpenPicker = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleCreateWorkspace = useCallback(() => {
    void (async () => {
      // Falls back to the New Workspace screen, which is the surface that can
      // ask which host to use when several are configured and none is active.
      if (!(await createProjectlessWorkspace())) router.push(buildNewWorkspaceRoute() as Href);
    })();
  }, [createProjectlessWorkspace, router]);

  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);

  const handleOpenImportSession = useCallback(() => {
    chooseHost({
      title: "Import from host",
      onChooseHost: (serverId) => {
        setImportServerId(serverId);
        setIsImportSheetOpen(true);
      },
    });
  }, [chooseHost]);
  const handleCloseImportSession = useCallback(() => setIsImportSheetOpen(false), []);

  const handleImported = useCallback(
    (agent: { id: string; cwd: string }) => {
      if (!importServerId) return;
      void (async () => {
        const result = await openImportedProject(agent.cwd);
        if (result.ok) {
          router.push(buildHostAgentDetailRoute(importServerId, agent.id) as Href);
        }
      })();
    },
    [importServerId, openImportedProject, router],
  );

  const handleOpenProviders = useCallback(() => {
    chooseHost({
      title: "Choose host",
      onChooseHost: (serverId) => {
        router.push(buildSettingsHostSectionRoute(serverId, "providers"));
      },
    });
  }, [chooseHost, router]);

  return (
    <>
      <View style={styles.tiles}>
        <HomeTile
          icon={FolderOpen}
          title={t("openProject.tiles.addProject.title")}
          description={t("openProject.tiles.addProject.description")}
          onPress={handleOpenPicker}
          testID="open-project-submit"
          accent
        />
        <HomeTile
          icon={LayoutGrid}
          title={t("openProject.tiles.newWorkspace.title")}
          description={t("openProject.tiles.newWorkspace.description")}
          onPress={handleCreateWorkspace}
          testID="open-project-new-workspace"
        />
        <HomeTile
          icon={Inbox}
          title={t("openProject.tiles.importSession.title")}
          description={t("openProject.tiles.importSession.description")}
          onPress={handleOpenImportSession}
          testID="open-project-import-session"
        />
        <HomeTile
          icon={Plug}
          title={t("openProject.tiles.setupProviders.title")}
          description={t("openProject.tiles.setupProviders.description")}
          onPress={handleOpenProviders}
          testID="open-project-setup-providers"
        />
        {localServerId ? (
          <HomeTile
            icon={Smartphone}
            title={t("openProject.tiles.pairDevice.title")}
            description={t("openProject.tiles.pairDevice.description")}
            onPress={handleOpenPairDevice}
            testID="open-project-pair-device"
          />
        ) : null}
      </View>
      <PairDeviceModal
        serverId={localServerId ?? ""}
        visible={isPairDeviceOpen}
        onClose={handleClosePairDevice}
        testID="open-project-pair-device-modal"
      />
      <ImportSessionSheet
        visible={isImportSheetOpen}
        client={importClient}
        serverId={importServerId}
        onClose={handleCloseImportSession}
        onImported={handleImported}
      />
    </>
  );
}

const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface HomeTileProps {
  icon: ComponentType<{ size: number; color: string }>;
  title: string;
  description: string;
  onPress: () => void;
  testID?: string;
  accent?: boolean;
}

function HomeTile({ icon: Icon, title, description, onPress, testID, accent }: HomeTileProps) {
  // Wrapping the icon keeps its themed colour reactive without the tile reading
  // the theme through React. Memoized so the wrapper is not rebuilt per render.
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.tile,
      hovered && styles.tileHovered,
      pressed && styles.tilePressed,
    ],
    [hovered],
  );

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      testID={testID}
      style={pressableStyle}
    >
      <ThemedIcon size={20} uniProps={accent ? accentColorMapping : mutedColorMapping} />
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  tiles: {
    marginTop: { xs: theme.spacing[6], md: theme.spacing[12] },
    width: "100%",
    maxWidth: 452,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: theme.spacing[3],
  },
  tile: {
    width: { xs: "100%", md: 220 },
    minHeight: { xs: 0, md: 132 },
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    gap: theme.spacing[3],
  },
  tileHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  tilePressed: {
    opacity: 0.85,
  },
  tileText: {
    gap: theme.spacing[1],
  },
  tileTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  tileDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 18,
  },
}));
