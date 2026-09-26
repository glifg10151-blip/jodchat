import type { Message } from "../types";

/**
 * Estimates the number of tokens in a single message.
 * Approximation: 1 token ≈ 4 characters for text, plus ~1000 tokens for each image attachment.
 */
export function estimateMessageTokens(message: Message): number {
  let charCount = message.responsesOutput
    ? JSON.stringify(message.responsesOutput).length
    : message.content.length + (message.reasoningContent?.length ?? 0);
  let imageCount = 0;

  if (message.attachments) {
    for (const att of message.attachments) {
      if (att.kind === "text" && att.textContent) {
        // Estimate the tokens of the attached text content, including formatting overhead
        charCount += att.textContent.length + att.name.length + 50;
      } else if (att.kind === "image") {
        imageCount++;
      }
    }
  }

  // Handle tool calls / tool results if applicable
  if (message.toolCall) {
    charCount += JSON.stringify(message.toolCall).length;
  }
  if (message.toolResult) {
    charCount += message.toolResult.content.length;
    if (message.toolResult.images) {
      imageCount += message.toolResult.images.length;
    }
  }

  return Math.ceil(charCount / 4) + imageCount * 1000;
}

/**
 * Estimates the total tokens for a conversation context.
 */
export function estimateConversationTokens(
  messages: Message[],
  systemPrompt: string,
): {
  total: number;
  systemPromptTokens: number;
  messagesTokens: number;
  attachmentsTokens: number;
} {
  const systemPromptTokens = Math.ceil((systemPrompt || "").length / 4);
  let messagesTokens = 0;
  let attachmentsTokens = 0;

  for (const msg of messages) {
    let msgTextCharCount = msg.responsesOutput
      ? JSON.stringify(msg.responsesOutput).length
      : msg.content.length + (msg.reasoningContent?.length ?? 0);

    if (msg.toolCall) {
      msgTextCharCount += JSON.stringify(msg.toolCall).length;
    }
    if (msg.toolResult) {
      msgTextCharCount += msg.toolResult.content.length;
    }

    messagesTokens += Math.ceil(msgTextCharCount / 4);

    if (msg.attachments) {
      for (const att of msg.attachments) {
        if (att.kind === "text" && att.textContent) {
          attachmentsTokens += Math.ceil((att.textContent.length + att.name.length + 50) / 4);
        } else if (att.kind === "image") {
          attachmentsTokens += 1000;
        }
      }
    }
    if (msg.toolResult?.images) {
      attachmentsTokens += msg.toolResult.images.length * 1000;
    }
  }

  return {
    total: systemPromptTokens + messagesTokens + attachmentsTokens,
    systemPromptTokens,
    messagesTokens,
    attachmentsTokens,
  };
}
