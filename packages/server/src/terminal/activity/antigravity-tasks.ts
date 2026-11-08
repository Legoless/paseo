import {
  closeSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRealpathAwarePathMatcher, isRealpathInsideRoot } from "../../utils/path.js";

const HISTORY_FILE_NAME = "history.jsonl";
const HISTORY_READ_CAP_BYTES = 2 * 1024 * 1024;
const WORKSPACE_CONVERSATION_SCAN_LIMIT = 8;
const RELATED_CONVERSATION_SCAN_LIMIT = 4;
const RECENT_BRAIN_SCAN_LIMIT = 8;
const UUID_DIRECTORY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AntigravityVisibleTrayTask {
  startTime: string;
  description: string;
  truncated: boolean;
}

export interface AntigravityTrayTaskSummary {
  visibleTasks: readonly AntigravityVisibleTrayTask[];
  taskCount: number | null;
}

export interface AntigravityDaemonTaskCheckerOptions {
  getCwd: () => string;
  cliHomeDir?: string;
}

interface HistoryEntry {
  conversationId: string;
  workspace: string;
}

interface HistoryCache {
  size: number;
  mtimeMs: number;
  entries: HistoryEntry[];
}

interface RecentBrainsCache {
  mtimeMs: number;
  conversationIds: string[];
}

interface RecentBrainCandidate {
  conversationId: string;
  mtimeMs: number;
}

interface TaskDescriptions {
  fullDescription: string;
  firstLineDescription: string;
}

interface CwdConversationMatches {
  exactIds: string[];
  relatedIds: string[];
}

interface PendingToolCall {
  isDaemon: boolean;
  closesOnSenderMessage: boolean;
  cancelsOnAnyMessage: boolean;
  cancelsOnSenderId: string | null;
}

interface TrackedBackgroundTask {
  taskId: string;
  isDaemon: boolean;
  closesOnSenderMessage: boolean;
  cancelsOnAnyMessage: boolean;
  cancelsOnSenderId: string | null;
  startTime: string | null;
  fullDescription: string;
  firstLineDescription: string;
}

interface ConversationTaskState {
  transcriptSize: number;
  transcriptMtimeMs: number;
  carryBuffer: Buffer;
  pendingToolCalls: PendingToolCall[];
  tasksById: Map<string, TrackedBackgroundTask>;
  closedTaskIds: Set<string>;
  messagesMtimeMs: number;
  undeliveredMtimeMs: number;
  seenMessageFiles: Set<string>;
}

export function resolveAntigravityCliHomeDir(homeDir = homedir()): string {
  return join(homeDir, ".gemini", "antigravity-cli");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function isFilesystemUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }
  return (
    error.code === "ENOENT" ||
    error.code === "ENOTDIR" ||
    error.code === "EACCES" ||
    error.code === "EPERM"
  );
}

