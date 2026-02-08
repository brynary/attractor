import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Question, Answer, Interviewer, Option } from "../types/index.js";
import { QuestionType, AnswerValue, createAnswer } from "../types/index.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const MAX_RETRIES = 3;

export interface ConsoleInterviewerOptions {
  timeoutMs?: number;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export class ConsoleInterviewer implements Interviewer {
  private readonly timeoutMs: number | undefined;
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;

  constructor(options?: ConsoleInterviewerOptions) {
    this.timeoutMs = options?.timeoutMs;
    this.input = options?.input ?? stdin;
    this.output = options?.output ?? stdout;
  }

  async ask(question: Question): Promise<Answer> {
    const rl = readline.createInterface({
      input: this.input,
      output: this.output,
    });
    const effectiveTimeoutMs = this.effectiveTimeoutMs(question);
    try {
      const defaultSuffix = question.defaultAnswer
        ? ` ${DIM}[default: ${question.defaultAnswer.value}]${RESET}`
        : "";
      this.log(`${BOLD}[?] ${question.text}${RESET}${defaultSuffix}`);

      if (question.type === QuestionType.MULTIPLE_CHOICE) {
        return await this.askMultipleChoice(rl, question, effectiveTimeoutMs);
      }

      if (
        question.type === QuestionType.YES_NO ||
        question.type === QuestionType.CONFIRMATION
      ) {
        const response = await this.prompt(rl, `${CYAN}[Y/N]: ${RESET}`, effectiveTimeoutMs);
        if (response === "" && question.defaultAnswer) {
          return question.defaultAnswer;
        }
        const value =
          response.toLowerCase() === "y" ? AnswerValue.YES : AnswerValue.NO;
        return createAnswer({ value });
      }

      // FREEFORM
      const response = await this.prompt(rl, `${CYAN}> ${RESET}`, effectiveTimeoutMs);
      if (response === "" && question.defaultAnswer) {
        return question.defaultAnswer;
      }
      return createAnswer({ value: response, text: response });
    } finally {
      rl.close();
    }
  }

  async askMultiple(questions: Question[]): Promise<Answer[]> {
    const answers: Answer[] = [];
    for (const q of questions) {
      answers.push(await this.ask(q));
    }
    return answers;
  }

  async inform(message: string, stage: string): Promise<void> {
    this.log(`[${stage}] ${message}`);
  }

  private async askMultipleChoice(
    rl: readline.Interface,
    question: Question,
    effectiveTimeoutMs: number | undefined,
  ): Promise<Answer> {
    question.options.forEach((option) => {
      this.log(`  ${DIM}[${option.key}] ${option.label}${RESET}`);
    });

    let retries = 0;
    while (retries < MAX_RETRIES) {
      let response: string;
      try {
        response = await this.prompt(rl, `${CYAN}Select: ${RESET}`, effectiveTimeoutMs);
      } catch (err) {
        if (err instanceof InputClosedError) {
          break;
        }
        throw err;
      }
      if (response === "" && question.defaultAnswer) {
        return question.defaultAnswer;
      }
      const matched = question.options.find(
        (o) => o.key.toLowerCase() === response.toLowerCase(),
      );
      if (matched) {
        return createAnswer({ value: matched.key, selectedOption: matched });
      }
      retries++;
      if (retries < MAX_RETRIES) {
        this.log(`Invalid selection. Please try again.`);
      }
    }

    // After MAX_RETRIES invalid attempts, return the first option
    const fallback: Option | undefined = question.options[0];
    if (fallback) {
      return createAnswer({ value: fallback.key, selectedOption: fallback });
    }
    return createAnswer({ value: "", text: "" });
  }

  private effectiveTimeoutMs(question: Question): number | undefined {
    if (question.timeoutSeconds !== undefined) {
      return question.timeoutSeconds * 1000;
    }
    return this.timeoutMs;
  }

  private async prompt(
    rl: readline.Interface,
    promptText: string,
    timeoutMs: number | undefined,
  ): Promise<string> {
    let questionPromise: Promise<string>;
    try {
      questionPromise = rl.question(promptText);
    } catch {
      throw new InputClosedError();
    }

    if (timeoutMs === undefined) {
      return questionPromise;
    }

    const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
      setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
    });

    const result = await Promise.race([questionPromise, timeoutPromise]);
    if (result === TIMEOUT_SENTINEL) {
      rl.close();
      throw new TimeoutError();
    }
    return result;
  }

  private log(message: string): void {
    this.output.write(message + "\n");
  }
}

const TIMEOUT_SENTINEL = Symbol("timeout");

class TimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "TimeoutError";
  }
}

class InputClosedError extends Error {
  constructor() {
    super("input closed");
    this.name = "InputClosedError";
  }
}

/** Wraps a ConsoleInterviewer to catch TimeoutError and return a TIMEOUT answer */
export function withTimeout(interviewer: ConsoleInterviewer): Interviewer {
  return {
    async ask(question: Question): Promise<Answer> {
      try {
        return await interviewer.ask(question);
      } catch (err) {
        if (err instanceof TimeoutError) {
          if (question.defaultAnswer) {
            return question.defaultAnswer;
          }
          return createAnswer({ value: AnswerValue.TIMEOUT });
        }
        throw err;
      }
    },
    async askMultiple(questions: Question[]): Promise<Answer[]> {
      const answers: Answer[] = [];
      for (const q of questions) {
        answers.push(await this.ask(q));
      }
      return answers;
    },
    async inform(message: string, stage: string): Promise<void> {
      return interviewer.inform(message, stage);
    },
  };
}
