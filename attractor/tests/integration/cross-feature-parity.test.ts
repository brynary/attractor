import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import {
  parse,
  validate,
  validateOrRaise,
  ValidationError,
  StageStatus,
  createOutcome,
  Context,
  PipelineRunner,
  createHandlerRegistry,
  StartHandler,
  ExitHandler,
  CodergenHandler,
  ConditionalHandler,
  WaitForHumanHandler,
  ParallelHandler,
  FanInHandler,
  HandlerRegistry,
  StubBackend,
  QueueInterviewer,
  AutoApproveInterviewer,
  VariableExpansionTransform,
  StylesheetTransform,
  saveCheckpoint,
  loadCheckpoint,
  selectEdge,
  evaluateCondition,
  parseStylesheet,
  applyStylesheet,
  getStringAttr,
  stringAttr,
  integerAttr,
  booleanAttr,
  type Graph,
  type Node,
  type Edge,
  type Outcome,
  type Handler,
  type PipelineRunnerConfig,
  createAnswer,
  AnswerValue,
} from "../../src/index.js";

function makeLogsRoot(): string {
  const dir = join(tmpdir(), "attractor-test-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function buildRunner(
  graph: Graph,
  options?: {
    backend?: StubBackend;
    interviewer?: QueueInterviewer | AutoApproveInterviewer;
    transforms?: Array<VariableExpansionTransform | StylesheetTransform>;
    logsRoot?: string;
  },
): { runner: PipelineRunner; logsRoot: string } {
  const logsRoot = options?.logsRoot ?? makeLogsRoot();
  const backend = options?.backend ?? new StubBackend();

  // Build handler registry using the engine's createHandlerRegistry
  const registry = createHandlerRegistry();
  registry.register("start", new StartHandler());
  registry.register("exit", new ExitHandler());
  registry.register("codergen", new CodergenHandler(backend));
  registry.register("conditional", new ConditionalHandler());

  if (options?.interviewer) {
    registry.register("wait.human", new WaitForHumanHandler(options.interviewer));
  } else {
    registry.register("wait.human", new WaitForHumanHandler(new AutoApproveInterviewer()));
  }

  // Parallel handler needs a node executor
  const executeNode = async (
    nodeId: string,
    context: Context,
    g: Graph,
    lr: string,
  ): Promise<Outcome> => {
    const node = g.nodes.get(nodeId);
    if (!node) return createOutcome({ status: StageStatus.FAIL, failureReason: "node not found" });
    const handler = registry.resolve(node);
    if (!handler) return createOutcome({ status: StageStatus.FAIL, failureReason: "no handler" });
    return handler.execute(node, context, g, lr);
  };
  registry.register("parallel", new ParallelHandler(executeNode));
  registry.register("parallel.fan_in", new FanInHandler());

  registry.defaultHandler = new CodergenHandler(backend);

  const config: PipelineRunnerConfig = {
    handlerRegistry: registry,
    backend,
    transforms: options?.transforms,
    logsRoot,
  };

  return { runner: new PipelineRunner(config), logsRoot };
}

// === PARSING TESTS ===

describe("Parse: simple linear pipeline", () => {
  test("parses start -> A -> B -> done", () => {
    const graph = parse(`
      digraph Simple {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        a [label="A"]
        b [label="B"]
        start -> a -> b -> exit
      }
    `);
    expect(graph.nodes.size).toBe(4);
    expect(graph.edges.length).toBe(3);
    expect(graph.nodes.has("start")).toBe(true);
    expect(graph.nodes.has("exit")).toBe(true);
    expect(graph.nodes.has("a")).toBe(true);
    expect(graph.nodes.has("b")).toBe(true);
  });
});

describe("Parse: pipeline with graph-level attributes", () => {
  test("extracts goal and label", () => {
    const graph = parse(`
      digraph Pipeline {
        graph [goal="Run tests and report", label="Test Pipeline"]
        start [shape=Mdiamond]
        exit [shape=Msquare]
        start -> exit
      }
    `);
    expect(getStringAttr(graph.attributes, "goal")).toBe("Run tests and report");
    expect(getStringAttr(graph.attributes, "label")).toBe("Test Pipeline");
  });
});

describe("Parse: multi-line node attributes", () => {
  test("handles attributes spanning multiple lines", () => {
    const graph = parse(`
      digraph Pipeline {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        plan [
          shape=box,
          label="Plan",
          prompt="Plan the implementation"
        ]
        start -> plan -> exit
      }
    `);
    const plan = graph.nodes.get("plan");
    expect(plan).toBeDefined();
    expect(getStringAttr(plan!.attributes, "prompt")).toBe("Plan the implementation");
    expect(getStringAttr(plan!.attributes, "label")).toBe("Plan");
  });
});

// === VALIDATION TESTS ===

describe("Validate: missing start node -> error", () => {
  test("reports error when no start node", () => {
    const graph = parse(`
      digraph Bad {
        exit [shape=Msquare]
        a [label="A"]
        a -> exit
      }
    `);
    const diagnostics = validate(graph);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((d) => d.rule === "start_node")).toBe(true);
  });
});

