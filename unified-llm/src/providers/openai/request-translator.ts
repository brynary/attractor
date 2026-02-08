import type { Request } from "../../types/request.js";
import type { Message } from "../../types/message.js";
import type { ContentPart } from "../../types/content-part.js";
import type { Warning } from "../../types/response.js";
import {
  isTextPart,
  isImagePart,
  isAudioPart,
  isDocumentPart,
  isToolCallPart,
  isToolResultPart,
  isThinkingPart,
  isRedactedThinkingPart,
} from "../../types/content-part.js";
import { Role } from "../../types/role.js";
import { encodeImageToDataUri, enforceStrictSchema } from "../../utils/schema-translate.js";

interface TranslatePartResult {
  translated: Record<string, unknown> | undefined;
  warning?: Warning;
}

function translateContentPartToInput(part: ContentPart): TranslatePartResult {
  if (isTextPart(part)) {
    return { translated: { type: "input_text", text: part.text } };
  }
  if (isImagePart(part)) {
    const result: Record<string, unknown> = { type: "input_image" };
    if (part.image.data) {
      result.image_url = encodeImageToDataUri(part.image.data, part.image.mediaType);
    } else if (part.image.url) {
      result.image_url = part.image.url;
    } else {
      return { translated: undefined };
    }
    if (part.image.detail) {
      result.detail = part.image.detail;
    }
    return { translated: result };
  }
  if (isAudioPart(part)) {
    return {
      translated: undefined,
      warning: { message: "Audio content parts are not supported by the OpenAI provider and were dropped", code: "unsupported_part" },
    };
  }
  if (isDocumentPart(part)) {
    return {
      translated: undefined,
      warning: { message: "Document content parts are not supported by the OpenAI provider and were dropped", code: "unsupported_part" },
    };
  }
  return { translated: undefined };
}

function translateAssistantContentPart(part: ContentPart): Record<string, unknown> | undefined {
  if (isTextPart(part)) {
    return { type: "output_text", text: part.text };
  }
  // Strip thinking/redacted_thinking parts from cross-provider conversations (spec 3.5)
  if (isThinkingPart(part) || isRedactedThinkingPart(part)) {
    return undefined;
  }
  return undefined;
}

function translateMessage(message: Message, warnings: Warning[]): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];

  if (message.role === Role.USER) {
    const content: Array<Record<string, unknown>> = [];
    for (const part of message.content) {
      const { translated, warning } = translateContentPartToInput(part);
      if (warning) warnings.push(warning);
      if (translated) {
        content.push(translated);
      }
    }
    items.push({ type: "message", role: "user", content });
  } else if (message.role === Role.ASSISTANT) {
    const contentParts: Array<Record<string, unknown>> = [];
    for (const part of message.content) {
      if (isToolCallPart(part)) {
        // Tool calls become separate top-level function_call items
        const args =
          typeof part.toolCall.arguments === "string"
            ? part.toolCall.arguments
            : JSON.stringify(part.toolCall.arguments);
        items.push({
          type: "function_call",
          call_id: part.toolCall.id,
          name: part.toolCall.name,
          arguments: args,
        });
      } else {
        const translated = translateAssistantContentPart(part);
        if (translated) {
          contentParts.push(translated);
        }
      }
    }
    if (contentParts.length > 0) {
      items.push({ type: "message", role: "assistant", content: contentParts });
    }
  } else if (message.role === Role.TOOL) {
    for (const part of message.content) {
      if (isToolResultPart(part)) {
        let output =
          typeof part.toolResult.content === "string"
            ? part.toolResult.content
            : JSON.stringify(part.toolResult.content);

        // OpenAI function_call_output only supports string output, so
        // tool result images are encoded as data URIs appended to the text.
        if (part.toolResult.imageData) {
          const dataUri = encodeImageToDataUri(
            part.toolResult.imageData,
            part.toolResult.imageMediaType,
          );
          output = output ? `${output}\n${dataUri}` : dataUri;
        }

        const item: Record<string, unknown> = {
          type: "function_call_output",
          call_id: part.toolResult.toolCallId,
          output,
        };

        if (part.toolResult.isError) {
          item.status = "error";
        }

        items.push(item);
      }
    }
  }

  return items;
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
      return { type: "function", name: toolChoice.toolName };
  }
}

export function translateRequest(
  request: Request,
  streaming: boolean,
): { body: Record<string, unknown>; headers: Record<string, string>; warnings: Warning[] } {
  const body: Record<string, unknown> = {
    model: request.model,
    stream: streaming,
  };
  const warnings: Warning[] = [];

  // Extract system/developer messages into instructions
  const instructionTexts: string[] = [];
  const inputItems: Array<Record<string, unknown>> = [];

  for (const message of request.messages) {
    if (message.role === Role.SYSTEM || message.role === Role.DEVELOPER) {
      for (const part of message.content) {
        if (isTextPart(part)) {
          instructionTexts.push(part.text);
        }
      }
    } else {
      const translated = translateMessage(message, warnings);
      for (const item of translated) {
        inputItems.push(item);
      }
    }
  }

  if (instructionTexts.length > 0) {
    body.instructions = instructionTexts.join("\n");
  }

  if (inputItems.length > 0) {
    body.input = inputItems;
  }

  // Tools — OpenAI strict mode requires additionalProperties: false
  // and all properties listed in required (recursively for nested objects)
  const tools: Array<Record<string, unknown>> = [];

  if (request.tools && request.tools.length > 0) {
    for (const tool of request.tools) {
      tools.push({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: enforceStrictSchema({ ...tool.parameters }),
        strict: true,
      });
    }
  }

  // Append built-in tools from providerOptions
  const openaiOptions = request.providerOptions?.["openai"];
  const builtinTools = openaiOptions?.["builtin_tools"];
  if (builtinTools && Array.isArray(builtinTools)) {
    for (const builtinTool of builtinTools) {
      if (typeof builtinTool === "string") {
        tools.push({ type: builtinTool });
      } else if (typeof builtinTool === "object" && builtinTool !== null) {
        tools.push(builtinTool as Record<string, unknown>);
      }
    }
  }

  if (tools.length > 0) {
    body.tools = tools;
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
    body.max_output_tokens = request.maxTokens;
  }

  // Stop sequences
  if (request.stopSequences && request.stopSequences.length > 0) {
    body.stop = request.stopSequences;
  }

  // Reasoning effort
  if (request.reasoningEffort) {
    body.reasoning = { effort: request.reasoningEffort };
  }

  // Response format
  if (request.responseFormat) {
    if (request.responseFormat.type === "json_schema") {
      body.text = {
        format: {
          type: "json_schema",
          schema: request.responseFormat.jsonSchema,
          name: "response",
          strict: request.responseFormat.strict ?? true,
        },
      };
    } else if (request.responseFormat.type === "json") {
      body.text = {
        format: { type: "json_object" },
      };
    }
  }

  // Merge providerOptions.openai (skip builtin_tools since it was already processed)
  if (openaiOptions) {
    for (const [key, value] of Object.entries(openaiOptions)) {
      if (key !== "builtin_tools") {
        body[key] = value;
      }
    }
  }

  return { body, headers: {}, warnings };
}
