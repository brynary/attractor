export interface ImageData {
  /** URL or local file path (e.g., "https://example.com/image.png" or "./photo.jpg"). File paths are automatically read and converted to base64. */
  url?: string;
  /** Raw image bytes */
  data?: Uint8Array;
  /** MIME type (e.g., "image/png", "image/jpeg") */
  mediaType?: string;
  /** Detail level for vision models (e.g., "auto", "low", "high") */
  detail?: string;
}

export interface AudioData {
  /** URL or local file path (e.g., "https://example.com/audio.mp3" or "./recording.wav"). File paths are automatically read and converted to base64. */
  url?: string;
  /** Raw audio bytes */
  data?: Uint8Array;
  /** MIME type (e.g., "audio/mpeg", "audio/wav") */
  mediaType?: string;
}

export interface DocumentData {
  /** URL or local file path (e.g., "https://example.com/doc.pdf" or "./report.pdf"). File paths are automatically read and converted to base64. */
  url?: string;
  /** Raw document bytes */
  data?: Uint8Array;
  /** MIME type (e.g., "application/pdf") */
  mediaType?: string;
  /** File name for the document */
  fileName?: string;
}

export interface ToolCallData {
  id: string;
  name: string;
  arguments: Record<string, unknown> | string;
  rawArguments?: string;
  type?: string;
}

export interface ToolResultData {
  toolCallId: string;
  content: string | Record<string, unknown> | unknown[];
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

export interface CustomPart {
  kind: string & {};
  data: unknown;
}

/**
 * Discriminated union of known content part types. Supports switch-based narrowing on `kind`.
 * For extensibility with custom kinds (spec: `kind: ContentKind | String`),
 * use `ExtendedContentPart` which adds `CustomPart` to this union.
 */
export type ContentPart =
  | TextPart
  | ImagePart
  | AudioPart
  | DocumentPart
  | ToolCallPart
  | ToolResultPart
  | ThinkingPart
  | RedactedThinkingPart;

/**
 * ContentPart extended with CustomPart for arbitrary string kinds.
 * Use this type when accepting content that may include provider-specific
 * or user-defined custom kinds beyond the standard ContentKind values.
 */
export type ExtendedContentPart = ContentPart | CustomPart;

export function isTextPart(part: ExtendedContentPart): part is TextPart {
  return part.kind === "text";
}

export function isImagePart(part: ExtendedContentPart): part is ImagePart {
  return part.kind === "image";
}

export function isAudioPart(part: ExtendedContentPart): part is AudioPart {
  return part.kind === "audio";
}

export function isDocumentPart(part: ExtendedContentPart): part is DocumentPart {
  return part.kind === "document";
}

export function isToolCallPart(part: ExtendedContentPart): part is ToolCallPart {
  return part.kind === "tool_call";
}

export function isToolResultPart(part: ExtendedContentPart): part is ToolResultPart {
  return part.kind === "tool_result";
}

export function isThinkingPart(part: ExtendedContentPart): part is ThinkingPart {
  return part.kind === "thinking";
}

export const ContentKind = {
  TEXT: "text",
  IMAGE: "image",
  AUDIO: "audio",
  DOCUMENT: "document",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
  THINKING: "thinking",
  REDACTED_THINKING: "redacted_thinking",
} as const;

export type ContentKind = (typeof ContentKind)[keyof typeof ContentKind];

export function isRedactedThinkingPart(
  part: ExtendedContentPart,
): part is RedactedThinkingPart {
  return part.kind === "redacted_thinking";
}

const KNOWN_KINDS = new Set([
  "text",
  "image",
  "audio",
  "document",
  "tool_call",
  "tool_result",
  "thinking",
  "redacted_thinking",
]);

export function isCustomPart(part: ExtendedContentPart): part is CustomPart {
  return !KNOWN_KINDS.has(part.kind);
}
