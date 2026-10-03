import { useCallback, useMemo, useReducer } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ComposerAttachment } from "@/attachments/types";
import {
  resolveComposerAttachmentSubmitFormat,
  splitComposerAttachmentsForSubmit,
} from "@/composer/attachments/submit";
import { isActiveCreateFlowForDraft, useCreateFlowStore } from "@/stores/create-flow-store";
import { handoffCreatedAgentMessageSubmission } from "@/composer/submission/writer";
import { useSessionStore } from "@/stores/session-store";
import {
  createUserMessage,
  type StreamItem,
  type UserMessageImageAttachment,
} from "@/types/stream";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { PendingMessageSubmission } from "@/composer/submission/model";

const EMPTY_STREAM_ITEMS: StreamItem[] = [];

interface CreateAttempt {
  clientMessageId: string;
  text: string;
  timestamp: Date;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
}

type DraftAgentMachineState<TDraftAgent> =
  // `errorShownByComposer`: the composer already shows this error inline, so the draft banner
  // must not repeat it. Errors from auto-submit, a prepared attempt, or a remount have no
  // composer to show them and stay on the banner.
  | { tag: "draft"; errorMessage: string; errorShownByComposer: boolean }
  | { tag: "creating"; attempt: CreateAttempt; draftAgent: TDraftAgent };

type DraftAgentMachineEvent<TDraftAgent> =
  | { type: "DRAFT_SET_ERROR"; message: string; errorShownByComposer: boolean }
  | { type: "SUBMIT"; attempt: CreateAttempt; draftAgent: TDraftAgent }
  | { type: "CREATE_FAILED"; message: string; errorShownByComposer: boolean };

function assertNever(value: never): never {
  throw new Error(`Unhandled state: ${JSON.stringify(value)}`);
}

function reducer<TDraftAgent>(
  state: DraftAgentMachineState<TDraftAgent>,
  event: DraftAgentMachineEvent<TDraftAgent>,
): DraftAgentMachineState<TDraftAgent> {
  switch (event.type) {
    case "DRAFT_SET_ERROR": {
      if (state.tag !== "draft") {
        return state;
      }
      return {
        ...state,
        errorMessage: event.message,
        errorShownByComposer: event.errorShownByComposer,
      };
    }
    case "SUBMIT": {
      return { tag: "creating", attempt: event.attempt, draftAgent: event.draftAgent };
    }
    case "CREATE_FAILED": {
      if (state.tag !== "creating") {
        return state;
      }
      return {
        tag: "draft",
        errorMessage: event.message,
        errorShownByComposer: event.errorShownByComposer,
      };
    }
    default:
      return assertNever(event);
  }
}

function prepareCreateAttempt<TDraftAgent>(
  attempt: CreateAttempt,
  buildDraftAgent: (attempt: CreateAttempt) => TDraftAgent,
): DraftAgentMachineState<TDraftAgent> {
  try {
    return { tag: "creating", attempt, draftAgent: buildDraftAgent(attempt) };
  } catch (error) {
    return {
      tag: "draft",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorShownByComposer: false,
    };
  }
}

/**
 * Every submit is its own creation. A failed attempt leaves a daemon receipt under its key, and
 * the daemon rejects that key for edited content, so a retry needs a fresh one. A remount
 * continues the same attempt, so the key derives from the attempt's persisted timestamp.
 */
export function buildDraftCreationKey(
  draftId: string,
  attempt: Pick<CreateAttempt, "timestamp">,
): string {
  return `${draftId}:${attempt.timestamp.getTime()}`;
}

const REQUEST_KEY_CONFLICT_PATTERN = /^(agent|workspace)_request_key_conflict$/;

function resolveCreateError(error: unknown, t: TFunction): Error {
  if (!(error instanceof Error)) {
    return new Error(t("composer.errors.failedToCreateAgent"));
  }
  if (REQUEST_KEY_CONFLICT_PATTERN.test(error.message)) {
    return new Error(t("composer.errors.requestKeyConflict"));
  }
  return error;
}

interface CreateRequestResult<TCreateResult> {
  agentId: string | null;
  result: TCreateResult;
}

interface SubmitContext {
  text: string;
  attachments: ComposerAttachment[];
  cwd: string;
}

interface CreateRequestContext {
  attempt: CreateAttempt;
  text: string;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
  cwd: string;
}

interface UseDraftAgentCreateFlowOptions<TDraftAgent, TCreateResult> {
  draftId: string;
  getPendingServerId: () => string | null;
  initialAttempt?: CreateAttempt | null;
  allowEmptyText?: boolean;
  validateBeforeSubmit?: (ctx: SubmitContext) => string | null;
  onBeforeSubmit?: (ctx: CreateRequestContext) => Promise<void> | void;
  onCreateStart?: () => void;
  createRequest: (ctx: CreateRequestContext) => Promise<CreateRequestResult<TCreateResult>>;
  buildDraftAgent: (attempt: CreateAttempt) => TDraftAgent;
  onCreateSuccess: (ctx: { result: TCreateResult; attempt: CreateAttempt }) => Promise<void> | void;
  onCreateError?: (error: Error) => void;
}

