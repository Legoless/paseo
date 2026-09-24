import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSessionStore } from "@/stores/session-store";
import { usePromptHistoryStore } from "@/stores/prompt-history-store";
import type { StreamItem } from "@/types/stream";
import type { ComposerKeyPressEvent } from "./input/input";

const EMPTY_STREAM_ITEMS: readonly StreamItem[] = [];

export function collectUserPromptsFromStream(
  tail: readonly StreamItem[],
  head: readonly StreamItem[],
): string[] {
  const result: string[] = [];
  const items = [...tail, ...head];
  for (const item of items) {
    if (item.kind === "user_message" && typeof item.text === "string") {
      const trimmed = item.text.trim();
      if (trimmed.length > 0) {
        if (result.length === 0 || result[result.length - 1] !== item.text) {
          result.push(item.text);
        }
      }
    }
  }
  return result;
}

export function resolveAvailablePrompts(
  sessionPrompts: readonly string[],
  globalPrompts: readonly string[],
): string[] {
  if (sessionPrompts.length > 0) {
    return [...sessionPrompts];
  }
  return [...globalPrompts];
}

export function canNavigateHistoryUp(
  input: ComposerKeyPressEvent["input"],
  isNavigating: boolean,
): boolean {
  if (isNavigating) return true;
  if (input.text.trim().length === 0) return true;
  if (input.selection.start === 0 && input.selection.end === 0) return true;
  if (
    !input.text.includes("\n") &&
    input.selection.start === input.text.length &&
    input.selection.end === input.text.length
  ) {
    return true;
  }
  return false;
}

export function canNavigateHistoryDown(isNavigating: boolean): boolean {
  return isNavigating;
}

export interface UseComposerPromptHistoryOptions {
  serverId: string;
  agentId: string;
  replaceUserInput: (text: string, selection?: { start: number; end: number }) => void;
}

export interface ComposerPromptHistoryResult {
  onKeyPress: (event: ComposerKeyPressEvent) => boolean;
  onTextChange: (text: string) => void;
  recordSubmittedPrompt: (text: string) => void;
  resetHistory: () => void;
}

export function useComposerPromptHistory({
  serverId,
  agentId,
  replaceUserInput,
}: UseComposerPromptHistoryOptions): ComposerPromptHistoryResult {
  const streamTail = useSessionStore(
    useCallback(
      (state) => (agentId ? state.sessions[serverId]?.agentStreamTail?.get(agentId) : undefined),
      [serverId, agentId],
    ),
  );
  const streamHead = useSessionStore(
    useCallback(
      (state) => (agentId ? state.sessions[serverId]?.agentStreamHead?.get(agentId) : undefined),
      [serverId, agentId],
    ),
  );

  const sessionPrompts = useMemo(
    () =>
      collectUserPromptsFromStream(
        streamTail ?? EMPTY_STREAM_ITEMS,
        streamHead ?? EMPTY_STREAM_ITEMS,
      ),
    [streamTail, streamHead],
  );

  const globalPrompts = usePromptHistoryStore((state) => state.prompts);

  const availablePrompts = useMemo(
    () => resolveAvailablePrompts(sessionPrompts, globalPrompts),
    [sessionPrompts, globalPrompts],
  );

  const availablePromptsRef = useRef(availablePrompts);
  availablePromptsRef.current = availablePrompts;

  const historyOffsetRef = useRef(-1);
  const draftRef = useRef("");
  const transientEditsRef = useRef<Map<number, string>>(new Map());
  const lastNavigatedTextRef = useRef<string | null>(null);

  const resetHistory = useCallback(() => {
    historyOffsetRef.current = -1;
    draftRef.current = "";
    transientEditsRef.current.clear();
    lastNavigatedTextRef.current = null;
  }, []);

  useEffect(() => {
    resetHistory();
  }, [agentId, serverId, resetHistory]);

  const onTextChange = useCallback((text: string) => {
    if (historyOffsetRef.current === -1) return;
    if (text === lastNavigatedTextRef.current) return;
    transientEditsRef.current.set(historyOffsetRef.current, text);
  }, []);

  const recordSubmittedPrompt = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        usePromptHistoryStore.getState().addPrompt(trimmed);
      }
      resetHistory();
    },
    [resetHistory],
  );

  const onKeyPress = useCallback(
    (event: ComposerKeyPressEvent): boolean => {
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
        return false;
      }

      const prompts = availablePromptsRef.current;

      if (event.key === "Escape") {
        if (historyOffsetRef.current !== -1) {
          const restored = draftRef.current;
          resetHistory();
          replaceUserInput(restored, { start: restored.length, end: restored.length });
          event.preventDefault();
          return true;
        }
        return false;
      }

      if (event.key === "ArrowUp") {
        if (prompts.length === 0) return false;

        const isNavigating = historyOffsetRef.current !== -1;
        if (!canNavigateHistoryUp(event.input, isNavigating)) {
          return false;
        }

        if (!isNavigating) {
          draftRef.current = event.input.text;
          historyOffsetRef.current = 0;
        } else if (historyOffsetRef.current < prompts.length - 1) {
          historyOffsetRef.current += 1;
        }

        const offset = historyOffsetRef.current;
        const promptIndex = prompts.length - 1 - offset;
        const targetText = transientEditsRef.current.get(offset) ?? prompts[promptIndex];

        lastNavigatedTextRef.current = targetText;
        replaceUserInput(targetText, { start: targetText.length, end: targetText.length });
        event.preventDefault();
        return true;
      }

      if (event.key === "ArrowDown") {
        if (historyOffsetRef.current === -1) return false;

        if (historyOffsetRef.current > 0) {
          historyOffsetRef.current -= 1;
          const offset = historyOffsetRef.current;
          const promptIndex = prompts.length - 1 - offset;
          const targetText = transientEditsRef.current.get(offset) ?? prompts[promptIndex];

          lastNavigatedTextRef.current = targetText;
          replaceUserInput(targetText, { start: targetText.length, end: targetText.length });
          event.preventDefault();
          return true;
        }

        if (historyOffsetRef.current === 0) {
          const restored = draftRef.current;
          resetHistory();
          replaceUserInput(restored, { start: restored.length, end: restored.length });
          event.preventDefault();
          return true;
        }

        return false;
      }

      return false;
    },
    [replaceUserInput, resetHistory],
  );

  return {
    onKeyPress,
    onTextChange,
    recordSubmittedPrompt,
    resetHistory,
  };
}
