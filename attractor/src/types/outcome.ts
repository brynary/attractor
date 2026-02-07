export const StageStatus = {
  SUCCESS: "success",
  PARTIAL_SUCCESS: "partial_success",
  RETRY: "retry",
  FAIL: "fail",
  SKIPPED: "skipped",
} as const;

export type StageStatus = (typeof StageStatus)[keyof typeof StageStatus];

export interface Outcome {
  status: StageStatus;
  preferredLabel: string;
  suggestedNextIds: string[];
  contextUpdates: Record<string, string>;
  notes: string;
  failureReason: string;
}

export function createOutcome(partial: Partial<Outcome> & { status: StageStatus }): Outcome {
  return {
    preferredLabel: "",
    suggestedNextIds: [],
    contextUpdates: {},
    notes: "",
    failureReason: "",
    ...partial,
  };
}
