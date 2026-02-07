import type { Graph, Node, Edge } from "../types/graph.js";
import type { Outcome } from "../types/outcome.js";
import type { Checkpoint } from "../types/checkpoint.js";
import type { Handler } from "../types/handler.js";
import type { Interviewer } from "../types/interviewer.js";
import type { CodergenBackend } from "../types/handler.js";
import type { PipelineEvent, PipelineEventKind } from "../types/events.js";
import type { Transform } from "../types/transform.js";
import type { LintRule } from "../types/diagnostic.js";
import { Context } from "../types/context.js";
import { StageStatus, createOutcome } from "../types/outcome.js";
import { PipelineEventKind as EventKind } from "../types/events.js";
import { getStringAttr, getBooleanAttr } from "../types/graph.js";
import { selectEdge } from "./edge-selection.js";
import { buildRetryPolicy, executeWithRetry } from "./retry.js";
import { checkGoalGates, getRetryTarget } from "./goal-gates.js";
import { saveCheckpoint } from "./checkpoint.js";
import { join } from "path";
import { randomUUID } from "crypto";

/** Shape-to-handler-type mapping from spec 2.8 */
const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: "start",
  Msquare: "exit",
  box: "codergen",
  hexagon: "wait.human",
  diamond: "conditional",
  component: "parallel",
  tripleoctagon: "parallel.fan_in",
  parallelogram: "tool",
  house: "stack.manager_loop",
};

export interface HandlerRegistry {
  handlers: Map<string, Handler>;
  defaultHandler: Handler | undefined;

  register(typeString: string, handler: Handler): void;
  resolve(node: Node): Handler | undefined;
}

export function createHandlerRegistry(): HandlerRegistry {
  const handlers = new Map<string, Handler>();
  let defaultHandler: Handler | undefined;

  return {
    handlers,
    get defaultHandler() {
      return defaultHandler;
    },
    set defaultHandler(h: Handler | undefined) {
      defaultHandler = h;
    },
    register(typeString: string, handler: Handler): void {
      handlers.set(typeString, handler);
    },
    resolve(node: Node): Handler | undefined {
      // 1. Explicit type attribute
      const explicitType = getStringAttr(node.attributes, "type");
      if (explicitType !== "") {
        const h = handlers.get(explicitType);
        if (h) return h;
      }

      // 2. Shape-based resolution
      const shape = getStringAttr(node.attributes, "shape", "box");
      const handlerType = SHAPE_TO_TYPE[shape];
      if (handlerType) {
        const h = handlers.get(handlerType);
        if (h) return h;
      }

      // 3. Default
      return defaultHandler;
    },
  };
}

export interface EventEmitter {
  emit(event: PipelineEvent): void;
}

export interface PipelineRunnerConfig {
  handlerRegistry: HandlerRegistry;
  interviewer?: Interviewer;
  backend?: CodergenBackend;
  transforms?: Transform[];
  extraLintRules?: LintRule[];
  eventEmitter?: EventEmitter;
  logsRoot?: string;
}

export interface PipelineResult {
  outcome: Outcome;
  completedNodes: string[];
  context: Context;
}

function isTerminal(node: Node): boolean {
  const shape = getStringAttr(node.attributes, "shape");
  const nodeType = getStringAttr(node.attributes, "type");
  return shape === "Msquare" || nodeType === "exit";
}

function findStartNode(graph: Graph): Node {
  // 1. shape=Mdiamond
  for (const node of graph.nodes.values()) {
    if (getStringAttr(node.attributes, "shape") === "Mdiamond") {
      return node;
    }
  }
  // 2. id="start" or "Start"
  const byId = graph.nodes.get("start") ?? graph.nodes.get("Start");
  if (byId) return byId;

  throw new Error("No start node found: need shape=Mdiamond or id=start");
}

function mirrorGraphAttributes(graph: Graph, context: Context): void {
  const goal = getStringAttr(graph.attributes, "goal");
  if (goal !== "") {
    context.set("graph.goal", goal);
  }
  const label = getStringAttr(graph.attributes, "label");
  if (label !== "") {
    context.set("graph.label", label);
  }
}

export class PipelineRunner {
  private config: PipelineRunnerConfig;
  private pipelineId: string;

  constructor(config: PipelineRunnerConfig) {
    this.config = config;
    this.pipelineId = randomUUID();
  }