describe("Validate: missing exit node -> error", () => {
  test("reports error when no exit node", () => {
    const graph = parse(`
      digraph Bad {
        start [shape=Mdiamond]
        a [label="A"]
        start -> a
      }
    `);
    const diagnostics = validate(graph);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((d) => d.rule === "terminal_node")).toBe(true);
  });
});

describe("Validate: orphan node -> reachability error", () => {
  test("reports unreachable node", () => {
    const graph = parse(`
      digraph Bad {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        orphan [label="Orphan"]
        start -> exit
      }
    `);
    const diagnostics = validate(graph);
    const reachability = diagnostics.filter((d) => d.rule === "reachability");
    expect(reachability.length).toBeGreaterThan(0);
  });
});

// === EXECUTION TESTS ===

describe("Execute: linear 3-node pipeline end-to-end", () => {
  test("completes successfully with stub backend", async () => {
    const graph = parse(`
      digraph Linear {
        graph [goal="Test linear"]
        start [shape=Mdiamond]
        exit [shape=Msquare]
        task1 [shape=box, prompt="Do task 1"]
        task2 [shape=box, prompt="Do task 2"]
        task3 [shape=box, prompt="Do task 3"]
        start -> task1 -> task2 -> task3 -> exit
      }
    `);

    const { runner, logsRoot } = buildRunner(graph);
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toContain("start");
    expect(result.completedNodes).toContain("task1");
    expect(result.completedNodes).toContain("task2");
    expect(result.completedNodes).toContain("task3");

    // Verify artifacts exist
    expect(existsSync(join(logsRoot, "task1", "prompt.md"))).toBe(true);
    expect(existsSync(join(logsRoot, "task1", "response.md"))).toBe(true);
    expect(existsSync(join(logsRoot, "task1", "status.json"))).toBe(true);
  });
});

describe("Execute: conditional branching (success/fail paths)", () => {
  test("follows success path on success outcome", async () => {
    const graph = parse(`
      digraph Branch {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        task [shape=box, prompt="Do task"]
        gate [shape=diamond, label="Check result"]
        success_path [shape=box, prompt="Success path"]
        fail_path [shape=box, prompt="Fail path"]
        start -> task -> gate
        gate -> success_path [condition="outcome=success"]
        gate -> fail_path [condition="outcome=fail"]
        success_path -> exit
        fail_path -> exit
      }
    `);

    const { runner } = buildRunner(graph);
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toContain("success_path");
    expect(result.completedNodes).not.toContain("fail_path");
  });
});

describe("Execute: retry on failure (max_retries=2)", () => {
  test("retries and eventually succeeds", async () => {
    const graph = parse(`
      digraph Retry {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        flaky [shape=box, prompt="Flaky task", max_retries=2]
        start -> flaky -> exit
      }
    `);

    let callCount = 0;
    const backend = new StubBackend({
      responseFn: () => {
        callCount++;
        if (callCount < 3) {
          return createOutcome({ status: StageStatus.RETRY, failureReason: "not yet" });
        }
        return "success response";
      },
    });

    const { runner } = buildRunner(graph, { backend });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(callCount).toBe(3);
  });
});

