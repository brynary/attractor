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
  content: string,
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
