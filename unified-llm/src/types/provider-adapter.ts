import type { Request } from "./request.js";
import type { Response } from "./response.js";
import type { StreamEvent } from "./stream-event.js";

export interface ProviderAdapter {
  readonly name: string;
  complete(request: Request): Promise<Response>;
  stream(request: Request): AsyncGenerator<StreamEvent>;
  close?(): Promise<void>;
  initialize?(): Promise<void>;
  supportsToolChoice?(mode: string): boolean;
  supportsNativeJsonSchema?: boolean;
}
