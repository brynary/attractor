import type { Question, Answer, Interviewer } from "../types/index.js";

export class CallbackInterviewer implements Interviewer {
  private readonly callback: (question: Question) => Promise<Answer>;

  constructor(callback: (question: Question) => Promise<Answer>) {
    this.callback = callback;
  }

  ask(question: Question): Promise<Answer> {
    return this.callback(question);
  }

  inform(_message: string, _stage: string): Promise<void> {
    return Promise.resolve();
  }
}
