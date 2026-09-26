export function parseReasoning(content: string, role: string, explicitReasoning?: string) {
  if (role === "assistant" && explicitReasoning !== undefined) {
    return {
      reasoningContent: explicitReasoning,
      displayContent: content,
      hasOpenReasoning: explicitReasoning.length > 0,
    };
  }

  // Backward compatibility for messages persisted by older releases. New streams
  // never interpret model text as a control protocol.
  const hasOpenReasoning = role === "assistant" && /^\s*<(reasoning|thinking|thought)>/.test(content);

  let reasoningContent = "";
  let displayContent = content;

  if (hasOpenReasoning) {
    const reasoningMatch =
      content.match(/<reasoning>([\s\S]*?)<\/reasoning>/) ||
      content.match(/<thinking>([\s\S]*?)<\/thinking>/) ||
      content.match(/<thought>([\s\S]*?)<\/thought>/);

    if (reasoningMatch) {
      reasoningContent = reasoningMatch[1].trim();
      displayContent = content
        .replace(/<(?:reasoning|thinking|thought)>[\s\S]*?<\/(?:reasoning|thinking|thought)>/, "")
        .trim();
    } else {
      const openMatch =
        content.match(/<reasoning>([\s\S]*)/) ||
        content.match(/<thinking>([\s\S]*)/) ||
        content.match(/<thought>([\s\S]*)/);
      if (openMatch) {
        reasoningContent = openMatch[1].trim();
        displayContent = content.replace(/<(?:reasoning|thinking|thought)>[\s\S]*/, "").trim();
      }
    }
  }

  return { reasoningContent, displayContent, hasOpenReasoning };
}