  async run(input: Graph): Promise<PipelineResult> {
    let graph = input;

    // Apply transforms
    if (this.config.transforms) {
      for (const transform of this.config.transforms) {
        graph = transform.apply(graph);
      }
    }

    // Initialize context
    const context = new Context();
    mirrorGraphAttributes(graph, context);

    const completedNodes: string[] = [];
    const nodeOutcomes = new Map<string, Outcome>();
    const logsRoot = this.config.logsRoot ?? "/tmp/attractor-logs";

    this.emitEvent(EventKind.PIPELINE_STARTED, { graphName: graph.name });

    let currentNode = findStartNode(graph);
    let lastOutcome = createOutcome({ status: StageStatus.SUCCESS });

    while (true) {
      // Step 1: Check for terminal node
      if (isTerminal(currentNode)) {
        const gateResult = checkGoalGates(graph, nodeOutcomes);
        if (!gateResult.satisfied && gateResult.failedGate) {
          const retryTarget = getRetryTarget(gateResult.failedGate, graph);
          if (retryTarget) {
            const targetNode = graph.nodes.get(retryTarget);
            if (targetNode) {
              currentNode = targetNode;
              continue;
            }
          }
          this.emitEvent(EventKind.PIPELINE_FAILED, {
            reason: `Goal gate unsatisfied: ${gateResult.failedGate.id}`,
          });
          return {
            outcome: createOutcome({
              status: StageStatus.FAIL,
              failureReason: `Goal gate unsatisfied: ${gateResult.failedGate.id} and no retry target`,
            }),
            completedNodes,
            context,
          };
        }
        break;
      }

      // Step 2: Execute node handler with retry policy
      context.set("current_node", currentNode.id);
      this.emitEvent(EventKind.STAGE_STARTED, { nodeId: currentNode.id });

      const handler = this.config.handlerRegistry.resolve(currentNode);
      if (!handler) {
        const failOutcome = createOutcome({
          status: StageStatus.FAIL,
          failureReason: `No handler found for node: ${currentNode.id}`,
        });
        this.emitEvent(EventKind.STAGE_FAILED, {
          nodeId: currentNode.id,
          reason: failOutcome.failureReason,
        });
        return { outcome: failOutcome, completedNodes, context };
      }

      const retryPolicy = buildRetryPolicy(currentNode, graph);
      const outcome = await executeWithRetry(
        currentNode,
        context,
        graph,
        logsRoot,
        handler,
        retryPolicy,
      );

      // Step 3: Record completion
      completedNodes.push(currentNode.id);
      nodeOutcomes.set(currentNode.id, outcome);
      lastOutcome = outcome;

      this.emitEvent(EventKind.STAGE_COMPLETED, {
        nodeId: currentNode.id,
        status: outcome.status,
      });

      // Step 4: Apply context updates
      context.applyUpdates(outcome.contextUpdates);
      context.set("outcome", outcome.status);
      if (outcome.preferredLabel !== "") {
        context.set("preferred_label", outcome.preferredLabel);
      }

      // Step 5: Save checkpoint
      const checkpoint: Checkpoint = {
        timestamp: new Date().toISOString(),
        currentNode: currentNode.id,
        completedNodes: [...completedNodes],
        nodeRetries: {},
        contextValues: context.snapshot(),
        logs: [...context.logs()],
      };
      try {
        await saveCheckpoint(checkpoint, join(logsRoot, "checkpoint.json"));
        this.emitEvent(EventKind.CHECKPOINT_SAVED, {
          nodeId: currentNode.id,
        });
      } catch {
        // Checkpoint save failure is non-fatal
      }

      // Step 6: Select next edge
      const nextEdge = selectEdge(currentNode, outcome, context, graph);
      if (!nextEdge) {
        if (outcome.status === StageStatus.FAIL) {
          this.emitEvent(EventKind.PIPELINE_FAILED, {
            reason: "Stage failed with no outgoing fail edge",
            nodeId: currentNode.id,
          });
          return {
            outcome: createOutcome({
              status: StageStatus.FAIL,
              failureReason: `Stage ${currentNode.id} failed with no outgoing fail edge`,
            }),
            completedNodes,
            context,
          };
        }
        break;
      }

      // Step 7: Handle loop_restart
      if (getBooleanAttr(nextEdge.attributes, "loop_restart", false)) {
        // For now, just advance to the target node (full restart requires re-entry)
        break;
      }

      // Step 8: Advance to next node
      const nextNode = graph.nodes.get(nextEdge.to);
      if (!nextNode) {
        return {
          outcome: createOutcome({
            status: StageStatus.FAIL,
            failureReason: `Edge target node not found: ${nextEdge.to}`,
          }),
          completedNodes,
          context,
        };
      }
      currentNode = nextNode;
    }

    this.emitEvent(EventKind.PIPELINE_COMPLETED, {
      completedNodes,
      status: lastOutcome.status,
    });

    return { outcome: lastOutcome, completedNodes, context };
  }

  private emitEvent(
    kind: PipelineEventKind,
    data: Record<string, unknown>,
  ): void {
    if (this.config.eventEmitter) {
      this.config.eventEmitter.emit({
        kind,
        timestamp: new Date(),
        pipelineId: this.pipelineId,
        data,
      });
    }
  }
}
