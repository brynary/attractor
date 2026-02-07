export interface ImageData {
  url?: string;
  data?: Uint8Array;
  mediaType?: string;
  detail?: string;
}

export interface AudioData {
  url?: string;
  data?: Uint8Array;
  mediaType?: string;
}

export interface DocumentData {
  url?: string;
  data?: Uint8Array;
  mediaType?: string;
  fileName?: string;
}

export interface ToolCallData {
  id: string;
  name: string;
  arguments: Record<string, unknown> | string;
  type?: string;
}

export interface ToolResultData {
  toolCallId: string;
  content: string | Record<string, unknown>;
  isError: boolean;
  imageData?: Uint8Array;
  imageMediaType?: string;
}

export interface ThinkingData {
  text: string;
  signature?: string;
  redacted: boolean;
}

export interface TextPart {
  kind: "text";
  text: string;
}

export interface ImagePart {
  kind: "image";
  image: ImageData;
}

export interface AudioPart {
  kind: "audio";
  audio: AudioData;
}

export interface DocumentPart {
  kind: "document";
  document: DocumentData;
}

export interface ToolCallPart {
  kind: "tool_call";
  toolCall: ToolCallData;
}

export interface ToolResultPart {
  kind: "tool_result";
  toolResult: ToolResultData;
}

export interface ThinkingPart {
  kind: "thinking";
  thinking: ThinkingData;
}

export interface RedactedThinkingPart {
  kind: "redacted_thinking";
  thinking: ThinkingData;
}

export type ContentPart =
  | TextPart
  | ImagePart
  | AudioPart
  | DocumentPart
  | ToolCallPart
  | ToolResultPart
  | ThinkingPart
  | RedactedThinkingPart;

export function isTextPart(part: ContentPart): part is TextPart {
  return part.kind === "text";
}

export function isImagePart(part: ContentPart): part is ImagePart {
  return part.kind === "image";
}

export function isAudioPart(part: ContentPart): part is AudioPart {
  return part.kind === "audio";
}

export function isDocumentPart(part: ContentPart): part is DocumentPart {
  return part.kind === "document";
}

export function isToolCallPart(part: ContentPart): part is ToolCallPart {
  return part.kind === "tool_call";
}

export function isToolResultPart(part: ContentPart): part is ToolResultPart {
  return part.kind === "tool_result";
}

export function isThinkingPart(part: ContentPart): part is ThinkingPart {
  return part.kind === "thinking";
}

export function isRedactedThinkingPart(
  part: ContentPart,
): part is RedactedThinkingPart {
  return part.kind === "redacted_thinking";
}