describe("Goal gate: blocks exit when unsatisfied", () => {
  test("pipeline fails when goal gate unsatisfied and no retry target", async () => {
    // When a goal gate node fails and there's no retry target, the pipeline should fail
    const graph = parse(`
      digraph GoalGate {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        task [shape=box, prompt="Main task", goal_gate=true]
        start -> task -> exit
      }
    `);

    const backend = new StubBackend({
      responseFn: (node) => {
        if (node.id === "task") {
          return createOutcome({ status: StageStatus.FAIL, failureReason: "task failed" });
        }
        return "done";
      },
    });

    const { runner } = buildRunner(graph, { backend });
    const result = await runner.run(graph);

    // Task failed -> reaches exit -> goal gate unsatisfied -> no retry target -> pipeline fails
    expect(result.outcome.status).toBe(StageStatus.FAIL);
    expect(result.outcome.failureReason).toContain("Goal gate unsatisfied");
  });
});

describe("Goal gate: allows exit when all satisfied", () => {
  test("exits normally when goal gate succeeds", async () => {
    const graph = parse(`
      digraph GoalGate {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        task [shape=box, prompt="Main task", goal_gate=true]
        start -> task -> exit
      }
    `);

    const { runner } = buildRunner(graph);
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toContain("task");
  });
});

describe("Wait.human: presents choices and routes on selection", () => {
  test("routes based on human selection via QueueInterviewer", async () => {
    const graph = parse(`
      digraph HumanGate {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        gate [shape=hexagon, label="Review Changes"]
        approve [shape=box, prompt="Ship it"]
        fix [shape=box, prompt="Fix issues"]
        start -> gate
        gate -> approve [label="[A] Approve"]
        gate -> fix [label="[F] Fix"]
        approve -> exit
        fix -> gate
      }
    `);

    // Queue interviewer will select the first option (Approve)
    const interviewer = new QueueInterviewer([
      createAnswer({ value: "A" }),
    ]);

    const { runner } = buildRunner(graph, { interviewer });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toContain("gate");
    expect(result.completedNodes).toContain("approve");
    expect(result.completedNodes).not.toContain("fix");
  });
});

// === EDGE SELECTION TESTS ===

describe("Edge selection: condition match wins over weight", () => {
  test("condition-matching edge selected even with lower weight", () => {
    const graph = parse(`
      digraph Test {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        node_a [shape=box]
        target_cond [shape=box]
        target_weight [shape=box]
        start -> node_a
        node_a -> target_cond [condition="outcome=success", weight=1]
        node_a -> target_weight [weight=10]
        target_cond -> exit
        target_weight -> exit
      }
    `);

    const nodeA = graph.nodes.get("node_a");
    expect(nodeA).toBeDefined();
    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const context = new Context();

    const edge = selectEdge(nodeA!, outcome, context, graph);
    expect(edge).toBeDefined();
    expect(edge!.to).toBe("target_cond");
  });
});

describe("Edge selection: weight breaks ties for unconditional edges", () => {
  test("higher weight edge wins", () => {
    const graph = parse(`
      digraph Test {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        node_a [shape=box]
        low [shape=box]
        high [shape=box]
        start -> node_a
        node_a -> low [weight=1]
        node_a -> high [weight=5]
        low -> exit
        high -> exit
      }
    `);

    const nodeA = graph.nodes.get("node_a");
    expect(nodeA).toBeDefined();
    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const context = new Context();

    const edge = selectEdge(nodeA!, outcome, context, graph);
    expect(edge).toBeDefined();
    expect(edge!.to).toBe("high");
  });
});

describe("Edge selection: lexical tiebreak as final fallback", () => {
  test("alphabetically first target wins when weights are equal", () => {
    const graph = parse(`
      digraph Test {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        node_a [shape=box]
        beta [shape=box]
        alpha [shape=box]
        start -> node_a
        node_a -> beta
        node_a -> alpha
        alpha -> exit
        beta -> exit
      }
    `);

    const nodeA = graph.nodes.get("node_a");
    expect(nodeA).toBeDefined();
    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const context = new Context();

    const edge = selectEdge(nodeA!, outcome, context, graph);
    expect(edge).toBeDefined();
    expect(edge!.to).toBe("alpha");
  });
});

