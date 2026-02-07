import { rec } from "../../utils/extract.js";

export function injectCacheControl(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(body);

  // 1. Last system content block
  if (Array.isArray(result["system"])) {
    const systemBlocks = result["system"];
    if (systemBlocks.length > 0) {
      const last = systemBlocks[systemBlocks.length - 1];
      const lastRec = rec(last);
      if (lastRec) {
        lastRec["cache_control"] = { type: "ephemeral" };
      }
    }
  }

  // 2. Last tool definition
  if (Array.isArray(result["tools"])) {
    const tools = result["tools"];
    if (tools.length > 0) {
      const last = tools[tools.length - 1];
      const lastRec = rec(last);
      if (lastRec) {
        lastRec["cache_control"] = { type: "ephemeral" };
      }
    }
  }

  // 3. Last content block of the second-to-last message
  if (Array.isArray(result["messages"])) {
    const messages = result["messages"];
    if (messages.length >= 2) {
      const secondToLast = rec(messages[messages.length - 2]);
      if (secondToLast && Array.isArray(secondToLast["content"])) {
        const content = secondToLast["content"];
        if (content.length > 0) {
          const lastBlock = rec(content[content.length - 1]);
          if (lastBlock) {
            lastBlock["cache_control"] = { type: "ephemeral" };
          }
        }
      }
    }
  }

  return result;
}
