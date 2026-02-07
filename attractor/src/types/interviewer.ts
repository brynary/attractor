export const QuestionType = {
  YES_NO: "yes_no",
  MULTIPLE_CHOICE: "multiple_choice",
  FREEFORM: "freeform",
  CONFIRMATION: "confirmation",
} as const;

export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

export const AnswerValue = {
  YES: "yes",
  NO: "no",
  SKIPPED: "skipped",
  TIMEOUT: "timeout",
} as const;

export type AnswerValue = (typeof AnswerValue)[keyof typeof AnswerValue];

export interface Option {
  key: string;
  label: string;
}

export interface Question {
  text: string;
  type: QuestionType;
  options: Option[];
  defaultAnswer: Answer | undefined;
  timeoutSeconds: number | undefined;
  stage: string;
  metadata: Record<string, unknown>;
}

export interface Answer {
  value: string;
  selectedOption: Option | undefined;
  text: string;
}

export interface Interviewer {
  ask(question: Question): Promise<Answer>;
  inform(message: string, stage: string): Promise<void>;
}

export function createQuestion(partial: Partial<Question> & { text: string; type: QuestionType }): Question {
  return {
    options: [],
    defaultAnswer: undefined,
    timeoutSeconds: undefined,
    stage: "",
    metadata: {},
    ...partial,
  };
}

export function createAnswer(partial: Partial<Answer> & { value: string }): Answer {
  return {
    selectedOption: undefined,
    text: "",
    ...partial,
  };
}