// === CONTEXT TESTS ===

describe("Context updates: visible across nodes", () => {
  test("context updates from one node are available to the next", async () => {
    const graph = parse(`
      digraph Context {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        setter [shape=box, prompt="Set value"]
        reader [shape=box, prompt="Read value"]
        start -> setter -> reader -> exit
      }
    `);

    let readerContextValue = "";
    const backend = new StubBackend({
      responseFn: (node, _prompt, context) => {
        if (node.id === "setter") {
          return createOutcome({
            status: StageStatus.SUCCESS,
            contextUpdates: { "my.value": "hello-world" },
          });
        }
        if (node.id === "reader") {
          readerContextValue = context.get("my.value");
        }
        return "done";
      },
    });

    const { runner } = buildRunner(graph, { backend });
    await runner.run(graph);

    expect(readerContextValue).toBe("hello-world");
  });
});

// === CHECKPOINT TESTS ===

describe("Checkpoint: save and resume produces same result", () => {
  test("checkpoint round-trip preserves state", async () => {
    const logsRoot = makeLogsRoot();
    const checkpointPath = join(logsRoot, "checkpoint.json");

    const graph = parse(`
      digraph Checkpoint {
        graph [goal="Test checkpoint"]
        start [shape=Mdiamond]
        exit [shape=Msquare]
        task1 [shape=box, prompt="Task 1"]
        task2 [shape=box, prompt="Task 2"]
        start -> task1 -> task2 -> exit
      }
    `);

    const { runner } = buildRunner(graph, { logsRoot });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);

    // Verify checkpoint was saved
    expect(existsSync(checkpointPath)).toBe(true);

    // Load checkpoint and verify content
    const checkpoint = await loadCheckpoint(checkpointPath);
    expect(checkpoint.completedNodes).toContain("task1");
    expect(checkpoint.completedNodes).toContain("task2");
    expect(checkpoint.contextValues["graph.goal"]).toBe("Test checkpoint");
  });
});

// === STYLESHEET TESTS ===

describe("Stylesheet: applies model override to nodes", () => {
  test("stylesheet sets llm_model on nodes by class", () => {
    const graph = parse(`
      digraph Style {
        graph [
          model_stylesheet="* { llm_model: claude-sonnet; } .fast { llm_model: gemini-flash; }"
        ]
        start [shape=Mdiamond]
        exit [shape=Msquare]
        normal [shape=box, prompt="Normal"]
        fast_task [shape=box, prompt="Fast", class="fast"]
        start -> normal -> fast_task -> exit
      }
    `);

    const transform = new StylesheetTransform();
    const transformed = transform.apply(graph);

    const normal = transformed.nodes.get("normal");
    const fast = transformed.nodes.get("fast_task");
    expect(normal).toBeDefined();
    expect(fast).toBeDefined();
    expect(getStringAttr(normal!.attributes, "llm_model")).toBe("claude-sonnet");
    expect(getStringAttr(fast!.attributes, "llm_model")).toBe("gemini-flash");
  });
});

// === VARIABLE EXPANSION TESTS ===

describe("Prompt variable expansion: $goal works", () => {
  test("$goal is replaced in node prompts", () => {
    const graph = parse(`
      digraph Expand {
        graph [goal="Build a widget"]
        start [shape=Mdiamond]
        exit [shape=Msquare]
        task [shape=box, prompt="Implement: $goal"]
        start -> task -> exit
      }
    `);

    const transform = new VariableExpansionTransform();
    const expanded = transform.apply(graph);

    const task = expanded.nodes.get("task");
    expect(task).toBeDefined();
    expect(getStringAttr(task!.attributes, "prompt")).toBe("Implement: Build a widget");
  });
});

// === PARALLEL TESTS ===