function statIfAvailable(targetPath: string): Stats | null {
  try {
    return statSync(targetPath);
  } catch (error) {
    if (isFilesystemUnavailableError(error)) {
      return null;
    }
    throw error;
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeAntigravityClockTime(clockTime: string): string {
  const trimmed = clockTime.trim();
  return trimmed.length === 7 ? `0${trimmed}` : trimmed;
}

function unwrapArgString(rawValue: unknown): string | null {
  if (typeof rawValue !== "string") {
    return null;
  }
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(rawValue);
      if (typeof parsed === "string") {
        return parsed;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }
  return rawValue;
}

function parseBooleanArg(rawValue: unknown): boolean {
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (typeof rawValue === "string") {
    return unwrapArgString(rawValue)?.toLowerCase() === "true";
  }
  return false;
}

function parsePendingToolCall(rawCall: unknown): PendingToolCall {
  if (!isRecord(rawCall)) {
    return {
      isDaemon: false,
      closesOnSenderMessage: true,
      cancelsOnAnyMessage: false,
      cancelsOnSenderId: null,
    };
  }
  const toolName = typeof rawCall.name === "string" ? rawCall.name : "";
  const rawArgs = isRecord(rawCall.args) ? rawCall.args : {};
  const isDaemon = parseBooleanArg(rawArgs.IsDaemon);
  const cronExpression = unwrapArgString(rawArgs.CronExpression);
  const isRecurringCron =
    toolName === "schedule" && cronExpression !== null && cronExpression.trim().length > 0;
  const timerCondition = toolName === "schedule" ? unwrapArgString(rawArgs.TimerCondition) : null;
  const hasEarlyCancel =
    timerCondition !== null && timerCondition.length > 0 && timerCondition !== "never";

  return {
    isDaemon,
    closesOnSenderMessage: !isRecurringCron,
    cancelsOnAnyMessage: hasEarlyCancel && timerCondition === "any",
    cancelsOnSenderId: hasEarlyCancel && timerCondition !== "any" ? timerCondition : null,
  };
}

function formatLocalClockTime(isoTimestamp: string): string | null {
  const offsetMatch = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(?:[+-]\d{2}:\d{2})/.exec(
    isoTimestamp,
  );
  if (offsetMatch) {
    return offsetMatch[1];
  }
  const parsedDate = new Date(isoTimestamp);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  const hours = String(parsedDate.getHours()).padStart(2, "0");
  const minutes = String(parsedDate.getMinutes()).padStart(2, "0");
  const seconds = String(parsedDate.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function extractTaskStartTime(content: string, createdAt: string | null): string | null {
  const createdLineMatch = /^Created At:\s*(\S+)/m.exec(content);
  if (createdLineMatch) {
    const fromContent = formatLocalClockTime(createdLineMatch[1]);
    if (fromContent !== null) {
      return fromContent;
    }
  }
  return createdAt !== null ? formatLocalClockTime(createdAt) : null;
}

function extractTaskDescription(content: string): TaskDescriptions {
  const marker = "Task Description:";
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) {
    return { fullDescription: "", firstLineDescription: "" };
  }
  const afterMarker = content.slice(markerIndex + marker.length);
  const logsMarkerIndex = afterMarker.indexOf("\nTask logs are available at:");
  const rawSlice = logsMarkerIndex >= 0 ? afterMarker.slice(0, logsMarkerIndex) : afterMarker;
  const rawDescription = rawSlice.trim();
  const firstLine = rawDescription.split(/\r?\n/)[0] ?? "";
  return {
    fullDescription: normalizeWhitespace(rawDescription),
    firstLineDescription: normalizeWhitespace(firstLine),
  };
}

function closeTasksForSender(state: ConversationTaskState, senderId: string): void {
  const senderTask = state.tasksById.get(senderId);
  if (senderTask?.closesOnSenderMessage) {
    state.closedTaskIds.add(senderId);
  }
  for (const task of state.tasksById.values()) {
    if (task.cancelsOnAnyMessage || task.cancelsOnSenderId === senderId) {
      state.closedTaskIds.add(task.taskId);
    }
  }
}

function applyGenericStep(state: ConversationTaskState, stepRecord: Record<string, unknown>): void {
  const toolCall = state.pendingToolCalls.shift() ?? {
    isDaemon: false,
    closesOnSenderMessage: true,
    cancelsOnAnyMessage: false,
    cancelsOnSenderId: null,
  };
  const content = typeof stepRecord.content === "string" ? stepRecord.content : "";
  if (content.length === 0) {
    return;
  }

  if (stepRecord.status === "RUNNING") {
    const taskIdMatch = /Tool is running as a background task with task id:\s*(\S+)/.exec(content);
    if (taskIdMatch) {
      const createdAt = typeof stepRecord.created_at === "string" ? stepRecord.created_at : null;
      const descriptions = extractTaskDescription(content);
      state.tasksById.set(taskIdMatch[1], {
        taskId: taskIdMatch[1],
        isDaemon: toolCall.isDaemon,
        closesOnSenderMessage: toolCall.closesOnSenderMessage,
        cancelsOnAnyMessage: toolCall.cancelsOnAnyMessage,
        cancelsOnSenderId: toolCall.cancelsOnSenderId,
        startTime: extractTaskStartTime(content, createdAt),
        fullDescription: descriptions.fullDescription,
        firstLineDescription: descriptions.firstLineDescription,
      });
    }
  }

  const cancelledMatch = /Task "([^"]+)" cancelled\./.exec(content);
  if (cancelledMatch) {
    state.closedTaskIds.add(cancelledMatch[1]);
  }
  const notRunningMatch = /cannot kill task "([^"]+)": task is not running/.exec(content);
  if (notRunningMatch) {
    state.closedTaskIds.add(notRunningMatch[1]);
  }
  for (const statusMatch of content.matchAll(
    /Task:\s*(\S+)\r?\nStatus:\s*(?:DONE|ERROR|CANCELLED|CANCELED)\b/g,
  )) {
    state.closedTaskIds.add(statusMatch[1]);
  }
}

