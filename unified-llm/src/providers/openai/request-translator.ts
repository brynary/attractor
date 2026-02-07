import type { Request } from "../../types/request.js";
import type { Message } from "../../types/message.js";
import type { ContentPart } from "../../types/content-part.js";
import {
  isTextPart,
  isImagePart,
  isToolCallPart,
  isToolResultPart,
} from "../../types/content-part.js";
import { Role } from "../../types/role.js";

function encodeImageToDataUri(
  data: Uint8Array,
  mediaType: string | undefined,
): string {
  const mime = mediaType ?? "image/png";
  const base64 = btoa(
    Array.from(data, (byte) => String.fromCharCode(byte)).join(""),
  );
  return `data:${mime};base64,${base64}`;
}

function translateContentPartToInput(part: ContentPart): Record<string, unknown> | undefined {
  if (isTextPart(part)) {
    return { type: "input_text", text: part.text };
  }
  if (isImagePart(part)) {
    if (part.image.data) {
      return {
        type: "input_image",
        image_url: encodeImageToDataUri(part.image.data, part.image.mediaType),
      };
    }
    if (part.image.url) {
      return { type: "input_image", image_url: part.image.url };
    }
  }
  return undefined;
}

function translateAssistantContentPart(part: ContentPart): Record<string, unknown> | undefined {
  if (isTextPart(part)) {
    return { type: "output_text", text: part.text };
  }
  return undefined;
}

function translateMessage(message: Message): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];

  if (message.role === Role.USER) {
    const content: Array<Record<string, unknown>> = [];
    for (const part of message.content) {
      const translated = translateContentPartToInput(part);
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
        const output =
          typeof part.toolResult.content === "string"
            ? part.toolResult.content
            : JSON.stringify(part.toolResult.content);
        items.push({
          type: "function_call_output",
          call_id: part.toolResult.toolCallId,
          output,
        });
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
): { body: Record<string, unknown>; headers: Record<string, string> } {
  const body: Record<string, unknown> = {
    model: request.model,
    stream: streaming,
  };

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
      const translated = translateMessage(message);
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
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: {
        ...tool.parameters,
        additionalProperties: false,
      },
      strict: true,
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
    body.max_output_tokens = request.maxTokens;
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

  // Merge providerOptions.openai
  const openaiOptions = request.providerOptions?.["openai"];
  if (openaiOptions) {
    for (const [key, value] of Object.entries(openaiOptions)) {
      body[key] = value;
    }
  }

  return { body, headers: {} };
}
