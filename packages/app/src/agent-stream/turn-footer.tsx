import React, { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { TriangleAlertIcon } from "lucide-react-native";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { SPACING, type Theme } from "@/styles/theme";
import type { TurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import {
  collectAssistantResponseContentForStreamRenderStrategy,
  type StreamStrategy,
} from "./strategy";
import { resolveAssistantTurnForkBoundary, type AssistantTurnForkBoundary } from "./turn-boundary";
import {
  AssistantTurnFooter,
  LiveElapsed,
  STREAM_METADATA_FONT_SIZE,
  type AssistantForkTarget,
} from "@/components/message";
import type { TurnFooterHost } from "./layout";
import { AssistantForkMenu } from "@/components/assistant-fork-menu";
import { SyncedLoader } from "@/components/synced-loader";
import { useRetainedPanelActive } from "@/components/retained-panel";

const ThemedSyncedLoader = withUnistyles(SyncedLoader);
const ThemedWarningIcon = withUnistyles(TriangleAlertIcon);
const workingIndicatorColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const stuckIndicatorColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
export const TURN_FOOTER_BOTTOM_SPACING = SPACING[8];
// A turn with nothing streamed back after this long is wedged, not thinking — the
// provider accepted the prompt and went silent (e.g. an unseen quota hang).
export const TURN_NO_RESPONSE_THRESHOLD_MS = 90_000;

export type TurnContentStrategy = StreamStrategy;
export type AssistantTurnForkHandler = (input: {
  target: AssistantForkTarget;
  boundary: AssistantTurnForkBoundary;
}) => Promise<void> | void;
/**
 * Fork handler for the turn that is still streaming. It deliberately takes no
 * boundary: `selectForkContextRows` projects the entire timeline when neither
 * boundary field is given, which is what captures the partially streamed text
 * the user is watching. Pinning a boundary here would silently drop the live
 * response — the opposite of what a fork button next to the loader promises.
 *
 * Kept separate from `AssistantTurnForkHandler` (whose `boundary` stays
 * required) so the compiler keeps enforcing that completed turns always pin one.
 */
export type InFlightTurnForkHandler = (target: AssistantForkTarget) => Promise<void> | void;

export const TurnFooter = memo(function TurnFooter({
  isRunning,
  inFlightTurnStartedAt,
  awaitingFirstResponse,
  host,
  strategy,
  supportsTimelineCursor,
  onForkAssistantTurn,
  onForkInFlightTurn,
}: {
  isRunning: boolean;
  inFlightTurnStartedAt: Date | null;
  awaitingFirstResponse?: boolean;
  host: TurnFooterHost | null;
  strategy: TurnContentStrategy;
  supportsTimelineCursor: boolean;
  onForkAssistantTurn?: AssistantTurnForkHandler;
  onForkInFlightTurn?: InFlightTurnForkHandler;
}) {
  if (isRunning) {
    return (
      <TurnFooterRow>
        <RunningTurnFooter
          inFlightTurnStartedAt={inFlightTurnStartedAt}
          awaitingFirstResponse={awaitingFirstResponse}
          onForkInFlightTurn={onForkInFlightTurn}
        />
      </TurnFooterRow>
    );
  }
  if (!host) {
    return null;
  }
  return (
    <CompletedTurnFooterRow
      strategy={strategy}
      items={host.items}
      timing={host.timing}
      startIndex={host.startIndex}
      supportsTimelineCursor={supportsTimelineCursor}
      onForkAssistantTurn={onForkAssistantTurn}
    />
  );
});

export const CompletedTurnFooterRow = memo(function CompletedTurnFooterRow({
  strategy,
  items,
  timing,
  startIndex,
  supportsTimelineCursor,
  onForkAssistantTurn,
}: {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
  supportsTimelineCursor: boolean;
  onForkAssistantTurn?: AssistantTurnForkHandler;
}) {
  return (
    <TurnFooterRow>
      <CompletedTurnFooter
        strategy={strategy}
        items={items}
        timing={timing}
        startIndex={startIndex}
        supportsTimelineCursor={supportsTimelineCursor}
        onForkAssistantTurn={onForkAssistantTurn}
      />
    </TurnFooterRow>
  );
});

const WorkingIndicator = memo(function WorkingIndicator({
  inFlightTurnStartedAt = null,
  awaitingFirstResponse = false,
  onForkInFlightTurn,
}: {
  inFlightTurnStartedAt?: Date | null;
  awaitingFirstResponse?: boolean;
  onForkInFlightTurn?: InFlightTurnForkHandler;
}) {
  const active = useRetainedPanelActive();
  const startedAtMs = inFlightTurnStartedAt?.getTime() ?? null;
  const showNoResponse = useNoResponseStuck({
    active,
    awaitingFirstResponse,
    startedAtMs,
  });
  return (
    <View style={stylesheet.turnFooterContent}>
      <View style={stylesheet.workingLoader}>
        {showNoResponse ? (
          <ThemedWarningIcon size={14} uniProps={stuckIndicatorColorMapping} />
        ) : (
          <ThemedSyncedLoader size={14} uniProps={workingIndicatorColorMapping} />
        )}
      </View>
      {/* Match the completed-turn footer: actions precede timing metadata. */}
      {onForkInFlightTurn ? <AssistantForkMenu onFork={onForkInFlightTurn} /> : null}
      {inFlightTurnStartedAt ? (
        <LiveElapsed
          startedAt={inFlightTurnStartedAt}
          active={active}
          style={stylesheet.workingElapsed}
          testID="turn-working-elapsed"
        />
      ) : null}
      {showNoResponse ? (
        <Text style={stylesheet.noResponseNote} testID="turn-no-response-note">
          No response — the turn may be stuck
        </Text>
      ) : null}
    </View>
  );
});

// Ticks slowly while an open turn has produced nothing, so the stuck hint appears
// without keeping a fast timer alive for every healthy turn.
function useNoResponseStuck(input: {
  active: boolean;
  awaitingFirstResponse: boolean;
  startedAtMs: number | null;
}): boolean {
  const { active, awaitingFirstResponse, startedAtMs } = input;
  const watching = active && awaitingFirstResponse && startedAtMs !== null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!watching) return;
    const handle = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [watching]);
  return watching && nowMs - startedAtMs >= TURN_NO_RESPONSE_THRESHOLD_MS;
}