function applySystemMessageStep(state: ConversationTaskState, content: string): void {
  if (content.includes("All your subagents and background tasks have been stopped")) {
    for (const taskId of state.tasksById.keys()) {
      state.closedTaskIds.add(taskId);
    }
    return;
  }
  if (!content.includes("[Message]")) {
    return;
  }
  for (const finishedMatch of content.matchAll(/Task id "([^"]+)" finished\b/g)) {
    state.closedTaskIds.add(finishedMatch[1]);
  }
  for (const senderMatch of content.matchAll(/\[Message\][^\n]*?\bsender=(\S+)/g)) {
    closeTasksForSender(state, senderMatch[1]);
  }
}

function applyTranscriptLine(state: ConversationTaskState, line: string): void {
  const stepRecord = parseJsonRecord(line);
  if (!stepRecord) {
    return;
  }
  const stepType = stepRecord.type;
  if (stepType === "PLANNER_RESPONSE") {
    const rawToolCalls = Array.isArray(stepRecord.tool_calls) ? stepRecord.tool_calls : [];
    state.pendingToolCalls = rawToolCalls.map(parsePendingToolCall);
    return;
  }
  if (stepType === "USER_INPUT") {
    state.pendingToolCalls = [];
    return;
  }
  if (stepType === "GENERIC") {
    applyGenericStep(state, stepRecord);
    return;
  }
  if (stepType === "SYSTEM_MESSAGE" && typeof stepRecord.content === "string") {
    applySystemMessageStep(state, stepRecord.content);
  }
}

