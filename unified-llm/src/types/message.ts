import type { Role } from "./role.js";
import { Role as RoleEnum } from "./role.js";
import type { ContentPart } from "./content-part.js";
import { isTextPart } from "./content-part.js";

export interface Message {
  role: Role;
  content: ContentPart[];
  name?: string;
  toolCallId?: string;
}

export namespace Message {
  /**
   * Create a system message with the given text.
   */
  export function system(text: string): Message {
    return systemMessage(text);
  }

  /**
   * Create a user message with the given text.
   */
  export function user(text: string): Message {
    return userMessage(text);
  }

  /**
   * Create an assistant message with the given text.
   */
  export function assistant(text: string): Message {
    return assistantMessage(text);
  }

  /**
   * Create a tool result message.
   */
  export function toolResult(
    toolCallId: string,
    content: string | Record<string, unknown> | unknown[],
    isError = false,
  ): Message {
    return toolResultMessage(toolCallId, content, isError);
  }

  /**
   * Extract all text content from a message.
   */
  export function text(message: Message): string {
    return messageText(message);
  }
}

export function systemMessage(text: string): Message {
  return {
    role: RoleEnum.SYSTEM,
    content: [{ kind: "text", text }],
  };
}

export function userMessage(text: string): Message {
  return {
    role: RoleEnum.USER,
    content: [{ kind: "text", text }],
  };
}

export function assistantMessage(text: string): Message {
  return {
    role: RoleEnum.ASSISTANT,
    content: [{ kind: "text", text }],
  };
}

export function toolResultMessage(
  toolCallId: string,
  content: string | Record<string, unknown> | unknown[],
  isError = false,
): Message {
  return {
    role: RoleEnum.TOOL,
    content: [
      {
        kind: "tool_result",
        toolResult: { toolCallId, content, isError },
      },
    ],
    toolCallId,
  };
}

export function messageText(message: Message): string {
  return message.content
    .filter(isTextPart)
    .map((part) => part.text)
    .join("");
}
