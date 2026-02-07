import type { Question, Answer, Interviewer } from "../types/index.js";
import { QuestionType, AnswerValue, createAnswer } from "../types/index.js";

export class AutoApproveInterviewer implements Interviewer {
  ask(question: Question): Promise<Answer> {
    if (
      question.type === QuestionType.YES_NO ||
      question.type === QuestionType.CONFIRMATION
    ) {
      return Promise.resolve(createAnswer({ value: AnswerValue.YES }));
    }

    if (
      question.type === QuestionType.MULTIPLE_CHOICE &&
      question.options.length > 0
    ) {
      const first = question.options[0];
      if (first === undefined) {
        return Promise.resolve(
          createAnswer({ value: "auto-approved", text: "auto-approved" }),
        );
      }
      return Promise.resolve(
        createAnswer({ value: first.key, selectedOption: first }),
      );
    }

    return Promise.resolve(
      createAnswer({ value: "auto-approved", text: "auto-approved" }),
    );
  }

  inform(_message: string, _stage: string): Promise<void> {
    return Promise.resolve();
  }
}
