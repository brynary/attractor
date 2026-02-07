import { describe, test, expect } from "bun:test";
import {
  QuestionType,
  AnswerValue,
  createQuestion,
  createAnswer,
} from "../../src/types/index.js";
import type { Question, Answer } from "../../src/types/index.js";
import { AutoApproveInterviewer } from "../../src/interviewer/auto-approve.js";
import { CallbackInterviewer } from "../../src/interviewer/callback.js";
import { QueueInterviewer } from "../../src/interviewer/queue.js";
import { RecordingInterviewer } from "../../src/interviewer/recording.js";

describe("AutoApproveInterviewer", () => {
  test("returns YES for YES_NO questions", async () => {
    const interviewer = new AutoApproveInterviewer();
    const question = createQuestion({
      text: "Continue?",
      type: QuestionType.YES_NO,
    });
    const answer = await interviewer.ask(question);
    expect(answer.value).toBe(AnswerValue.YES);
  });

  test("returns YES for CONFIRMATION questions", async () => {
    const interviewer = new AutoApproveInterviewer();
    const question = createQuestion({
      text: "Are you sure?",
      type: QuestionType.CONFIRMATION,
    });
    const answer = await interviewer.ask(question);
    expect(answer.value).toBe(AnswerValue.YES);
  });

  test("returns first option for MULTIPLE_CHOICE questions", async () => {
    const interviewer = new AutoApproveInterviewer();
    const question = createQuestion({
      text: "Pick one",
      type: QuestionType.MULTIPLE_CHOICE,
      options: [
        { key: "a", label: "Option A" },
        { key: "b", label: "Option B" },
      ],
    });
    const answer = await interviewer.ask(question);
    expect(answer.value).toBe("a");
    expect(answer.selectedOption).toEqual({ key: "a", label: "Option A" });
  });

  test("returns auto-approved for MULTIPLE_CHOICE with no options", async () => {
    const interviewer = new AutoApproveInterviewer();
    const question = createQuestion({
      text: "Pick one",
      type: QuestionType.MULTIPLE_CHOICE,
    });
    const answer = await interviewer.ask(question);
    expect(answer.value).toBe("auto-approved");
    expect(answer.text).toBe("auto-approved");
  });

  test("returns auto-approved for FREEFORM questions", async () => {
    const interviewer = new AutoApproveInterviewer();
    const question = createQuestion({
      text: "Enter text",
      type: QuestionType.FREEFORM,
    });
    const answer = await interviewer.ask(question);
    expect(answer.value).toBe("auto-approved");
    expect(answer.text).toBe("auto-approved");
  });

  test("inform resolves without error", async () => {
    const interviewer = new AutoApproveInterviewer();
    await expect(interviewer.inform("hello", "stage1")).resolves.toBeUndefined();
  });
});

describe("CallbackInterviewer", () => {
  test("delegates ask to the provided callback", async () => {
    const expected = createAnswer({ value: "custom-value", text: "custom" });
    const callback = async (_q: Question): Promise<Answer> => expected;
    const interviewer = new CallbackInterviewer(callback);

    const question = createQuestion({
      text: "What?",
      type: QuestionType.FREEFORM,
    });
    const answer = await interviewer.ask(question);
    expect(answer).toBe(expected);
  });

  test("passes the question to the callback", async () => {
    let receivedQuestion: Question | undefined;
    const callback = async (q: Question): Promise<Answer> => {
      receivedQuestion = q;
      return createAnswer({ value: AnswerValue.YES });
    };
    const interviewer = new CallbackInterviewer(callback);

    const question = createQuestion({
      text: "Proceed?",
      type: QuestionType.YES_NO,
    });
    await interviewer.ask(question);
    expect(receivedQuestion).toBe(question);
  });

  test("inform resolves without error", async () => {
    const callback = async (_q: Question): Promise<Answer> =>
      createAnswer({ value: AnswerValue.YES });
    const interviewer = new CallbackInterviewer(callback);
    await expect(interviewer.inform("msg", "s")).resolves.toBeUndefined();
  });
});

describe("QueueInterviewer", () => {
  test("returns queued answers in order", async () => {
    const a1 = createAnswer({ value: "first" });
    const a2 = createAnswer({ value: "second" });
    const interviewer = new QueueInterviewer([a1, a2]);

    const question = createQuestion({
      text: "Q?",
      type: QuestionType.FREEFORM,
    });

    const r1 = await interviewer.ask(question);
    expect(r1.value).toBe("first");

    const r2 = await interviewer.ask(question);
    expect(r2.value).toBe("second");
  });

  test("returns SKIPPED when queue is empty", async () => {
    const interviewer = new QueueInterviewer([]);
    const question = createQuestion({
      text: "Q?",
      type: QuestionType.FREEFORM,
    });

    const answer = await interviewer.ask(question);
    expect(answer.value).toBe(AnswerValue.SKIPPED);
  });

  test("returns SKIPPED after exhausting queue", async () => {
    const a1 = createAnswer({ value: "only" });
    const interviewer = new QueueInterviewer([a1]);

    const question = createQuestion({
      text: "Q?",
      type: QuestionType.FREEFORM,
    });

    await interviewer.ask(question);
    const answer = await interviewer.ask(question);
    expect(answer.value).toBe(AnswerValue.SKIPPED);
  });

  test("does not mutate the original array", async () => {
    const answers = [createAnswer({ value: "a" })];
    const interviewer = new QueueInterviewer(answers);

    const question = createQuestion({
      text: "Q?",
      type: QuestionType.FREEFORM,
    });
    await interviewer.ask(question);
    expect(answers).toHaveLength(1);
  });

  test("inform resolves without error", async () => {
    const interviewer = new QueueInterviewer([]);
    await expect(interviewer.inform("msg", "s")).resolves.toBeUndefined();
  });
});

describe("RecordingInterviewer", () => {
  test("delegates to inner interviewer and returns its answer", async () => {
    const inner = new AutoApproveInterviewer();
    const recording = new RecordingInterviewer(inner);

    const question = createQuestion({
      text: "Go?",
      type: QuestionType.YES_NO,
    });
    const answer = await recording.ask(question);
    expect(answer.value).toBe(AnswerValue.YES);
  });

  test("records question-answer pairs", async () => {
    const inner = new AutoApproveInterviewer();
    const recording = new RecordingInterviewer(inner);

    const q1 = createQuestion({
      text: "First?",
      type: QuestionType.YES_NO,
    });
    const q2 = createQuestion({
      text: "Pick",
      type: QuestionType.MULTIPLE_CHOICE,
      options: [{ key: "x", label: "X" }],
    });

    const a1 = await recording.ask(q1);
    const a2 = await recording.ask(q2);

    expect(recording.recordings).toHaveLength(2);
    expect(recording.recordings[0]?.question).toBe(q1);
    expect(recording.recordings[0]?.answer).toBe(a1);
    expect(recording.recordings[1]?.question).toBe(q2);
    expect(recording.recordings[1]?.answer).toBe(a2);
  });

  test("starts with empty recordings", () => {
    const inner = new AutoApproveInterviewer();
    const recording = new RecordingInterviewer(inner);
    expect(recording.recordings).toHaveLength(0);
  });

  test("delegates inform to inner interviewer", async () => {
    let informCalled = false;
    const inner: import("../../src/types/index.js").Interviewer = {
      ask: async (_q) => createAnswer({ value: AnswerValue.YES }),
      inform: async (_msg, _stage) => {
        informCalled = true;
      },
    };
    const recording = new RecordingInterviewer(inner);
    await recording.inform("hello", "stage");
    expect(informCalled).toBe(true);
  });
});
