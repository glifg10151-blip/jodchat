import type { Conversation } from "../../types";

export interface SythoriaBackupPayload {
  app: "Sythoria";
  sythoria_version: string;
  exported_at: string;
  conversations: Conversation[];
  systemPrompt?: string;
  memories?: Array<{
    title: string;
    content: string;
    timestamp?: string;
  }>;
}

export function exportToSythoriaJson(
  conversations: Conversation[],
  systemPrompt?: string,
  memories?: Array<{ title: string; content: string; timestamp?: string }>,
): string {
  const payload: SythoriaBackupPayload = {
    app: "Sythoria",
    sythoria_version: "0.4.4",
    exported_at: new Date().toISOString(),
    conversations,
    systemPrompt,
    memories,
  };
  return JSON.stringify(payload, null, 2);
}

export function exportToChatGptJson(conversations: Conversation[]): string {
  const exportList = conversations.map((conv) => {
    const mapping: Record<string, unknown> = {};
    let parentId: string | null = null;

    conv.messages.forEach((msg, idx) => {
      const nodeId = `node-${idx}`;
      const nextNodeId = idx < conv.messages.length - 1 ? `node-${idx + 1}` : undefined;

      mapping[nodeId] = {
        id: nodeId,
        parent: parentId,
        children: nextNodeId ? [nextNodeId] : [],
        message: {
          id: msg.id,
          author: { role: msg.role },
          create_time: msg.timestamp ? Math.floor(new Date(msg.timestamp).getTime() / 1000) : null,
          content: {
            content_type: "text",
            parts: [msg.content],
          },
        },
      };
      parentId = nodeId;
    });

    return {
      id: conv.id,
      title: conv.title,
      create_time: conv.timestamp ? Math.floor(new Date(conv.timestamp).getTime() / 1000) : null,
      mapping,
      current_node: conv.messages.length > 0 ? `node-${conv.messages.length - 1}` : undefined,
    };
  });

  return JSON.stringify(exportList, null, 2);
}

export function exportToClaudeJson(conversations: Conversation[]): string {
  const exportList = conversations.map((conv) => ({
    uuid: conv.id,
    name: conv.title,
    created_at: conv.timestamp ? new Date(conv.timestamp).toISOString() : new Date().toISOString(),
    chat_messages: conv.messages.map((m) => ({
      uuid: m.id,
      sender: m.role === "assistant" ? "assistant" : "human",
      text: m.content,
      created_at: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
    })),
  }));

  return JSON.stringify(exportList, null, 2);
}