function RunningTurnFooter({
  inFlightTurnStartedAt,
  awaitingFirstResponse,
  onForkInFlightTurn,
}: {
  inFlightTurnStartedAt: Date | null;
  awaitingFirstResponse?: boolean;
  onForkInFlightTurn?: InFlightTurnForkHandler;
}) {
  return (
    <View style={stylesheet.turnFooterSlot} testID="turn-working-indicator">
      <WorkingIndicator
        inFlightTurnStartedAt={inFlightTurnStartedAt}
        awaitingFirstResponse={awaitingFirstResponse}
        onForkInFlightTurn={onForkInFlightTurn}
      />
    </View>
  );
}

function CompletedTurnFooter({
  strategy,
  items,
  timing,
  startIndex,
  supportsTimelineCursor,
  onForkAssistantTurn,
}: {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
  supportsTimelineCursor: boolean;
  onForkAssistantTurn?: AssistantTurnForkHandler;
}) {
  const getContent = useCallback(
    () =>
      collectAssistantResponseContentForStreamRenderStrategy({
        strategy,
        items,
        startIndex,
      }),
    [strategy, items, startIndex],
  );
  const boundary = resolveAssistantTurnForkBoundary({
    items,
    startIndex,
    supportsTimelineCursor,
  });
  const handleFork = useCallback(
    (target: AssistantForkTarget) => {
      if (!boundary) {
        return;
      }
      return onForkAssistantTurn?.({ target, boundary });
    },
    [boundary, onForkAssistantTurn],
  );
  return (
    <View style={stylesheet.turnFooterSlot}>
      <AssistantTurnFooter
        getContent={getContent}
        completedAt={timing?.completedAt}
        durationMs={timing?.durationMs}
        onFork={boundary && onForkAssistantTurn ? handleFork : undefined}
      />
    </View>
  );
}

function TurnFooterRow({ children }: { children: ReactNode }) {
  const rowStyle = useMemo(() => [stylesheet.streamItemWrapper, stylesheet.turnFooterRow], []);
  return <View style={rowStyle}>{children}</View>;
}

const stylesheet = StyleSheet.create((theme) => ({
  streamItemWrapper: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  turnFooterRow: {
    marginTop: theme.spacing[2] + 5,
  },
  turnFooterSlot: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    minHeight: 24,
    paddingBottom: TURN_FOOTER_BOTTOM_SPACING,
  },
  turnFooterContent: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: theme.spacing[3],
  },
  workingElapsed: {
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
    fontVariant: ["tabular-nums"],
  },
  noResponseNote: {
    color: theme.colors.statusWarning,
    fontSize: STREAM_METADATA_FONT_SIZE,
  },
  workingLoader: {
    marginLeft: -2,
  },
}));