function readTranscriptTailSlice(
  filePath: string,
  startOffset: number,
  byteLength: number,
): Buffer {
  const fd = openSync(filePath, "r");
  try {
    const slice = Buffer.allocUnsafe(byteLength);
    const bytesRead = readSync(fd, slice, 0, byteLength, startOffset);
    return bytesRead === byteLength ? slice : slice.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function syncTranscriptSteps(state: ConversationTaskState, transcriptPath: string): boolean {
  const transcriptStats = statIfAvailable(transcriptPath);
  if (!transcriptStats || !transcriptStats.isFile()) {
    return false;
  }
  if (transcriptStats.size < state.transcriptSize) {
    state.transcriptSize = 0;
    state.transcriptMtimeMs = 0;
    state.carryBuffer = Buffer.alloc(0);
    state.pendingToolCalls = [];
    state.tasksById.clear();
    state.closedTaskIds.clear();
  }
  if (
    transcriptStats.size === state.transcriptSize &&
    transcriptStats.mtimeMs === state.transcriptMtimeMs
  ) {
    return true;
  }
  const deltaLength = transcriptStats.size - state.transcriptSize;
  if (deltaLength <= 0) {
    state.transcriptMtimeMs = transcriptStats.mtimeMs;
    return true;
  }

  let appended: Buffer;
  try {
    appended = readTranscriptTailSlice(transcriptPath, state.transcriptSize, deltaLength);
  } catch (error) {
    if (isFilesystemUnavailableError(error)) {
      return false;
    }
    throw error;
  }

  state.transcriptSize += appended.length;
  state.transcriptMtimeMs = transcriptStats.mtimeMs;

  const combined =
    state.carryBuffer.length > 0 ? Buffer.concat([state.carryBuffer, appended]) : appended;
  const lastNewline = combined.lastIndexOf(0x0a);
  if (lastNewline < 0) {
    state.carryBuffer = combined;
    return true;
  }

  const completeLines = combined.subarray(0, lastNewline).toString("utf8");
  state.carryBuffer = Buffer.from(combined.subarray(lastNewline + 1));

  for (const rawLine of completeLines.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length > 0) {
      applyTranscriptLine(state, trimmed);
    }
  }
  return true;
}

function syncMessageDirectory(
  state: ConversationTaskState,
  directoryPath: string,
  previousMtimeMs: number,
): number {
  const dirStats = statIfAvailable(directoryPath);
  if (!dirStats || !dirStats.isDirectory()) {
    return 0;
  }
  if (dirStats.mtimeMs === previousMtimeMs) {
    return previousMtimeMs;
  }
  let entries: string[];
  try {
    entries = readdirSync(directoryPath);
  } catch (error) {
    if (isFilesystemUnavailableError(error)) {
      return previousMtimeMs;
    }
    throw error;
  }

  for (const entryName of entries) {
    if (!entryName.endsWith(".json") || state.seenMessageFiles.has(entryName)) {
      continue;
    }
    let rawMessage: string;
    try {
      rawMessage = readFileSync(join(directoryPath, entryName), "utf8");
    } catch (error) {
      if (isFilesystemUnavailableError(error)) {
        continue;
      }
      throw error;
    }
    const envelope = parseJsonRecord(rawMessage);
    if (!envelope) {
      continue;
    }
    state.seenMessageFiles.add(entryName);
    if (typeof envelope.sender === "string" && envelope.sender.length > 0) {
      closeTasksForSender(state, envelope.sender);
    }
  }
  return dirStats.mtimeMs;
}

function matchesVisibleTrayTask(
  task: TrackedBackgroundTask,
  visibleTask: AntigravityVisibleTrayTask,
): boolean {
  const normalizedTrayTime = normalizeAntigravityClockTime(visibleTask.startTime);
  if (task.startTime !== null && task.startTime !== normalizedTrayTime) {
    return false;
  }
  if (visibleTask.truncated) {
    return (
      task.fullDescription.startsWith(visibleTask.description) ||
      task.firstLineDescription.startsWith(visibleTask.description)
    );
  }
  return (
    task.fullDescription === visibleTask.description ||
    task.firstLineDescription === visibleTask.description
  );
}

function readTailHistoryEntries(historyPath: string): HistoryEntry[] {
  const fd = openSync(historyPath, "r");
  let rawHistory: string;
  try {
    const fileStats = fstatSync(fd);
    const startOffset = Math.max(0, fileStats.size - HISTORY_READ_CAP_BYTES);
    const byteLength = fileStats.size - startOffset;
    const slice = Buffer.allocUnsafe(byteLength);
    const bytesRead = readSync(fd, slice, 0, byteLength, startOffset);
    rawHistory = slice.subarray(0, bytesRead).toString("utf8");
    if (startOffset > 0) {
      const firstNewline = rawHistory.indexOf("\n");
      rawHistory = firstNewline >= 0 ? rawHistory.slice(firstNewline + 1) : "";
    }
  } finally {
    closeSync(fd);
  }

  const entries: HistoryEntry[] = [];
  for (const line of rawHistory.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const parsed = parseJsonRecord(trimmed);
    if (
      parsed &&
      typeof parsed.conversationId === "string" &&
      parsed.conversationId.length > 0 &&
      typeof parsed.workspace === "string" &&
      parsed.workspace.length > 0
    ) {
      entries.push({
        conversationId: parsed.conversationId,
        workspace: parsed.workspace,
      });
    }
  }
  return entries;
}

export function createAntigravityDaemonTaskChecker(
  options: AntigravityDaemonTaskCheckerOptions,
): (traySummary: AntigravityTrayTaskSummary) => boolean {
  const cliHomeDir = options.cliHomeDir ?? resolveAntigravityCliHomeDir();
  const historyPath = join(cliHomeDir, HISTORY_FILE_NAME);
  const brainRootDir = join(cliHomeDir, "brain");
  const conversationStates = new Map<string, ConversationTaskState>();
  let historyCache: HistoryCache | null = null;
  let recentBrainsCache: RecentBrainsCache | null = null;
  let cachedMatcherCwd: string | null = null;
  let cachedCwdMatcher: ((candidate: string) => boolean) | null = null;

  function matchesCurrentCwd(cwd: string): (candidate: string) => boolean {
    if (cachedMatcherCwd === cwd && cachedCwdMatcher !== null) {
      return cachedCwdMatcher;
    }
    cachedMatcherCwd = cwd;
    cachedCwdMatcher = createRealpathAwarePathMatcher(cwd);
    return cachedCwdMatcher;
  }

  function loadHistoryEntries(): HistoryEntry[] {
    const historyStats = statIfAvailable(historyPath);
    if (!historyStats || !historyStats.isFile()) {
      return [];
    }
    if (
      historyCache !== null &&
      historyCache.size === historyStats.size &&
      historyCache.mtimeMs === historyStats.mtimeMs
    ) {
      return historyCache.entries;
    }
    try {
      const entries = readTailHistoryEntries(historyPath);
      historyCache = {
        size: historyStats.size,
        mtimeMs: historyStats.mtimeMs,
        entries,
      };
      return entries;
    } catch (error) {
      if (isFilesystemUnavailableError(error)) {
        return [];
      }
      throw error;
    }
  }

  function listRecentBrainConversationIds(): string[] {
    const brainStats = statIfAvailable(brainRootDir);
    if (!brainStats || !brainStats.isDirectory()) {
      return [];
    }
    if (recentBrainsCache !== null && recentBrainsCache.mtimeMs === brainStats.mtimeMs) {
      return recentBrainsCache.conversationIds;
    }
    let directoryEntries: string[];
    try {
      directoryEntries = readdirSync(brainRootDir);
    } catch (error) {
      if (isFilesystemUnavailableError(error)) {
        return [];
      }
      throw error;
    }
    const candidates: RecentBrainCandidate[] = [];
    for (const dirName of directoryEntries) {
      if (!UUID_DIRECTORY_PATTERN.test(dirName)) {
        continue;
      }
      const transcriptStats = statIfAvailable(
        join(brainRootDir, dirName, ".system_generated", "logs", "transcript.jsonl"),
      );
      if (transcriptStats) {
        candidates.push({ conversationId: dirName, mtimeMs: transcriptStats.mtimeMs });
      }
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const recentCandidates = candidates.slice(0, RECENT_BRAIN_SCAN_LIMIT);
    const conversationIds = recentCandidates.map((candidate) => candidate.conversationId);
    recentBrainsCache = { mtimeMs: brainStats.mtimeMs, conversationIds };
    return conversationIds;
  }

  function getOpenTasks(conversationId: string): TrackedBackgroundTask[] {
    let state = conversationStates.get(conversationId);
    if (!state) {
      state = {
        transcriptSize: 0,
        transcriptMtimeMs: 0,
        carryBuffer: Buffer.alloc(0),
        pendingToolCalls: [],
        tasksById: new Map(),
        closedTaskIds: new Set(),
        messagesMtimeMs: 0,
        undeliveredMtimeMs: 0,
        seenMessageFiles: new Set(),
      };
      conversationStates.set(conversationId, state);
    }

    const systemGeneratedDir = join(brainRootDir, conversationId, ".system_generated");
    const transcriptFound = syncTranscriptSteps(
      state,
      join(systemGeneratedDir, "logs", "transcript.jsonl"),
    );
    if (!transcriptFound) {
      return [];
    }

    const messagesDir = join(systemGeneratedDir, "messages");
    state.messagesMtimeMs = syncMessageDirectory(state, messagesDir, state.messagesMtimeMs);
    state.undeliveredMtimeMs = syncMessageDirectory(
      state,
      join(messagesDir, "undelivered"),
      state.undeliveredMtimeMs,
    );

    const openTasks: TrackedBackgroundTask[] = [];
    for (const task of state.tasksById.values()) {
      if (!state.closedTaskIds.has(task.taskId)) {
        openTasks.push(task);
      }
    }
    return openTasks;
  }

  function collectCwdConversationIds(cwd: string): CwdConversationMatches {
    const entries = loadHistoryEntries();
    if (entries.length === 0) {
      return { exactIds: [], relatedIds: [] };
    }
    const matchesCwd = matchesCurrentCwd(cwd);
    const exactSet = new Set<string>();
    const relatedSet = new Set<string>();

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (exactSet.has(entry.conversationId) || relatedSet.has(entry.conversationId)) {
        continue;
      }
      if (exactSet.size < WORKSPACE_CONVERSATION_SCAN_LIMIT && matchesCwd(entry.workspace)) {
        exactSet.add(entry.conversationId);
        continue;
      }
      const isRelated =
        relatedSet.size < RELATED_CONVERSATION_SCAN_LIMIT &&
        (isRealpathInsideRoot(entry.workspace, cwd) || isRealpathInsideRoot(cwd, entry.workspace));
      if (isRelated) {
        relatedSet.add(entry.conversationId);
      }
      if (
        exactSet.size >= WORKSPACE_CONVERSATION_SCAN_LIMIT &&
        relatedSet.size >= RELATED_CONVERSATION_SCAN_LIMIT
      ) {
        break;
      }
    }

    return {
      exactIds: [...exactSet],
      relatedIds: [...relatedSet],
    };
  }

  function evaluateVisibleTasksInConversation(
    openTasks: readonly TrackedBackgroundTask[],
    traySummary: AntigravityTrayTaskSummary,
  ): boolean | null {
    const matchedPerRow = traySummary.visibleTasks.map((visibleTask) =>
      openTasks.filter((task) => matchesVisibleTrayTask(task, visibleTask)),
    );
    if (matchedPerRow.some((matches) => matches.length === 0)) {
      return null;
    }
    const allVisibleDaemon = matchedPerRow.every((matches) =>
      matches.every((task) => task.isDaemon),
    );
    if (!allVisibleDaemon) {
      return false;
    }
    if (traySummary.taskCount !== null && traySummary.taskCount > traySummary.visibleTasks.length) {
      return openTasks.length >= traySummary.taskCount && openTasks.every((task) => task.isDaemon);
    }
    return true;
  }

  return function areTrayTasksDaemonOnly(traySummary: AntigravityTrayTaskSummary): boolean {
    const hasVisibleTasks = traySummary.visibleTasks.length > 0;
    const hasTaskCount = traySummary.taskCount !== null && traySummary.taskCount > 0;
    if (!hasVisibleTasks && !hasTaskCount) {
      return false;
    }

    const cwd = options.getCwd();
    const { exactIds, relatedIds } = collectCwdConversationIds(cwd);
    const cwdCandidates = [...exactIds, ...relatedIds];

    if (hasVisibleTasks) {
      for (const conversationId of cwdCandidates) {
        const verdict = evaluateVisibleTasksInConversation(
          getOpenTasks(conversationId),
          traySummary,
        );
        if (verdict !== null) {
          return verdict;
        }
      }
      const cwdCandidateSet = new Set(cwdCandidates);
      for (const conversationId of listRecentBrainConversationIds()) {
        if (cwdCandidateSet.has(conversationId)) {
          continue;
        }
        const verdict = evaluateVisibleTasksInConversation(
          getOpenTasks(conversationId),
          traySummary,
        );
        if (verdict !== null) {
          return verdict;
        }
      }
      return false;
    }

    const expectedCount = traySummary.taskCount ?? 0;
    const exactOpenLists = exactIds.map((conversationId) => getOpenTasks(conversationId));
    const primaryMatches = exactOpenLists.filter((openTasks) => openTasks.length === expectedCount);
    if (primaryMatches.length > 0) {
      return primaryMatches.every((openTasks) => openTasks.every((task) => task.isDaemon));
    }
    const relatedOpenLists = relatedIds.map((conversationId) => getOpenTasks(conversationId));
    const relatedMatches = relatedOpenLists.filter(
      (openTasks) => openTasks.length === expectedCount,
    );
    return (
      relatedMatches.length > 0 &&
      relatedMatches.every((openTasks) => openTasks.every((task) => task.isDaemon))
    );
  };
}
