import type { Conversation } from "../../types";

export function conversationToMarkdown(conversation: Conversation): string {
  const lines: string[] = [];
  lines.push(`# ${conversation.title || "Conversation"}`);
  lines.push(`*Exported on ${new Date().toLocaleString()}*`);
  if (conversation.model) {
    lines.push(`*Model: ${conversation.model}*`);
  }
  lines.push("\n---\n");

  for (const msg of conversation.messages) {
    const roleLabel =
      msg.role === "user" ? "### 👤 User" : msg.role === "assistant" ? "### 🤖 Assistant" : "### 🛠️ Tool";

    lines.push(roleLabel);
    if (msg.timestamp) {
      lines.push(`*${new Date(msg.timestamp).toLocaleString()}*\n`);
    }

    if (msg.content) {
      lines.push(msg.content.trim());
    }

    if (msg.toolCall) {
      lines.push(`\n**Tool Call:** \`${msg.toolCall.name}\``);
      lines.push("```json");
      lines.push(JSON.stringify(msg.toolCall.arguments, null, 2));
      lines.push("```");
    }

    if (msg.toolResult) {
      lines.push(`\n**Tool Result:** \`${msg.toolResult.name}\``);
      lines.push("```");
      lines.push(msg.toolResult.content.slice(0, 1000));
      lines.push("```");
    }

    lines.push("\n---\n");
  }

  return lines.join("\n");
}

export function exportAllConversationsToMarkdown(conversations: Conversation[]): string {
  const header = `# Sythoria Chat History\n*Exported ${conversations.length} conversations on ${new Date().toLocaleString()}*\n\n`;
  const body = conversations
    .map((c) => conversationToMarkdown(c))
    .join("\n\n========================================\n\n");
  return header + body;
}

export function exportMemoryToMarkdown(
  systemPrompt?: string,
  memories?: Array<{ title: string; content: string }>,
): string {
  const lines: string[] = [];
  lines.push("# Sythoria Memory & Personalization");
  lines.push(`*Exported on ${new Date().toLocaleString()}*\n`);

  if (systemPrompt && systemPrompt.trim()) {
    lines.push("## Global System Instructions");
    lines.push(systemPrompt.trim());
    lines.push("\n---\n");
  }

  if (memories && memories.length > 0) {
    lines.push("## Saved Memories & Facts");
    for (const mem of memories) {
      lines.push(`### ${mem.title}`);
      lines.push(mem.content.trim());
      lines.push("\n");
    }
  }

  return lines.join("\n");
}
