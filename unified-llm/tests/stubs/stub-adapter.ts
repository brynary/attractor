import type { ProviderAdapter } from "../../src/types/provider-adapter.js";
import type { Request } from "../../src/types/request.js";
import type { Response } from "../../src/types/response.js";
import type { StreamEvent } from "../../src/types/stream-event.js";

export interface StubResponse {
  response?: Response;
  events?: StreamEvent[];
  error?: Error;
}

export class StubAdapter implements ProviderAdapter {
  readonly name: string;
  private responses: StubResponse[];
  private callIndex = 0;
  readonly calls: Request[] = [];

  constructor(name: string, responses: StubResponse[]) {
    this.name = name;
    this.responses = responses;
  }

  async complete(request: Request): Promise<Response> {
    this.calls.push(request);
    const stub = this.responses[this.callIndex++];
    if (!stub) throw new Error("No more stub responses");
    if (stub.error) throw stub.error;
    if (!stub.response) throw new Error("Stub has no response");
    return stub.response;
  }

  async *stream(request: Request): AsyncGenerator<StreamEvent> {
    this.calls.push(request);
    const stub = this.responses[this.callIndex++];
    if (!stub) throw new Error("No more stub responses");
    if (stub.error) throw stub.error;
    if (!stub.events) throw new Error("Stub has no events");
    for (const event of stub.events) {
      yield event;
    }
  }
}
