import { describe, expect, test } from "bun:test";
import { parse, ParseError, LexerError } from "../../src/parser/index.js";

describe("parser", () => {
  test("parses a minimal digraph", () => {
    const graph = parse("digraph G {}");
    expect(graph.name).toBe("G");
    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.length).toBe(0);
  });

  test("parses graph attributes via graph block", () => {
    const graph = parse(`
      digraph G {
        graph [goal="Run tests", label="Test Pipeline"]
      }
    `);
    expect(graph.attributes.get("goal")).toEqual({ kind: "string", value: "Run tests" });
    expect(graph.attributes.get("label")).toEqual({ kind: "string", value: "Test Pipeline" });
  });

  test("parses top-level key=value as graph attributes", () => {
    const graph = parse(`
      digraph G {
        rankdir=LR
      }
    `);
    expect(graph.attributes.get("rankdir")).toEqual({ kind: "string", value: "LR" });
  });

  test("parses node with attributes", () => {
    const graph = parse(`
      digraph G {
        start [shape=Mdiamond, label="Start"]
      }
    `);
    const node = graph.nodes.get("start");
    expect(node).toBeDefined();
    expect(node?.attributes.get("shape")).toEqual({ kind: "string", value: "Mdiamond" });
    expect(node?.attributes.get("label")).toEqual({ kind: "string", value: "Start" });
  });

  test("parses node without attributes", () => {
    const graph = parse(`
      digraph G {
        mynode
      }
    `);
    expect(graph.nodes.has("mynode")).toBe(true);
  });

  test("parses simple edge", () => {
    const graph = parse(`
      digraph G {
        A -> B
      }
    `);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0]?.from).toBe("A");
    expect(graph.edges[0]?.to).toBe("B");
  });

  test("parses edge with attributes", () => {
    const graph = parse(`
      digraph G {
        A -> B [label="next", weight=5]
      }
    `);
    expect(graph.edges[0]?.attributes.get("label")).toEqual({ kind: "string", value: "next" });
    expect(graph.edges[0]?.attributes.get("weight")).toEqual({ kind: "integer", value: 5 });
  });

  test("expands chained edges", () => {
    const graph = parse(`
      digraph G {
        A -> B -> C [label="next"]
      }
    `);
    expect(graph.edges.length).toBe(2);
    expect(graph.edges[0]?.from).toBe("A");
    expect(graph.edges[0]?.to).toBe("B");
    expect(graph.edges[0]?.attributes.get("label")).toEqual({ kind: "string", value: "next" });
    expect(graph.edges[1]?.from).toBe("B");
    expect(graph.edges[1]?.to).toBe("C");
    expect(graph.edges[1]?.attributes.get("label")).toEqual({ kind: "string", value: "next" });
  });

  test("applies node defaults to subsequent nodes", () => {
    const graph = parse(`
      digraph G {
        node [shape=box, timeout="900s"]
        plan [label="Plan"]
        implement [label="Implement"]
      }
    `);
    const plan = graph.nodes.get("plan");
    const impl = graph.nodes.get("implement");
    expect(plan?.attributes.get("shape")).toEqual({ kind: "string", value: "box" });
    expect(plan?.attributes.get("timeout")).toEqual({ kind: "duration", value: 900000, raw: "900s" });
    expect(impl?.attributes.get("shape")).toEqual({ kind: "string", value: "box" });
  });

  test("node explicit attributes override defaults", () => {
    const graph = parse(`
      digraph G {
        node [shape=box, timeout="900s"]
        special [shape=diamond, label="Special"]
      }
    `);
    const special = graph.nodes.get("special");
    expect(special?.attributes.get("shape")).toEqual({ kind: "string", value: "diamond" });
    expect(special?.attributes.get("timeout")).toEqual({ kind: "duration", value: 900000, raw: "900s" });
  });

  test("applies edge defaults", () => {
    const graph = parse(`
      digraph G {
        edge [weight=10]
        A -> B
      }
    `);
    expect(graph.edges[0]?.attributes.get("weight")).toEqual({ kind: "integer", value: 10 });
  });

  test("edge explicit attributes override defaults", () => {
    const graph = parse(`
      digraph G {
        edge [weight=10]
        A -> B [weight=20]
      }
    `);
    expect(graph.edges[0]?.attributes.get("weight")).toEqual({ kind: "integer", value: 20 });
  });

  test("parses subgraph with scoped defaults", () => {
    const graph = parse(`
      digraph G {
        subgraph cluster_loop {
          node [timeout="900s"]
          Plan [label="Plan"]
          Implement [label="Implement", timeout="1800s"]
        }
      }
    `);
    const plan = graph.nodes.get("Plan");
    const impl = graph.nodes.get("Implement");
    expect(plan?.attributes.get("timeout")).toEqual({ kind: "duration", value: 900000, raw: "900s" });
    expect(impl?.attributes.get("timeout")).toEqual({ kind: "duration", value: 1800000, raw: "1800s" });
  });

  test("subgraph label derives class for contained nodes", () => {
    const graph = parse(`
      digraph G {
        subgraph cluster_loop {
          label = "Loop A"
          Plan [label="Plan"]
        }
      }
    `);
    const plan = graph.nodes.get("Plan");
    expect(plan?.attributes.get("class")).toEqual({ kind: "string", value: "loop-a" });
  });

  test("parses class attribute on nodes", () => {
    const graph = parse(`
      digraph G {
        review [shape=box, class="code,critical"]
      }
    `);
    const review = graph.nodes.get("review");
    expect(review?.attributes.get("class")).toEqual({ kind: "string", value: "code,critical" });
  });

  test("parses boolean values", () => {
    const graph = parse(`
      digraph G {
        gate [goal_gate=true, auto_status=false]
      }
    `);
    const gate = graph.nodes.get("gate");
    expect(gate?.attributes.get("goal_gate")).toEqual({ kind: "boolean", value: true });
    expect(gate?.attributes.get("auto_status")).toEqual({ kind: "boolean", value: false });
  });

  test("parses integer values", () => {
    const graph = parse(`
      digraph G {
        graph [default_max_retry=50]
      }
    `);
    expect(graph.attributes.get("default_max_retry")).toEqual({ kind: "integer", value: 50 });
  });

  test("parses float values", () => {
    const graph = parse(`
      digraph G {
        node_a [threshold=0.5]
      }
    `);
    const node = graph.nodes.get("node_a");
    expect(node?.attributes.get("threshold")).toEqual({ kind: "float", value: 0.5 });
  });

  test("parses duration values in strings", () => {
    const graph = parse(`
      digraph G {
        node_a [timeout="900s"]
      }
    `);
    const node = graph.nodes.get("node_a");
    expect(node?.attributes.get("timeout")).toEqual({ kind: "duration", value: 900000, raw: "900s" });
  });

  test("parses unquoted duration values", () => {
    const graph = parse(`
      digraph G {
        node_a [timeout=900s]
      }
    `);
    const node = graph.nodes.get("node_a");
    expect(node?.attributes.get("timeout")).toEqual({ kind: "duration", value: 900000, raw: "900s" });
  });

  test("parses qualified keys", () => {
    const graph = parse(`
      digraph G {
        node_a [llm.model="gpt-4"]
      }
    `);
    const node = graph.nodes.get("node_a");
    expect(node?.attributes.get("llm.model")).toEqual({ kind: "string", value: "gpt-4" });
  });

  test("semicolons are optional", () => {
    const graph = parse(`
      digraph G {
        A [label="A"];
        B [label="B"]
        A -> B;
      }
    `);
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.length).toBe(1);
  });

  test("handles comments in DOT source", () => {
    const graph = parse(`
      digraph G {
        // This is a comment
        A [label="A"]
        /* Multi-line
           comment */
        B [label="B"]
        A -> B
      }
    `);
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.length).toBe(1);
  });

  test("creates implicit nodes from edge statements", () => {
    const graph = parse(`
      digraph G {
        A -> B -> C
      }
    `);
    expect(graph.nodes.has("A")).toBe(true);
    expect(graph.nodes.has("B")).toBe(true);
    expect(graph.nodes.has("C")).toBe(true);
  });

  test("rejects undirected graph keyword", () => {
    expect(() => parse("graph G {}")).toThrow(ParseError);
  });

  test("rejects undirected edge operator", () => {
    expect(() => parse("digraph G { A -- B }")).toThrow(LexerError);
  });

  test("rejects strict modifier", () => {
    expect(() => parse("strict digraph G {}")).toThrow(ParseError);
  });

  test("rejects missing digraph keyword", () => {
    expect(() => parse("G {}")).toThrow(ParseError);
  });

  test("edges reference same node object when node declared separately", () => {
    const graph = parse(`
      digraph G {
        A [label="Node A"]
        A -> B
      }
    `);
    const node = graph.nodes.get("A");
    expect(node?.attributes.get("label")).toEqual({ kind: "string", value: "Node A" });
    expect(graph.edges[0]?.from).toBe("A");
  });
});
