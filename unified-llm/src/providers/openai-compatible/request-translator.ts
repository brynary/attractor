import type { Request } from "../../types/request.js";
import type { Message } from "../../types/message.js";
import type { ExtendedContentPart } from "../../types/content-part.js";
import type { Warning } from "../../types/response.js";
import {
  isTextPart,
  isImagePart,
  isToolCallPart,
  isToolResultPart,
} from "../../types/content-part.js";
import { Role } from "../../types/role.js";
import { encodeImageToDataUri } from "../../utils/schema-translate.js";

function translateContentPart(
  part: ExtendedContentPart,
): Record<string, unknown> | undefined {
  if (isTextPart(part)) {
    return { type: "text", text: part.text };
  }
  if (isImagePart(part)) {
    if (part.image.data) {
      return {
        type: "image_url",
        image_url: {
          url: encodeImageToDataUri(part.image.data, part.image.mediaType),
          ...(part.image.detail ? { detail: part.image.detail } : {}),
        },
      };
    }
    if (part.image.url) {
      return {
        type: "image_url",
        image_url: {
          url: part.image.url,
          ...(part.image.detail ? { detail: part.image.detail } : {}),
        },
      };
    }
  }
  return undefined;
}

function translateMessage(
  message: Message,
  warnings: Warning[],
): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];

  if (message.role === Role.SYSTEM || message.role === Role.DEVELOPER) {
    const textParts: string[] = [];
    for (const part of message.content) {
      if (isTextPart(part)) {
        textParts.push(part.text);
      }
    }
    if (textParts.length > 0) {
      results.push({ role: "system", content: textParts.join("\n") });
    }
  } else if (message.role === Role.USER) {
    const content: Array<Record<string, unknown>> = [];
    for (const part of message.content) {
      if (part.kind === "audio") {
        warnings.push({ message: "Audio content parts are not supported by OpenAI-Compatible and were dropped" });
        continue;
      }
      if (part.kind === "document") {
        warnings.push({ message: "Document content parts are not supported by OpenAI-Compatible and were dropped" });
        continue;
      }
      const translated = translateContentPart(part);
      if (translated) {
        content.push(translated);
      }
    }
    // Use string content if there's a single text part
    if (content.length === 1 && content[0]?.["type"] === "text") {
      results.push({ role: "user", content: content[0]["text"] });
    } else if (content.length > 0) {
      results.push({ role: "user", content });
    }
  } else if (message.role === Role.ASSISTANT) {
    const textParts: string[] = [];
    const toolCalls: Array<Record<string, unknown>> = [];

    for (const part of message.content) {
      if (isTextPart(part)) {
        textParts.push(part.text);
      } else if (isToolCallPart(part)) {
        const args =
          typeof part.toolCall.arguments === "string"
            ? part.toolCall.arguments
            : JSON.stringify(part.toolCall.arguments);
        toolCalls.push({
          id: part.toolCall.id,
          type: "function",
          function: { name: part.toolCall.name, arguments: args },
        });
      }
    }

    const msg: Record<string, unknown> = { role: "assistant" };
    if (textParts.length > 0) {
      msg.content = textParts.join("");
    } else {
      msg.content = null;
    }
    if (toolCalls.length > 0) {
      msg.tool_calls = toolCalls;
    }
    results.push(msg);
  } else if (message.role === Role.TOOL) {
    for (const part of message.content) {
      if (isToolResultPart(part)) {
        let content =
          typeof part.toolResult.content === "string"
            ? part.toolResult.content
            : JSON.stringify(part.toolResult.content);
        if (part.toolResult.isError) {
          content = `Error: ${content}`;
        }
        results.push({
          role: "tool",
          tool_call_id: part.toolResult.toolCallId,
          content,
        });
      }
    }
  }

  return results;
}

function translateToolChoice(
  toolChoice: Request["toolChoice"],
): string | Record<string, unknown> | undefined {
  if (!toolChoice) {
    return undefined;
  }
  switch (toolChoice.mode) {
    case "auto":
      return "auto";
    case "none":
      return "none";
    case "required":
      return "required";
    case "named":
      return { type: "function", function: { name: toolChoice.toolName } };
  }
}

export function translateRequest(
  request: Request,
  streaming: boolean,
): { body: Record<string, unknown>; headers: Record<string, string>; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const body: Record<string, unknown> = {
    model: request.model,
    stream: streaming,
  };

  if (streaming) {
    body.stream_options = { include_usage: true };
  }

  // Build messages array
  const messages: Array<Record<string, unknown>> = [];
  for (const message of request.messages) {
    const translated = translateMessage(message, warnings);
    for (const item of translated) {
      messages.push(item);
    }
  }
  body.messages = messages;

  // Tools
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  // Tool choice
  const toolChoiceValue = translateToolChoice(request.toolChoice);
  if (toolChoiceValue !== undefined) {
    body.tool_choice = toolChoiceValue;
  }

  // Temperature
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  // Top P
  if (request.topP !== undefined) {
    body.top_p = request.topP;
  }

  // Max tokens
  if (request.maxTokens !== undefined) {
    body.max_tokens = request.maxTokens;
  }

  // Stop sequences
  if (request.stopSequences && request.stopSequences.length > 0) {
    body.stop = request.stopSequences;
  }

  // Metadata
  if (request.metadata && Object.keys(request.metadata).length > 0) {
    body.metadata = request.metadata;
  }

  // Response format
  if (request.responseFormat) {
    if (request.responseFormat.type === "json_schema") {
      body.response_format = {
        type: "json_schema",
          json_schema: {
            name: "response",
            schema: request.responseFormat.jsonSchema,
            strict: request.responseFormat.strict ?? false,
          },
        };
    } else if (request.responseFormat.type === "json") {
      body.response_format = { type: "json_object" };
    }
  }

  // Merge providerOptions.openai_compatible
  const compatOptions = request.providerOptions?.["openai_compatible"];
  if (compatOptions) {
    for (const [key, value] of Object.entries(compatOptions)) {
      body[key] = value;
    }
  }

  return { body, headers: {}, warnings };
}
