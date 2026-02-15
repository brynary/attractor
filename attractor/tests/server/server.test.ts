import { describe, test, expect, afterEach } from "bun:test";
import { createServer } from "../../src/server/server.js";
import type { AttractorServer } from "../../src/server/server.js";
import { createHandlerRegistry } from "../../src/engine/runner.js";
import { StartHandler } from "../../src/handlers/start.js";
import { ExitHandler } from "../../src/handlers/exit.js";
import { StageStatus, createOutcome } from "../../src/types/outcome.js";
import type { Handler } from "../../src/types/handler.js";

const SIMPLE_DOT = `digraph test {
  start [shape=Mdiamond]
  done [shape=Msquare]
  start -> done
}`;

const DOT_WITH_WORK = `digraph test {
  start [shape=Mdiamond]
  work [shape=box]
  done [shape=Msquare]
  start -> work
  work -> done
}`;

function makeRegistry(workHandler?: Handler) {
  const registry = createHandlerRegistry();
  registry.register("start", new StartHandler());
  registry.register("exit", new ExitHandler());
  if (workHandler) {
    registry.defaultHandler = workHandler;
  } else {
    registry.defaultHandler = {
      async execute() {
        return createOutcome({ status: StageStatus.SUCCESS, notes: "stub" });
      },
    };
  }
  return registry;
}

let server: AttractorServer | undefined;

afterEach(() => {
  if (server) {
    server.stop();
    server = undefined;
  }
});

function baseUrl(): string {
  return `http://127.0.0.1:${server?.port ?? 0}`;
}

