import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Question, Answer, Interviewer } from "../types/index.js";
import { QuestionType, AnswerValue, createAnswer } from "../types/index.js";

export class ConsoleInterviewer implements Interviewer {
  async ask(question: Question): Promise<Answer> {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      console.log(`[?] ${question.text}`);

      if (question.type === QuestionType.MULTIPLE_CHOICE) {
        for (const option of question.options) {
          console.log(`  [${option.key}] ${option.label}`);
        }
        const response = await rl.question("Select: ");
        const matched = question.options.find(
          (o) => o.key.toLowerCase() === response.toLowerCase(),
        );
        if (matched) {
          return createAnswer({ value: matched.key, selectedOption: matched });
        }
        return createAnswer({ value: response, text: response });
      }

      if (
        question.type === QuestionType.YES_NO ||
        question.type === QuestionType.CONFIRMATION
      ) {
        const response = await rl.question("[Y/N]: ");
        const value =
          response.toLowerCase() === "y" ? AnswerValue.YES : AnswerValue.NO;
        return createAnswer({ value });
      }

      // FREEFORM
      const response = await rl.question("> ");
      return createAnswer({ value: response, text: response });
    } finally {
      rl.close();
    }
  }

  async inform(message: string, stage: string): Promise<void> {
    console.log(`[${stage}] ${message}`);
  }
}
