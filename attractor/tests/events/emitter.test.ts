import { describe, test, expect } from "bun:test";
import { PipelineEventEmitter } from "../../src/events/emitter.js";
import { PipelineEventKind } from "../../src/types/index.js";
import type { PipelineEvent } from "../../src/types/index.js";

function makeEvent(kind: PipelineEvent["kind"]): PipelineEvent {
  return {
    kind,
    timestamp: new Date(),
    pipelineId: "test-pipeline",
    data: {},
  };
}

describe("PipelineEventEmitter", () => {
  test("consumer receives emitted events", async () => {
    const emitter = new PipelineEventEmitter();
    const gen = emitter.events();
    const event = makeEvent(PipelineEventKind.PIPELINE_STARTED);

    emitter.emit(event);
    emitter.close();

    const result = await gen.next();
    expect(result.done).toBe(false);
    expect(result.value).toBe(event);
  });

  test("multiple consumers receive the same events", async () => {
    const emitter = new PipelineEventEmitter();
    const gen1 = emitter.events();
    const gen2 = emitter.events();
    const event = makeEvent(PipelineEventKind.STAGE_STARTED);

    emitter.emit(event);
    emitter.close();

    const r1 = await gen1.next();
    const r2 = await gen2.next();
    expect(r1.value).toBe(event);
    expect(r2.value).toBe(event);
  });

  test("close stops generators", async () => {
    const emitter = new PipelineEventEmitter();
    const gen = emitter.events();

    emitter.close();

    const result = await gen.next();
    expect(result.done).toBe(true);
  });

  test("events emitted before first next() are captured", async () => {
    const emitter = new PipelineEventEmitter();
    const gen = emitter.events();

    const e1 = makeEvent(PipelineEventKind.PIPELINE_STARTED);
    const e2 = makeEvent(PipelineEventKind.STAGE_STARTED);
    emitter.emit(e1);
    emitter.emit(e2);
    emitter.close();

    const r1 = await gen.next();
    const r2 = await gen.next();
    expect(r1.value).toBe(e1);
    expect(r2.value).toBe(e2);
  });

  test("consumer registered after emit does not receive past events", async () => {
    const emitter = new PipelineEventEmitter();
    const event = makeEvent(PipelineEventKind.PIPELINE_STARTED);
    emitter.emit(event);

    const gen = emitter.events();
    emitter.close();

    const result = await gen.next();
    expect(result.done).toBe(true);
  });

  test("events are delivered in order", async () => {
    const emitter = new PipelineEventEmitter();
    const gen = emitter.events();

    const e1 = makeEvent(PipelineEventKind.PIPELINE_STARTED);
    const e2 = makeEvent(PipelineEventKind.STAGE_STARTED);
    const e3 = makeEvent(PipelineEventKind.STAGE_COMPLETED);

    emitter.emit(e1);
    emitter.emit(e2);
    emitter.emit(e3);
    emitter.close();

    const r1 = await gen.next();
    const r2 = await gen.next();
    const r3 = await gen.next();

    expect(r1.value).toBe(e1);
    expect(r2.value).toBe(e2);
    expect(r3.value).toBe(e3);
  });
});