describe("Parallel: fan-out and fan-in complete correctly", () => {
  test("parallel handler executes branches and fan-in selects best", async () => {
    const graph = parse(`
      digraph Parallel {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        fan_out [shape=component, label="Fan Out"]
        branch_a [shape=box, prompt="Branch A"]
        branch_b [shape=box, prompt="Branch B"]
        fan_in [shape=tripleoctagon, label="Fan In"]
        fan_out -> branch_a
        fan_out -> branch_b
        start -> fan_out
        branch_a -> fan_in
        branch_b -> fan_in
        fan_in -> exit
      }
    `);

    const { runner } = buildRunner(graph);
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toContain("fan_out");
    expect(result.completedNodes).toContain("fan_in");
  });
});

// === CUSTOM HANDLER TESTS ===

describe("Custom handler: registration and execution works", () => {
  test("custom handler is resolved and executed", async () => {
    const graph = parse(`
      digraph Custom {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        custom [type="my_custom", label="Custom Node"]
        start -> custom -> exit
      }
    `);

    const logsRoot = makeLogsRoot();
    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());

    let customExecuted = false;
    const customHandler: Handler = {
      execute: async () => {
        customExecuted = true;
        return createOutcome({
          status: StageStatus.SUCCESS,
          notes: "Custom handler ran",
        });
      },
    };
    registry.register("my_custom", customHandler);
    registry.defaultHandler = new CodergenHandler();

    const runner = new PipelineRunner({
      handlerRegistry: registry,
      logsRoot,
    });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(customExecuted).toBe(true);
    expect(result.completedNodes).toContain("custom");
  });
});

// === LARGE PIPELINE TEST ===

describe("Pipeline: 10+ nodes completes without errors", () => {
  test("large pipeline runs to completion", async () => {
    const graph = parse(`
      digraph Large {
        graph [goal="Large pipeline test"]
        start [shape=Mdiamond]
        exit [shape=Msquare]
        n1 [shape=box, prompt="Step 1"]
        n2 [shape=box, prompt="Step 2"]
        n3 [shape=box, prompt="Step 3"]
        n4 [shape=box, prompt="Step 4"]
        n5 [shape=box, prompt="Step 5"]
        n6 [shape=box, prompt="Step 6"]
        n7 [shape=box, prompt="Step 7"]
        n8 [shape=box, prompt="Step 8"]
        n9 [shape=box, prompt="Step 9"]
        n10 [shape=box, prompt="Step 10"]
        start -> n1 -> n2 -> n3 -> n4 -> n5 -> n6 -> n7 -> n8 -> n9 -> n10 -> exit
      }
    `);

    const { runner } = buildRunner(graph);
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes.length).toBeGreaterThanOrEqual(11); // start + 10 nodes
  });
});

// === SPEC SECTION 2.13 EXAMPLES ===

describe("Parse spec examples from section 2.13", () => {
  test("simple linear workflow", () => {
    const graph = parse(`
      digraph Simple {
        graph [goal="Run tests and report"]
        rankdir=LR

        start [shape=Mdiamond, label="Start"]
        exit  [shape=Msquare, label="Exit"]

        run_tests [label="Run Tests", prompt="Run the test suite and report results"]
        report    [label="Report", prompt="Summarize the test results"]

        start -> run_tests -> report -> exit
      }
    `);

    expect(graph.name).toBe("Simple");
    expect(getStringAttr(graph.attributes, "goal")).toBe("Run tests and report");
    expect(graph.nodes.size).toBe(4);
    expect(graph.edges.length).toBe(3);
  });

  test("branching workflow with conditions", () => {
    const graph = parse(`
      digraph Branch {
        graph [goal="Implement and validate a feature"]
        rankdir=LR
        node [shape=box, timeout="900s"]

        start     [shape=Mdiamond, label="Start"]
        exit      [shape=Msquare, label="Exit"]
        plan      [label="Plan", prompt="Plan the implementation"]
        implement [label="Implement", prompt="Implement the plan"]
        validate  [label="Validate", prompt="Run tests"]
        gate      [shape=diamond, label="Tests passing?"]

        start -> plan -> implement -> validate -> gate
        gate -> exit      [label="Yes", condition="outcome=success"]
        gate -> implement [label="No", condition="outcome!=success"]
      }
    `);

    expect(graph.nodes.size).toBe(6);
    // Should have 6 edges: start->plan, plan->impl, impl->validate, validate->gate, gate->exit, gate->impl
    expect(graph.edges.length).toBe(6);

    const gateToExit = graph.edges.find((e) => e.from === "gate" && e.to === "exit");
    expect(gateToExit).toBeDefined();
    expect(getStringAttr(gateToExit!.attributes, "condition")).toBe("outcome=success");
  });

  test("human gate", () => {
    const graph = parse(`
      digraph Review {
        rankdir=LR

        start [shape=Mdiamond, label="Start"]
        exit  [shape=Msquare, label="Exit"]

        review_gate [
            shape=hexagon,
            label="Review Changes",
            type="wait.human"
        ]

        start -> review_gate
        review_gate -> ship_it [label="[A] Approve"]
        review_gate -> fixes   [label="[F] Fix"]
        ship_it -> exit
        fixes -> review_gate
      }
    `);

    expect(graph.nodes.size).toBe(5);
    const reviewGate = graph.nodes.get("review_gate");
    expect(reviewGate).toBeDefined();
    expect(getStringAttr(reviewGate!.attributes, "shape")).toBe("hexagon");
    expect(getStringAttr(reviewGate!.attributes, "type")).toBe("wait.human");
  });
});

