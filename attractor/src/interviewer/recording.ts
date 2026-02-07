import type { Question, Answer, Interviewer } from "../types/index.js";

export interface Recording {
  question: Question;
  answer: Answer;
}

export class RecordingInterviewer implements Interviewer {
  private readonly inner: Interviewer;
  readonly recordings: Recording[] = [];

  constructor(inner: Interviewer) {
    this.inner = inner;
  }

  async ask(question: Question): Promise<Answer> {
    const answer = await this.inner.ask(question);
    this.recordings.push({ question, answer });
    return answer;
  }

  inform(message: string, stage: string): Promise<void> {
    return this.inner.inform(message, stage);
  }
}