describe("Attractor HTTP Server", () => {
  test("POST /pipelines creates a new pipeline run", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: SIMPLE_DOT }),
    });
    expect(res.status).toBe(201);
    const body: unknown = await res.json();
    expect(typeof body).toBe("object");
    if (typeof body === "object" && body !== null) {
      expect("id" in body).toBe(true);
      expect("status" in body).toBe(true);
    }
  });

  test("POST /pipelines returns 400 for invalid DOT", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: "not valid dot" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /pipelines returns 400 for missing dot field", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ something: "else" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /pipelines/:id returns pipeline status", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const createRes = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: SIMPLE_DOT }),
    });
    const createBody = (await createRes.json()) as Record<string, unknown>;
    const id = createBody["id"];
    expect(typeof id).toBe("string");

    // Wait a bit for pipeline to complete
    await Bun.sleep(100);

    const getRes = await fetch(`${baseUrl()}/pipelines/${String(id)}`);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect(getBody["id"]).toBe(id);
    expect(typeof getBody["status"]).toBe("string");
  });

  test("GET /pipelines/:id returns 404 for nonexistent pipeline", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/pipelines/nonexistent-id`);
    expect(res.status).toBe(404);
  });

  test("POST /pipelines/:id/cancel cancels a running pipeline", async () => {
    // Use a handler that takes a long time
    const slowHandler: Handler = {
      async execute() {
        await Bun.sleep(10000);
        return createOutcome({ status: StageStatus.SUCCESS });
      },
    };
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry(slowHandler) } });
    const createRes = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: DOT_WITH_WORK }),
    });
    const createBody = (await createRes.json()) as Record<string, unknown>;
    const id = String(createBody["id"]);

    const cancelRes = await fetch(`${baseUrl()}/pipelines/${id}/cancel`, {
      method: "POST",
    });
    expect(cancelRes.status).toBe(200);
    const cancelBody = (await cancelRes.json()) as Record<string, unknown>;
    expect(cancelBody["status"]).toBe("cancelled");
  });

  test("cancelled status is not overwritten when run promise resolves later", async () => {
    const slowHandler: Handler = {
      async execute() {
        await Bun.sleep(300);
        return createOutcome({ status: StageStatus.SUCCESS });
      },
    };
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry(slowHandler) } });
    const createRes = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: DOT_WITH_WORK }),
    });
    const createBody = (await createRes.json()) as Record<string, unknown>;
    const id = String(createBody["id"]);

    const cancelRes = await fetch(`${baseUrl()}/pipelines/${id}/cancel`, {
      method: "POST",
    });
    expect(cancelRes.status).toBe(200);

    await Bun.sleep(500);
    const getRes = await fetch(`${baseUrl()}/pipelines/${id}`);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect(getBody["status"]).toBe("cancelled");
  });

  test("GET /pipelines/:id/questions returns null when no pending question", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const createRes = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: SIMPLE_DOT }),
    });
    const createBody = (await createRes.json()) as Record<string, unknown>;
    const id = String(createBody["id"]);

    await Bun.sleep(50);

    const qRes = await fetch(`${baseUrl()}/pipelines/${id}/questions`);
    expect(qRes.status).toBe(200);
    const qBody = (await qRes.json()) as Record<string, unknown>;
    expect(qBody["question"]).toBeNull();
  });

  test("human gate works even when wait.human is not pre-registered", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });

    const dotWithGate = `digraph gate_test {
      start [shape=Mdiamond]
      gate [shape=hexagon, label="Approve?"]
      done [shape=box]
      exit [shape=Msquare]
      start -> gate
      gate -> done [label="[A] Approve"]
      done -> exit
    }`;

    const createRes = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: dotWithGate }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as Record<string, unknown>;
    const id = String(createBody["id"]);

    let questionId = "";
    let choice = "";
    for (let i = 0; i < 50; i++) {
      const qRes = await fetch(`${baseUrl()}/pipelines/${id}/questions`);
      expect(qRes.status).toBe(200);
      const qBody = (await qRes.json()) as {
        id?: string;
        question: null | { options: Array<{ key: string }> };
      };
      if (qBody.question && qBody.id) {
        questionId = qBody.id;
        choice = qBody.question.options[0]?.key ?? "A";
        break;
      }
      await Bun.sleep(50);
    }

    expect(questionId.length > 0).toBe(true);

    const answerRes = await fetch(
      `${baseUrl()}/pipelines/${id}/questions/${questionId}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: choice }),
      },
    );
    expect(answerRes.status).toBe(200);

    let status = "running";
    for (let i = 0; i < 60 && status === "running"; i++) {
      const statusRes = await fetch(`${baseUrl()}/pipelines/${id}`);
      expect(statusRes.status).toBe(200);
      const statusBody = (await statusRes.json()) as { status: string };
      status = statusBody.status;
      if (status === "running") {
        await Bun.sleep(50);
      }
    }

    expect(status).toBe("completed");
  });

  test("GET /pipelines/:id/context returns context after completion", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const createRes = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: SIMPLE_DOT }),
    });
    const createBody = (await createRes.json()) as Record<string, unknown>;
    const id = String(createBody["id"]);

    await Bun.sleep(100);

    const ctxRes = await fetch(`${baseUrl()}/pipelines/${id}/context`);
    expect(ctxRes.status).toBe(200);
    const ctxBody = (await ctxRes.json()) as Record<string, unknown>;
    expect("context" in ctxBody).toBe(true);
  });

  test("GET /pipelines/:id/checkpoint returns checkpoint data", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const createRes = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: SIMPLE_DOT }),
    });
    const createBody = (await createRes.json()) as Record<string, unknown>;
    const id = String(createBody["id"]);

    await Bun.sleep(100);

    const cpRes = await fetch(`${baseUrl()}/pipelines/${id}/checkpoint`);
    expect(cpRes.status).toBe(200);
  });

  test("GET /pipelines/:id/events returns SSE content type", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const createRes = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: SIMPLE_DOT }),
    });
    const createBody = (await createRes.json()) as Record<string, unknown>;
    const id = String(createBody["id"]);

    const eventsRes = await fetch(`${baseUrl()}/pipelines/${id}/events`);
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.headers.get("content-type")).toBe("text/event-stream");
  });

  test("unknown route returns 404", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/unknown`);
    expect(res.status).toBe(404);
  });
});