export function useDraftAgentCreateFlow<TDraftAgent, TCreateResult>({
  draftId,
  getPendingServerId,
  initialAttempt = null,
  allowEmptyText = false,
  validateBeforeSubmit,
  onBeforeSubmit,
  onCreateStart,
  createRequest,
  buildDraftAgent,
  onCreateSuccess,
  onCreateError,
}: UseDraftAgentCreateFlowOptions<TDraftAgent, TCreateResult>) {
  const { t } = useTranslation();
  const [localMachine, dispatch] = useReducer(
    reducer<TDraftAgent>,
    initialAttempt,
    (attempt): DraftAgentMachineState<TDraftAgent> =>
      attempt
        ? prepareCreateAttempt(attempt, buildDraftAgent)
        : {
            tag: "draft",
            errorMessage: "",
            errorShownByComposer: false,
          },
  );

  const pending = useCreateFlowStore((state) => state.pendingByDraftId[draftId]);
  // Remounts can precede model hydration. Rebuild the preview when its inputs
  // arrive, and observe the original request's failure through shared state.
  const machine = useMemo<DraftAgentMachineState<TDraftAgent>>(() => {
    if (pending?.lifecycle === "abandoned") {
      // This mount saw the failure (or a newer one) itself and knows where it is shown.
      if (localMachine.tag === "draft" && localMachine.errorMessage) {
        return localMachine;
      }
      return {
        tag: "draft",
        errorMessage: pending.errorMessage ?? "",
        errorShownByComposer: false,
      };
    }
    if (pending?.lifecycle === "active" && localMachine.tag === "draft" && initialAttempt) {
      return prepareCreateAttempt(initialAttempt, buildDraftAgent);
    }
    return localMachine;
  }, [pending, localMachine, initialAttempt, buildDraftAgent]);

  const setPendingCreateAttempt = useCreateFlowStore((state) => state.setPending);
  const updatePendingAgentId = useCreateFlowStore((state) => state.updateAgentId);
  const markPendingCreateLifecycle = useCreateFlowStore((state) => state.markLifecycle);
  const formErrorMessage =
    machine.tag === "draft" && !machine.errorShownByComposer ? machine.errorMessage : "";
  const isSubmitting = machine.tag === "creating";

  const submittedStreamItems = useMemo<StreamItem[]>(() => {
    if (machine.tag !== "creating") {
      return EMPTY_STREAM_ITEMS;
    }

    if (
      !machine.attempt.text &&
      (!machine.attempt.images || machine.attempt.images.length === 0) &&
      (!machine.attempt.attachments || machine.attempt.attachments.length === 0)
    ) {
      return EMPTY_STREAM_ITEMS;
    }

    return [
      createUserMessage({
        clientMessageId: machine.attempt.clientMessageId,
        text: machine.attempt.text,
        timestamp: machine.attempt.timestamp,
        images: machine.attempt.images,
        attachments: machine.attempt.attachments,
      }),
    ];
  }, [machine]);
  const pendingMessageSubmissions = useMemo<readonly PendingMessageSubmission[]>(() => {
    if (machine.tag !== "creating") return [];
    return [
      {
        clientMessageId: machine.attempt.clientMessageId,
      },
    ];
  }, [machine]);

  const draftAgent = machine.tag === "creating" ? machine.draftAgent : null;
  const startCreateAttempt = useCallback(
    (attempt: CreateAttempt, errorShownByComposer: boolean) => {
      const prepared = prepareCreateAttempt(attempt, buildDraftAgent);
      if (prepared.tag === "draft") {
        dispatch({ type: "DRAFT_SET_ERROR", message: prepared.errorMessage, errorShownByComposer });
        throw new Error(prepared.errorMessage);
      }
      dispatch({ type: "SUBMIT", attempt, draftAgent: prepared.draftAgent });
    },
    [buildDraftAgent],
  );

  const runCreateAttempt = useCallback(
    async ({
      attempt,
      cwd,
      errorShownByComposer,
    }: {
      attempt: CreateAttempt;
      cwd: string;
      errorShownByComposer: boolean;
    }) => {
      const pendingServerId = getPendingServerId();
      if (!pendingServerId) {
        const error = new Error(t("composer.errors.noHostSelected"));
        dispatch({ type: "DRAFT_SET_ERROR", message: error.message, errorShownByComposer });
        throw error;
      }

      try {
        await onBeforeSubmit?.({
          attempt,
          text: attempt.text,
          images: attempt.images,
          attachments: attempt.attachments,
          cwd,
        });
        const createResult = await createRequest({
          attempt,
          text: attempt.text,
          images: attempt.images,
          attachments: attempt.attachments,
          cwd,
        });

        if (createResult.agentId) {
          updatePendingAgentId({ draftId, agentId: createResult.agentId });
          handoffCreatedAgentMessageSubmission(
            pendingServerId,
            createResult.agentId,
            createUserMessage({
              clientMessageId: attempt.clientMessageId,
              text: attempt.text,
              timestamp: attempt.timestamp,
              images: attempt.images,
              attachments: attempt.attachments,
            }),
          );
          markPendingCreateLifecycle({ draftId, lifecycle: "sent" });
        }

        await onCreateSuccess({ result: createResult.result, attempt });
      } catch (error) {
        const resolved = resolveCreateError(error, t);
        dispatch({ type: "CREATE_FAILED", message: resolved.message, errorShownByComposer });
        markPendingCreateLifecycle({
          draftId,
          lifecycle: "abandoned",
          errorMessage: resolved.message,
        });
        onCreateError?.(resolved);
        throw resolved;
      }
    },
    [
      createRequest,
      draftId,
      getPendingServerId,
      markPendingCreateLifecycle,
      onBeforeSubmit,
      onCreateError,
      onCreateSuccess,
      t,
      updatePendingAgentId,
    ],
  );

  const createFromInput = useCallback(
    async ({ text, attachments, cwd }: SubmitContext, errorShownByComposer: boolean) => {
      const existing = useCreateFlowStore.getState().pendingByDraftId[draftId];
      if (
        isSubmitting ||
        isActiveCreateFlowForDraft({ pending: existing, serverId: getPendingServerId(), draftId })
      ) {
        throw new Error(t("composer.errors.alreadyLoading"));
      }

      const setError = (message: string) =>
        dispatch({ type: "DRAFT_SET_ERROR", message, errorShownByComposer });
      setError("");
      const trimmedPrompt = text.trim();
      const pendingServerId = getPendingServerId();
      if (!pendingServerId) {
        const error = new Error(t("composer.errors.noHostSelected"));
        setError(error.message);
        throw error;
      }
      const supportsForgeSearch =
        useSessionStore.getState().sessions[pendingServerId]?.serverInfo?.features?.forgeSearch ===
        true;
      const wirePayload = splitComposerAttachmentsForSubmit(attachments, {
        format: resolveComposerAttachmentSubmitFormat({
          supportsForgeAttachments: supportsForgeSearch,
        }),
      });
      const images = wirePayload.images;

      const hasAttachmentContent = images.length > 0 || wirePayload.attachments.length > 0;
      if (!trimmedPrompt && !hasAttachmentContent && !allowEmptyText) {
        const error = new Error(t("composer.errors.initialPromptRequired"));
        setError(error.message);
        throw error;
      }

      const validationError = validateBeforeSubmit?.({
        text: trimmedPrompt,
        attachments,
        cwd,
      });
      if (validationError) {
        const error = new Error(validationError);
        setError(validationError);
        throw error;
      }

      const attempt: CreateAttempt = {
        clientMessageId: `${draftId}:initial-message`,
        text: trimmedPrompt,
        timestamp: new Date(),
        ...(images.length > 0 ? { images } : {}),
        ...(wirePayload.attachments.length > 0 ? { attachments: wirePayload.attachments } : {}),
      };

      startCreateAttempt(attempt, errorShownByComposer);
      setPendingCreateAttempt({
        draftId,
        serverId: pendingServerId,
        agentId: null,
        clientMessageId: attempt.clientMessageId,
        text: attempt.text,
        timestamp: attempt.timestamp.getTime(),
        ...(attempt.images && attempt.images.length > 0 ? { images: attempt.images } : {}),
        ...(attempt.attachments && attempt.attachments.length > 0
          ? { attachments: attempt.attachments }
          : {}),
      });

      onCreateStart?.();
      await runCreateAttempt({ attempt, cwd, errorShownByComposer });
    },
    [
      allowEmptyText,
      draftId,
      getPendingServerId,
      isSubmitting,
      onCreateStart,
      runCreateAttempt,
      setPendingCreateAttempt,
      startCreateAttempt,
      t,
      validateBeforeSubmit,
    ],
  );

  /** For callers that show nothing themselves: failures land on the draft's banner. */
  const handleCreateFromInput = useCallback(
    (ctx: SubmitContext) => createFromInput(ctx, false),
    [createFromInput],
  );
  /** For the composer's submit: the composer shows the failure inline, so the banner stays clear. */
  const handleComposerSubmit = useCallback(
    (ctx: SubmitContext) => createFromInput(ctx, true),
    [createFromInput],
  );

  const continueCreateFromAttempt = useCallback(
    async ({ attempt, cwd }: { attempt: CreateAttempt; cwd: string }) => {
      if (!isSubmitting) {
        startCreateAttempt(attempt, false);
      }
      await runCreateAttempt({ attempt, cwd, errorShownByComposer: false });
    },
    [isSubmitting, runCreateAttempt, startCreateAttempt],
  );

  return {
    machine,
    formErrorMessage,
    isSubmitting,
    submittedStreamItems,
    pendingMessageSubmissions,
    draftAgent,
    handleCreateFromInput,
    handleComposerSubmit,
    continueCreateFromAttempt,
  };
}

export type { CreateAttempt as DraftCreateAttempt };
