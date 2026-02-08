import type { Request } from "../../types/request.js";
import type { ContentPart } from "../../types/content-part.js";
import type { ToolDefinition, ToolChoice } from "../../types/tool.js";
import type { Message } from "../../types/message.js";
import type { Warning } from "../../types/response.js";
import { Role } from "../../types/role.js";
import { encodeToBase64 } from "../../utils/schema-translate.js";

interface TranslatedRequest {
  body: Record<string, unknown>;
  toolCallIdMap: Map<string, string>;
  warnings: Warning[];
}

function translateContentPart(
  part: ContentPart,
  toolCallIdMap: Map<string, string>,
): Record<string, unknown> | undefined {
  switch (part.kind) {
    case "text":
      return { text: part.text };
    case "image": {
      if (part.image.url) {
        return {
          fileData: {
            mimeType: part.image.mediaType ?? "image/png",
            fileUri: part.image.url,
          },
        };
      }
      if (part.image.data) {
        return {
          inlineData: {
            mimeType: part.image.mediaType ?? "image/png",
            data: encodeToBase64(part.image.data),
          },
        };
      }
      return undefined;
    }
    case "tool_call": {
      const args =
        typeof part.toolCall.arguments === "string"
          ? JSON.parse(part.toolCall.arguments)
          : part.toolCall.arguments;
      toolCallIdMap.set(part.toolCall.id, part.toolCall.name);
      const callPart: Record<string, unknown> = {
        functionCall: {
          name: part.toolCall.name,
          args,
        },
      };
      if (part.toolCall.type) {
        callPart.thoughtSignature = part.toolCall.type;
      }
      return callPart;
    }
    case "tool_result": {
      const functionName = toolCallIdMap.get(part.toolResult.toolCallId) ?? "";
      const content = part.toolResult.content;
      const result = part.toolResult.isError
        ? { error: typeof content === "string" ? content : JSON.stringify(content) }
        : typeof content === "string" ? { result: content } : content;
      return {
        functionResponse: {
          name: functionName,
          response: result,
        },
      };
    }
    case "thinking":
      return { thought: true, text: part.thinking.text };
    default:
      return undefined;
  }
}

function translateToolChoice(
  choice: ToolChoice,
): Record<string, unknown> | undefined {
  switch (choice.mode) {
    case "auto":
      return { functionCallingConfig: { mode: "AUTO" } };
    case "none":
      return { functionCallingConfig: { mode: "NONE" } };
    case "required":
      return { functionCallingConfig: { mode: "ANY" } };
    case "named":
      return {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [choice.toolName],
        },
      };
    default:
      return undefined;
  }
}

function translateTools(
  tools: ToolDefinition[],
): Record<string, unknown>[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  ];
}

function mapRole(role: string): string {
  switch (role) {
    case Role.USER:
    case Role.TOOL:
      return "user";
    case Role.ASSISTANT:
      return "model";
    default:
      return role;
  }
}

function buildToolCallIdMap(messages: Message[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part.kind === "tool_call") {
        map.set(part.toolCall.id, part.toolCall.name);
      }
    }
  }
  return map;
}

export function translateRequest(request: Request): TranslatedRequest {
  const toolCallIdMap = buildToolCallIdMap(request.messages);
  const warnings: Warning[] = [];

  const systemParts: Record<string, unknown>[] = [];
  const contents: Record<string, unknown>[] = [];

  for (const message of request.messages) {
    if (message.role === Role.SYSTEM || message.role === Role.DEVELOPER) {
      for (const part of message.content) {
        if (part.kind === "text") {
          systemParts.push({ text: part.text });
        }
      }
      continue;
    }

    const parts: Record<string, unknown>[] = [];
    for (const part of message.content) {
      if (part.kind === "audio") {
        warnings.push({ message: "Audio content parts are not supported by Gemini and were dropped" });
        continue;
      }
      if (part.kind === "document") {
        warnings.push({ message: "Document content parts are not supported by Gemini and were dropped" });
        continue;
      }
      const translated = translateContentPart(part, toolCallIdMap);
      if (translated) {
        parts.push(translated);
      }
      if (part.kind === "tool_result" && part.toolResult.imageData) {
        parts.push({
          inlineData: {
            mimeType: part.toolResult.imageMediaType ?? "image/png",
            data: encodeToBase64(part.toolResult.imageData),
          },
        });
      }
    }

    if (parts.length === 0) {
      continue;
    }

    contents.push({
      role: mapRole(message.role),
      parts,
    });
  }

  const body: Record<string, unknown> = {
    contents,
  };

  if (systemParts.length > 0) {
    body.systemInstruction = { parts: systemParts };
  }

  const generationConfig: Record<string, unknown> = {};

  if (request.temperature !== undefined) {
    generationConfig.temperature = request.temperature;
  }

  if (request.topP !== undefined) {
    generationConfig.topP = request.topP;
  }

  if (request.maxTokens !== undefined) {
    generationConfig.maxOutputTokens = request.maxTokens;
  }

  if (request.stopSequences !== undefined && request.stopSequences.length > 0) {
    generationConfig.stopSequences = request.stopSequences;
  }

  if (request.responseFormat) {
    if (request.responseFormat.type === "json_schema") {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = request.responseFormat.jsonSchema;
    } else if (request.responseFormat.type === "json") {
      generationConfig.responseMimeType = "application/json";
    }
  }

  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  if (request.tools && request.tools.length > 0) {
    body.tools = translateTools(request.tools);

    if (request.toolChoice) {
      const translated = translateToolChoice(request.toolChoice);
      if (translated) {
        body.toolConfig = translated;
      }
    }
  }

  const geminiOptions = request.providerOptions?.["gemini"];

  if (geminiOptions?.["thinkingConfig"] !== undefined) {
    body.thinkingConfig = geminiOptions["thinkingConfig"];
  }

  if (geminiOptions) {
    const knownKeys = new Set(["thinkingConfig"]);
    for (const [key, value] of Object.entries(geminiOptions)) {
      if (!knownKeys.has(key)) {
        body[key] = value;
      }
    }
  }

  return { body, toolCallIdMap, warnings };
}
