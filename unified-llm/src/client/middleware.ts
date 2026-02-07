import type { Request } from "../types/request.js";
import type { Response } from "../types/response.js";
import type { StreamEvent } from "../types/stream-event.js";

export type NextFn = (request: Request) => Promise<Response>;
export type StreamNextFn = (request: Request) => AsyncGenerator<StreamEvent>;

export type Middleware = (request: Request, next: NextFn) => Promise<Response>;
export type StreamMiddleware = (
  request: Request,
  next: StreamNextFn,
) => AsyncGenerator<StreamEvent>;

export function buildMiddlewareChain(
  middlewares: Middleware[],
  handler: NextFn,
): NextFn {
  let chain = handler;
  for (const mw of [...middlewares].reverse()) {
    const next = chain;
    chain = (request) => mw(request, next);
  }
  return chain;
}

export function buildStreamMiddlewareChain(
  middlewares: StreamMiddleware[],
  handler: StreamNextFn,
): StreamNextFn {
  let chain = handler;
  for (const mw of [...middlewares].reverse()) {
    const next = chain;
    chain = (request) => mw(request, next);
  }
  return chain;
}
