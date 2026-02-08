import type { Request } from "../../types/request.js";
import type { ExtendedContentPart } from "../../types/content-part.js";
import type { ToolDefinition, ToolChoice } from "../../types/tool.js";
import type { Message } from "../../types/message.js";
import type { Warning } from "../../types/response.js";
import { Role } from "../../types/role.js";
import { encodeToBase64 } from "../../utils/schema-translate.js";

interface TranslatedRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  warnings: Warning[];
}

interface TranslatePartResult {
  translated: Record<string, unknown> | undefined;
  warning?: Warning;
}

function translateContentPart(
  part: ExtendedContentPart,
): TranslatePartResult {
  switch (part.kind) {
    case "text":
      return { translated: { type: "text", text: part.text } };
    case "image": {
      if (part.image.url) {
        return {
          translated: {
            type: "image",
            source: { type: "url", url: part.image.url },
          },
        };
      }
      if (part.image.data) {
        return {
          translated: {
            type: "image",
            source: {
              type: "base64",
              media_type: part.image.mediaType ?? "image/png",
              data: encodeToBase64(part.image.data),
            },
          },
        };
      }
      return { translated: undefined };
    }
    case "audio":
      return {
        translated: undefined,
        warning: { message: "Audio content parts are not supported by the Anthropic provider and were dropped", code: "unsupported_part" },
      };
    case "document":
      return {
        translated: undefined,
        warning: { message: "Document content parts are not supported by the Anthropic provider and were dropped", code: "unsupported_part" },
      };
    case "tool_call": {
      const input =
        typeof part.toolCall.arguments === "string"
          ? JSON.parse(part.toolCall.arguments)
          : part.toolCall.arguments;
      return {
        translated: {
          type: "tool_use",
          id: part.toolCall.id,
          name: part.toolCall.name,
          input,
        },
      };
    }
    case "tool_result": {
      const textContent =
        typeof part.toolResult.content === "string"
          ? part.toolResult.content
          : JSON.stringify(part.toolResult.content);

      if (part.toolResult.imageData) {
        const contentArray: Record<string, unknown>[] = [
          { type: "text", text: textContent },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: part.toolResult.imageMediaType ?? "image/png",
              data: encodeToBase64(part.toolResult.imageData),
            },
          },
        ];
        return {
          translated: {
            type: "tool_result",
            tool_use_id: part.toolResult.toolCallId,
            content: contentArray,
            is_error: part.toolResult.isError,
          },
        };
      }

      return {
        translated: {
          type: "tool_result",
          tool_use_id: part.toolResult.toolCallId,
          content: textContent,
          is_error: part.toolResult.isError,
        },
      };
    }
    case "thinking":
      return {
        translated: {
          type: "thinking",
          thinking: part.thinking.text,
          signature: part.thinking.signature,
        },
      };
    case "redacted_thinking":
      return {
        translated: {
          type: "redacted_thinking",
          data: part.thinking.text,
        },
      };
    default:
      return { translated: undefined };
  }
}

function translateToolChoice(
  choice: ToolChoice,
): Record<string, unknown> | undefined {
  switch (choice.mode) {
    case "auto":
      return { type: "auto" };
    case "required":
      return { type: "any" };
    case "named":
      return { type: "tool", name: choice.toolName };
    case "none":
      return undefined;
    default:
      return undefined;
  }
}

function translateTools(
  tools: ToolDefinition[],
): Record<string, unknown>[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

interface AnthropicMessage {
  role: string;
  content: Record<string, unknown>[];
}

function mergeAlternatingMessages(
  messages: AnthropicMessage[],
): AnthropicMessage[] {
  const merged: AnthropicMessage[] = [];

  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      last.content = [...last.content, ...msg.content];
    } else {
      merged.push({ role: msg.role, content: [...msg.content] });
    }
  }

  return merged;
}

