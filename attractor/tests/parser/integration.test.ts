import { describe, expect, test } from "bun:test";
import { parse } from "../../src/parser/index.js";

describe("integration: spec examples from section 2.13", () => {
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
    expect(graph.attributes.get("goal")).toEqual({ kind: "string", value: "Run tests and report" });
    expect(graph.attributes.get("rankdir")).toEqual({ kind: "string", value: "LR" });

    expect(graph.nodes.size).toBe(4);

    const start = graph.nodes.get("start");
    expect(start?.attributes.get("shape")).toEqual({ kind: "string", value: "Mdiamond" });
    expect(start?.attributes.get("label")).toEqual({ kind: "string", value: "Start" });

    const exit = graph.nodes.get("exit");
    expect(exit?.attributes.get("shape")).toEqual({ kind: "string", value: "Msquare" });

    const runTests = graph.nodes.get("run_tests");
    expect(runTests?.attributes.get("label")).toEqual({ kind: "string", value: "Run Tests" });
    expect(runTests?.attributes.get("prompt")).toEqual({
      kind: "string",
      value: "Run the test suite and report results",
    });

    const report = graph.nodes.get("report");
    expect(report?.attributes.get("label")).toEqual({ kind: "string", value: "Report" });

    expect(graph.edges.length).toBe(3);
    expect(graph.edges[0]?.from).toBe("start");
    expect(graph.edges[0]?.to).toBe("run_tests");
    expect(graph.edges[1]?.from).toBe("run_tests");
    expect(graph.edges[1]?.to).toBe("report");
    expect(graph.edges[2]?.from).toBe("report");
    expect(graph.edges[2]?.to).toBe("exit");
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

    expect(graph.name).toBe("Branch");
    expect(graph.nodes.size).toBe(6);

    // Check node defaults were applied
    const plan = graph.nodes.get("plan");
    expect(plan?.attributes.get("shape")).toEqual({ kind: "string", value: "box" });
    expect(plan?.attributes.get("timeout")).toEqual({ kind: "duration", value: 900000, raw: "900s" });

    // Check explicit shape overrides defaults
    const gate = graph.nodes.get("gate");
    expect(gate?.attributes.get("shape")).toEqual({ kind: "string", value: "diamond" });
    expect(gate?.attributes.get("timeout")).toEqual({ kind: "duration", value: 900000, raw: "900s" });

    // Check start/exit nodes override shape default
    const start = graph.nodes.get("start");
    expect(start?.attributes.get("shape")).toEqual({ kind: "string", value: "Mdiamond" });

    // Edges: 4 from chain + 2 from gate
    expect(graph.edges.length).toBe(6);

    const gateToExit = graph.edges.find((e) => e.from === "gate" && e.to === "exit");
    expect(gateToExit?.attributes.get("label")).toEqual({ kind: "string", value: "Yes" });
    expect(gateToExit?.attributes.get("condition")).toEqual({ kind: "string", value: "outcome=success" });

    const gateToImpl = graph.edges.find((e) => e.from === "gate" && e.to === "implement");
    expect(gateToImpl?.attributes.get("label")).toEqual({ kind: "string", value: "No" });
  });

  test("human gate workflow", () => {
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

    expect(graph.name).toBe("Review");
    expect(graph.nodes.size).toBe(5);

    const reviewGate = graph.nodes.get("review_gate");
    expect(reviewGate?.attributes.get("shape")).toEqual({ kind: "string", value: "hexagon" });
    expect(reviewGate?.attributes.get("label")).toEqual({ kind: "string", value: "Review Changes" });
    expect(reviewGate?.attributes.get("type")).toEqual({ kind: "string", value: "wait.human" });

    expect(graph.edges.length).toBe(5);

    const toApprove = graph.edges.find((e) => e.from === "review_gate" && e.to === "ship_it");
    expect(toApprove?.attributes.get("label")).toEqual({ kind: "string", value: "[A] Approve" });

    const toFixes = graph.edges.find((e) => e.from === "review_gate" && e.to === "fixes");
    expect(toFixes?.attributes.get("label")).toEqual({ kind: "string", value: "[F] Fix" });

    const loop = graph.edges.find((e) => e.from === "fixes" && e.to === "review_gate");
    expect(loop).toBeDefined();
  });
});
