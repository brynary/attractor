import { randomUUID } from "crypto";
import type { Graph } from "../types/graph.js";
import type { Checkpoint } from "../types/checkpoint.js";
import type { PipelineResult, PipelineRunnerConfig } from "../engine/runner.js";
import { PipelineRunner } from "../engine/runner.js";
import { PipelineEventEmitter } from "../events/emitter.js";
import { parse } from "../parser/index.js";
import { createSSEStream } from "./sse.js";
import { WebInterviewer } from "../interviewer/web.js";
import { createAnswer } from "../types/interviewer.js";

export interface PipelineRecord {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  result: PipelineResult | undefined;
  latestCheckpoint: Checkpoint | undefined;
  dotSource: string;
  emitter: PipelineEventEmitter;
  interviewer: WebInterviewer;
  abortController: AbortController;
}

export interface RouteContext {
  pipelines: Map<string, PipelineRecord>;
  runnerConfig: PipelineRunnerConfig;
}

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function getPipelineId(url: URL): string | undefined {
  const match = url.pathname.match(/^\/pipelines\/([^/]+)/);
  return match?.[1];
}

/** POST /pipelines — start a new pipeline run */
async function handlePostPipeline(
  request: Request,
  ctx: RouteContext,
): Promise<Response> {
  let dotContent: string;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("dot" in body)) {
      return errorResponse("Request body must include 'dot' field", 400);
    }
    const dotField = (body as Record<string, unknown>)["dot"];
    if (typeof dotField !== "string") {
      return errorResponse("'dot' field must be a string", 400);
    }
    dotContent = dotField;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  let graph: Graph;
  try {
    graph = parse(dotContent);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(`Failed to parse DOT: ${message}`, 400);
  }

  const id = randomUUID();
  const emitter = new PipelineEventEmitter();
  const interviewer = new WebInterviewer();
  const abortController = new AbortController();

  const record: PipelineRecord = {
    id,
    status: "running",
    result: undefined,
    latestCheckpoint: undefined,
    dotSource: dotContent,
    emitter,
    interviewer,
    abortController,
  };
  ctx.pipelines.set(id, record);

  // Run pipeline in background
  const runner = new PipelineRunner({
    ...ctx.runnerConfig,
    eventEmitter: emitter,
    interviewer,
    onCheckpoint(checkpoint) {
      record.latestCheckpoint = checkpoint;
    },
  });

  runner.run(graph).then(
    (result) => {
      record.result = result;
      record.status = "completed";
      emitter.close();
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      record.status = "failed";
      record.result = undefined;
      emitter.close();
    },
  );

  return jsonResponse({ id, status: "running" }, 201);
}

/** GET /pipelines/:id — get pipeline status */
function handleGetPipeline(
  pipelineId: string,
  ctx: RouteContext,
): Response {
  const record = ctx.pipelines.get(pipelineId);
  if (!record) {
    return errorResponse("Pipeline not found", 404);
  }

  return jsonResponse({
    id: record.id,
    status: record.status,
    result: record.result
      ? {
          status: record.result.outcome.status,
          completedNodes: record.result.completedNodes,
          failureReason: record.result.outcome.failureReason,
        }
      : undefined,
  });
}

