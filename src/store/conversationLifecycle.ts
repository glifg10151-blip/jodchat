import type { Conversation, GenerationState } from "../types";
import { isGenerationActive } from "../types";

type GenerationByConversation = Record<string, { state: GenerationState; label: string }>;

export interface ConversationLifecycleState {
  conversations: Conversation[];
  activeId: string | null;
  navigationHistory: string[];
  navigationIndex: number;
  compareIds: string[];
  isCompareMode: boolean;
  generationByConversation: GenerationByConversation;
  activeStreamContent: Record<string, string>;
  activeStreamReasoning: Record<string, string>;
  activeStreamThinkingStart: Record<string, number>;
  activeStreamThinkingEnd: Record<string, number>;
  activeStreamStartTime: Record<string, number>;
  isStreaming: boolean;
  generationState: GenerationState;
  generationLabel: string;
}

export interface ConversationDeletionTransitionOptions {
  preferredActiveId?: string | null;
  appendPreferredToHistory?: boolean;
}

/** Returns each requested conversation and every descendant, independent of list ordering. */
export function collectConversationTreeIds(
  conversations: readonly Conversation[],
  rootIds: Iterable<string>,
): Set<string> {
  const ids = new Set(rootIds);
  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const conversation of conversations) {
      if (conversation.parentId && ids.has(conversation.parentId) && !ids.has(conversation.id)) {
        ids.add(conversation.id);
        foundDescendant = true;
      }
    }
  }
  return ids;
}

function omitKeys<T>(record: Record<string, T>, omittedIds: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => !omittedIds.has(id)));
}

/**
 * Computes the complete in-memory state transition after external deletion cleanup succeeds.
 * Native cancellation, worktree disposal, persistence, and UI feedback intentionally remain
 * outside this reducer so the navigation and lifecycle rules can be tested deterministically.
 */
export function reduceConversationDeletion(
  state: ConversationLifecycleState,
  idsToDelete: ReadonlySet<string>,
  options: ConversationDeletionTransitionOptions = {},
): ConversationLifecycleState {
  const remainingConversations = state.conversations.filter((conversation) => !idsToDelete.has(conversation.id));
  const remainingIds = new Set(remainingConversations.map((conversation) => conversation.id));
  let navigationHistory = state.navigationHistory.filter(
    (historyId) => !idsToDelete.has(historyId) && remainingIds.has(historyId),
  );
  const preferredActiveId =
    options.preferredActiveId && remainingIds.has(options.preferredActiveId) ? options.preferredActiveId : null;
  if (options.appendPreferredToHistory && preferredActiveId) {
    navigationHistory = [...navigationHistory, preferredActiveId];
  }

  const activeWasDeleted = Boolean(state.activeId && idsToDelete.has(state.activeId));
  const fallbackActiveId =
    [...navigationHistory].reverse().find((historyId) => remainingIds.has(historyId)) ??
    remainingConversations.find((conversation) => !conversation.isSubagent)?.id ??
    null;
  const activeId = activeWasDeleted ? (preferredActiveId ?? fallbackActiveId) : state.activeId;
  const navigationIndex = activeId ? navigationHistory.lastIndexOf(activeId) : -1;
  const compareIds = state.compareIds.filter((compareId) => !idsToDelete.has(compareId) && remainingIds.has(compareId));
  const generationByConversation = omitKeys(state.generationByConversation, idsToDelete);
  const isStreaming = Object.values(generationByConversation).some((generation) =>
    isGenerationActive(generation.state),
  );

  return {
    ...state,
    conversations: remainingConversations,
    activeId,
    navigationHistory,
    navigationIndex,
    compareIds,
    isCompareMode: state.isCompareMode && compareIds.length > 0 && !activeWasDeleted,
    generationByConversation,
    activeStreamContent: omitKeys(state.activeStreamContent, idsToDelete),
    activeStreamReasoning: omitKeys(state.activeStreamReasoning, idsToDelete),
    activeStreamThinkingStart: omitKeys(state.activeStreamThinkingStart, idsToDelete),
    activeStreamThinkingEnd: omitKeys(state.activeStreamThinkingEnd, idsToDelete),
    activeStreamStartTime: omitKeys(state.activeStreamStartTime, idsToDelete),
    isStreaming,
    generationState: isStreaming ? state.generationState : "idle",
    generationLabel: isStreaming ? state.generationLabel : "",
  };
}