export function translateRequest(request: Request): TranslatedRequest {
  const systemBlocks: Record<string, unknown>[] = [];
  const conversationMessages: AnthropicMessage[] = [];
  const headers: Record<string, string> = {};
  const warnings: Warning[] = [];

  for (const message of request.messages) {
    if (message.role === Role.SYSTEM || message.role === Role.DEVELOPER) {
      for (const part of message.content) {
        const { translated, warning } = translateContentPart(part);
        if (warning) warnings.push(warning);
        if (translated) {
          systemBlocks.push(translated);
        }
      }
      continue;
    }

    const anthropicContent: Record<string, unknown>[] = [];
    for (const part of message.content) {
      const { translated, warning } = translateContentPart(part);
      if (warning) warnings.push(warning);
      if (translated) {
        anthropicContent.push(translated);
      }
    }

    if (anthropicContent.length === 0) {
      continue;
    }

    if (message.role === Role.TOOL) {
      conversationMessages.push({
        role: "user",
        content: anthropicContent,
      });
    } else {
      conversationMessages.push({
        role: message.role,
        content: anthropicContent,
      });
    }
  }

  const merged = mergeAlternatingMessages(conversationMessages);

  const body: Record<string, unknown> = {
    model: request.model,
    messages: merged,
    max_tokens: request.maxTokens ?? 4096,
  };

  if (systemBlocks.length > 0) {
    body.system = systemBlocks;
  }

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  if (request.topP !== undefined) {
    body.top_p = request.topP;
  }

  if (request.stopSequences !== undefined && request.stopSequences.length > 0) {
    body.stop_sequences = request.stopSequences;
  }

  if (request.metadata && Object.keys(request.metadata).length > 0) {
    body.metadata = request.metadata;
  }

  if (request.tools && request.tools.length > 0) {
    const isNoneMode =
      request.toolChoice !== undefined && request.toolChoice.mode === "none";

    if (!isNoneMode) {
      body.tools = translateTools(request.tools);

      if (request.toolChoice) {
        const translated = translateToolChoice(request.toolChoice);
        if (translated) {
          body.tool_choice = translated;
        }
      }
    }
  }

  const anthropicOptions = request.providerOptions?.["anthropic"];

  if (anthropicOptions?.["thinking"] !== undefined) {
    body.thinking = anthropicOptions["thinking"];
  }

  // Accept both snake_case (spec) and camelCase (legacy)
  const betaHeadersValue = anthropicOptions?.["beta_headers"] ?? anthropicOptions?.["betaHeaders"];
  if (betaHeadersValue) {
    if (typeof betaHeadersValue === "string") {
      headers["anthropic-beta"] = betaHeadersValue;
    } else if (Array.isArray(betaHeadersValue)) {
      const joined = betaHeadersValue
        .filter((h): h is string => typeof h === "string")
        .join(",");
      if (joined.length > 0) {
        headers["anthropic-beta"] = joined;
      }
    }
  }

  // M15: passthrough remaining providerOptions keys into body
  if (anthropicOptions) {
    const knownKeys = new Set(["thinking", "betaHeaders", "beta_headers", "autoCache", "auto_cache"]);
    for (const [key, value] of Object.entries(anthropicOptions)) {
      if (!knownKeys.has(key)) {
        body[key] = value;
      }
    }
  }

  // M11: responseFormat fallback (Anthropic doesn't support native JSON mode)
  if (request.responseFormat) {
    let instruction: string | undefined;
    if (request.responseFormat.type === "json_schema") {
      const schemaText = JSON.stringify(request.responseFormat.jsonSchema, null, 2);
      instruction = `Respond with valid JSON matching this schema:\n${schemaText}`;
    } else if (request.responseFormat.type === "json") {
      instruction = "Respond with valid JSON.";
    }
    if (instruction !== undefined) {
      const block = { type: "text", text: instruction };
      if (Array.isArray(body.system)) {
        body.system = [...body.system, block];
      } else {
        body.system = [block];
      }
    }
  }

  return { body, headers, warnings };
}