/** GET /pipelines/:id/events — SSE event stream */
function handleGetEvents(
  pipelineId: string,
  ctx: RouteContext,
): Response {
  const record = ctx.pipelines.get(pipelineId);
  if (!record) {
    return errorResponse("Pipeline not found", 404);
  }

  const stream = createSSEStream(record.emitter.events());
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/** POST /pipelines/:id/cancel — cancel a running pipeline */
function handleCancelPipeline(
  pipelineId: string,
  ctx: RouteContext,
): Response {
  const record = ctx.pipelines.get(pipelineId);
  if (!record) {
    return errorResponse("Pipeline not found", 404);
  }
  if (record.status !== "running") {
    return errorResponse("Pipeline is not running", 409);
  }

  record.status = "cancelled";
  record.abortController.abort();
  record.emitter.close();

  return jsonResponse({ id: record.id, status: "cancelled" });
}

/** GET /pipelines/:id/questions — get pending question */
function handleGetQuestions(
  pipelineId: string,
  ctx: RouteContext,
): Response {
  const record = ctx.pipelines.get(pipelineId);
  if (!record) {
    return errorResponse("Pipeline not found", 404);
  }

  const pending = record.interviewer.getPendingQuestion();
  if (!pending) {
    return jsonResponse({ question: null });
  }

  return jsonResponse({ id: pending.id, question: pending.question });
}

/** POST /pipelines/:id/questions/:qid/answer — answer pending question */
async function handlePostAnswer(
  pipelineId: string,
  qid: string,
  request: Request,
  ctx: RouteContext,
): Promise<Response> {
  const record = ctx.pipelines.get(pipelineId);
  if (!record) {
    return errorResponse("Pipeline not found", 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (typeof body !== "object" || body === null || !("value" in body)) {
    return errorResponse("Request body must include 'value' field", 400);
  }

  const valueField = (body as Record<string, unknown>)["value"];
  if (typeof valueField !== "string") {
    return errorResponse("'value' field must be a string", 400);
  }

  const textField = (body as Record<string, unknown>)["text"];
  const answer = createAnswer({
    value: valueField,
    text: typeof textField === "string" ? textField : "",
  });

  const submitted = record.interviewer.submitAnswer(answer, qid);
  if (!submitted) {
    return errorResponse("No pending question or question ID mismatch", 409);
  }

  return jsonResponse({ submitted: true });
}

/** GET /pipelines/:id/graph — get rendered graph visualization (SVG) */
async function handleGetGraph(
  pipelineId: string,
  ctx: RouteContext,
): Promise<Response> {
  const record = ctx.pipelines.get(pipelineId);
  if (!record) {
    return errorResponse("Pipeline not found", 404);
  }

  try {
    const proc = Bun.spawn(["dot", "-Tsvg"], {
      stdin: new Blob([record.dotSource]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const svg = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0 && svg.length > 0) {
      return new Response(svg, {
        status: 200,
        headers: { "Content-Type": "image/svg+xml" },
      });
    }
  } catch {
    // Graphviz not available — fall back to DOT source
  }

  return new Response(record.dotSource, {
    status: 200,
    headers: { "Content-Type": "text/vnd.graphviz" },
  });
}

/** GET /pipelines/:id/context — get pipeline context */
function handleGetContext(
  pipelineId: string,
  ctx: RouteContext,
): Response {
  const record = ctx.pipelines.get(pipelineId);
  if (!record) {
    return errorResponse("Pipeline not found", 404);
  }

  if (record.result) {
    return jsonResponse({ context: record.result.context.snapshot() });
  }

  if (record.latestCheckpoint) {
    return jsonResponse({ context: record.latestCheckpoint.contextValues });
  }

  return jsonResponse({ context: {} });
}

/** GET /pipelines/:id/checkpoint — get pipeline checkpoint */
function handleGetCheckpoint(
  pipelineId: string,
  ctx: RouteContext,
): Response {
  const record = ctx.pipelines.get(pipelineId);
  if (!record) {
    return errorResponse("Pipeline not found", 404);
  }

  if (record.result) {
    return jsonResponse({
      checkpoint: {
        completedNodes: record.result.completedNodes,
        status: record.result.outcome.status,
      },
    });
  }

  if (record.latestCheckpoint) {
    return jsonResponse({
      checkpoint: {
        completedNodes: record.latestCheckpoint.completedNodes,
        currentNode: record.latestCheckpoint.currentNode,
        nodeOutcomes: record.latestCheckpoint.nodeOutcomes,
        timestamp: record.latestCheckpoint.timestamp,
      },
    });
  }

  return jsonResponse({ checkpoint: null });
}

/** Main request router */
export async function handleRequest(
  request: Request,
  ctx: RouteContext,
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

  // POST /pipelines
  if (method === "POST" && url.pathname === "/pipelines") {
    return handlePostPipeline(request, ctx);
  }

  const pipelineId = getPipelineId(url);
  if (!pipelineId) {
    return errorResponse("Not found", 404);
  }

  // GET /pipelines/:id
  if (method === "GET" && url.pathname === `/pipelines/${pipelineId}`) {
    return handleGetPipeline(pipelineId, ctx);
  }

  // GET /pipelines/:id/graph
  if (method === "GET" && url.pathname === `/pipelines/${pipelineId}/graph`) {
    return await handleGetGraph(pipelineId, ctx);
  }

  // GET /pipelines/:id/events
  if (method === "GET" && url.pathname === `/pipelines/${pipelineId}/events`) {
    return handleGetEvents(pipelineId, ctx);
  }

  // POST /pipelines/:id/cancel
  if (method === "POST" && url.pathname === `/pipelines/${pipelineId}/cancel`) {
    return handleCancelPipeline(pipelineId, ctx);
  }

  // GET /pipelines/:id/questions
  if (method === "GET" && url.pathname === `/pipelines/${pipelineId}/questions`) {
    return handleGetQuestions(pipelineId, ctx);
  }

  // POST /pipelines/:id/questions/:qid/answer
  const answerMatch = url.pathname.match(
    new RegExp(`^/pipelines/${pipelineId}/questions/([^/]+)/answer$`),
  );
  if (method === "POST" && answerMatch) {
    const qid = answerMatch[1];
    if (qid === undefined) {
      return errorResponse("Missing question ID", 400);
    }
    return handlePostAnswer(pipelineId, qid, request, ctx);
  }

  // GET /pipelines/:id/context
  if (method === "GET" && url.pathname === `/pipelines/${pipelineId}/context`) {
    return handleGetContext(pipelineId, ctx);
  }

  // GET /pipelines/:id/checkpoint
  if (method === "GET" && url.pathname === `/pipelines/${pipelineId}/checkpoint`) {
    return handleGetCheckpoint(pipelineId, ctx);
  }

  return errorResponse("Not found", 404);
}