// === INTEGRATION SMOKE TEST (spec 11.13) ===

describe("Integration smoke test from spec section 11.13", () => {
  test("plan -> implement -> review -> done pipeline", async () => {
    const dot = `
      digraph test_pipeline {
        graph [goal="Create a hello world Python script"]

        start       [shape=Mdiamond]
        plan        [shape=box, prompt="Plan how to create a hello world script for: $goal"]
        implement   [shape=box, prompt="Write the code based on the plan", goal_gate=true]
        review      [shape=box, prompt="Review the code for correctness"]
        done        [shape=Msquare]

        start -> plan
        plan -> implement
        implement -> review [condition="outcome=success"]
        implement -> plan   [condition="outcome=fail", label="Retry"]
        review -> done      [condition="outcome=success"]
        review -> implement [condition="outcome=fail", label="Fix"]
      }
    `;

    // 1. Parse
    const graph = parse(dot);
    expect(getStringAttr(graph.attributes, "goal")).toBe("Create a hello world Python script");
    expect(graph.nodes.size).toBe(5);

    // Count total edges
    expect(graph.edges.length).toBe(6);

    // 2. Validate
    const diagnostics = validate(graph);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBe(0);

    // 3. Execute with transforms and stub backend
    const transforms = [new VariableExpansionTransform()];
    const logsRoot = makeLogsRoot();

    let planPromptReceived = "";
    const backend = new StubBackend({
      responseFn: (node, prompt) => {
        if (node.id === "plan") {
          planPromptReceived = prompt;
        }
        return "completed: " + node.id;
      },
    });

    const { runner } = buildRunner(graph, { backend, transforms, logsRoot });
    const result = await runner.run(graph);

    // 4. Verify
    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toContain("plan");
    expect(result.completedNodes).toContain("implement");
    expect(result.completedNodes).toContain("review");

    // Verify $goal expansion happened
    expect(planPromptReceived).toContain("Create a hello world Python script");

    // Verify artifacts exist
    expect(existsSync(join(logsRoot, "plan", "prompt.md"))).toBe(true);
    expect(existsSync(join(logsRoot, "plan", "response.md"))).toBe(true);
    expect(existsSync(join(logsRoot, "plan", "status.json"))).toBe(true);
    expect(existsSync(join(logsRoot, "implement", "prompt.md"))).toBe(true);
    expect(existsSync(join(logsRoot, "review", "prompt.md"))).toBe(true);

    // 5. Verify goal gate (implement has goal_gate=true and succeeded)
    // Since outcome is SUCCESS, goal gate is satisfied

    // 6. Verify checkpoint
    const checkpointPath = join(logsRoot, "checkpoint.json");
    expect(existsSync(checkpointPath)).toBe(true);
    const checkpoint = await loadCheckpoint(checkpointPath);
    expect(checkpoint.completedNodes).toContain("plan");
    expect(checkpoint.completedNodes).toContain("implement");
    expect(checkpoint.completedNodes).toContain("review");
  });
});
