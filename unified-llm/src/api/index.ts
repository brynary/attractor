// High-level API (Layer 4)
export { generate } from "./generate.js";
export type { GenerateOptions } from "./generate.js";
export { stream } from "./stream.js";
export type { StreamOptions } from "./stream.js";
export { generateObject, generateObjectWithJsonSchema } from "./generate-object.js";
export type { GenerateObjectOptions } from "./generate-object.js";
export { streamObject, streamObjectWithJsonSchema } from "./stream-object.js";
export type { StreamObjectOptions, StreamObjectResult } from "./stream-object.js";
export type {
  StepResult,
  GenerateResult,
  StopCondition,
  StreamResult,
} from "./types.js";

// Core Client (Layer 3)
export { Client } from "../client/client.js";
export type { ClientOptions } from "../client/client.js";
export { getDefaultClient, setDefaultClient } from "../client/default-client.js";
export type {
  Middleware,
  NextFn,
  StreamNextFn,
} from "../client/middleware.js";

// Provider Adapters
export { AnthropicAdapter } from "../providers/anthropic/index.js";
export type { AnthropicAdapterOptions } from "../providers/anthropic/index.js";
export { OpenAIAdapter } from "../providers/openai/index.js";
export type { OpenAIAdapterOptions } from "../providers/openai/index.js";
export { OpenAICompatibleAdapter } from "../providers/openai-compatible/index.js";
export type { OpenAICompatibleAdapterOptions } from "../providers/openai-compatible/index.js";
export { GeminiAdapter } from "../providers/gemini/index.js";
export type { GeminiAdapterOptions } from "../providers/gemini/index.js";

// Model Catalog
export { getModelInfo, listModels, getLatestModel } from "../models/catalog.js";

// Core Types (Layer 1)
export { Role } from "../types/role.js";
export type {
  ImageData,
  AudioData,
  DocumentData,
  ToolCallData,
  ToolResultData,
  ThinkingData,
  TextPart,
  ImagePart,
  AudioPart,
  DocumentPart,
  ToolCallPart,
  ToolResultPart,
  ThinkingPart,
  RedactedThinkingPart,
  CustomPart,
  ContentPart,
  ExtendedContentPart,
} from "../types/content-part.js";
export { ContentKind } from "../types/content-part.js";
export {
  isTextPart,
  isImagePart,
  isAudioPart,
  isDocumentPart,
  isToolCallPart,
  isToolResultPart,
  isThinkingPart,
  isRedactedThinkingPart,
  isCustomPart,
} from "../types/content-part.js";
export type { Message } from "../types/message.js";
export {
  systemMessage,
  userMessage,
  assistantMessage,
  toolResultMessage,
  messageText,
} from "../types/message.js";
export type { Request } from "../types/request.js";
export type {
  FinishReason,
  Usage,
  Warning,
  RateLimitInfo,
  Response,
} from "../types/response.js";
export {
  addUsage,
  responseText,
  responseToolCalls,
  responseReasoning,
} from "../types/response.js";
export { StreamEventType } from "../types/stream-event.js";
export type {
  StreamStartEvent,
  TextStartEvent,
  TextDeltaEvent,
  TextEndEvent,
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  ToolCallStartEvent,
  ToolCallDeltaEvent,
  ToolCallEndEvent,
  StepFinishEvent,
  FinishEvent,
  ErrorEvent,
  ProviderEvent,
  StreamEvent,
} from "../types/stream-event.js";
export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolChoice,
} from "../types/tool.js";
export type { ResponseFormat } from "../types/response-format.js";
export type { ProviderAdapter } from "../types/provider-adapter.js";
export type { ModelInfo } from "../types/model-info.js";
export type { TimeoutConfig, AdapterTimeout } from "../types/timeout.js";
export {
  SDKError,
  ProviderError,
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  ContentFilterError,
  ContextLengthError,
  QuotaExceededError,
  RequestTimeoutError,
  AbortError,
  NetworkError,
  StreamError,
  InvalidToolCallError,
  NoObjectGeneratedError,
  ConfigurationError,
  UnsupportedToolChoiceError,
} from "../types/errors.js";

// Utilities (Layer 2)
export { retry, defaultRetryPolicy } from "../utils/retry.js";
export type { RetryPolicy } from "../utils/retry.js";
export { readImageFile, isLocalFilePath } from "../utils/file-image.js";
export type { FileImageResult } from "../utils/file-image.js";
export { resolveFileImages } from "../utils/resolve-file-images.js";
export { validateJsonSchema } from "../utils/validate-json-schema.js";
