import type { Question, Answer, Interviewer } from "../types/index.js";
import { AnswerValue, createAnswer } from "../types/index.js";

export class QueueInterviewer implements Interviewer {
  private readonly answers: Answer[];

  constructor(answers: Answer[]) {
    this.answers = [...answers];
  }

  ask(_question: Question): Promise<Answer> {
    const next = this.answers.shift();
    if (next !== undefined) {
      return Promise.resolve(next);
    }
    return Promise.resolve(createAnswer({ value: AnswerValue.SKIPPED }));
  }

  inform(_message: string, _stage: string): Promise<void> {
    return Promise.resolve();
  }
}
