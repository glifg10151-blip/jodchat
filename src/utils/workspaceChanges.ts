import type { Message, WorkspaceChangeSet } from "../types";

/** Keep a captured change set with the visible assistant response for that run. */
export function attachWorkspaceChangesToLatestAssistant(
  messages: Message[],
  workspaceChanges: WorkspaceChangeSet | undefined,
): Message[] {
  if (!workspaceChanges?.files.length) return messages;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || message.isSystem) continue;
    if (message.workspaceChanges === workspaceChanges) return messages;

    const updated = [...messages];
    updated[index] = { ...message, workspaceChanges };
    return updated;
  }

  return messages;
}

/** Remove every persisted copy of a successfully undone workspace patch. */
export function removeWorkspaceChangesByUndoToken(messages: Message[], undoToken: string): Message[] {
  let changed = false;
  const updated = messages.map((message) => {
    if (message.workspaceChanges?.undoToken !== undoToken) return message;
    changed = true;
    const { workspaceChanges: _workspaceChanges, ...rest } = message;
    return rest;
  });
  return changed ? updated : messages;
}
