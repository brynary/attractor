export const PipelineEventKind = {
  PIPELINE_STARTED: "pipeline_started",
  PIPELINE_COMPLETED: "pipeline_completed",
  PIPELINE_FAILED: "pipeline_failed",
  STAGE_STARTED: "stage_started",
  STAGE_COMPLETED: "stage_completed",
  STAGE_FAILED: "stage_failed",
  STAGE_RETRYING: "stage_retrying",
  PARALLEL_STARTED: "parallel_started",
  PARALLEL_BRANCH_STARTED: "parallel_branch_started",
  PARALLEL_BRANCH_COMPLETED: "parallel_branch_completed",
  PARALLEL_COMPLETED: "parallel_completed",
  INTERVIEW_STARTED: "interview_started",
  INTERVIEW_COMPLETED: "interview_completed",
  INTERVIEW_TIMEOUT: "interview_timeout",
  CHECKPOINT_SAVED: "checkpoint_saved",
} as const;

export type PipelineEventKind =
  (typeof PipelineEventKind)[keyof typeof PipelineEventKind];

export interface PipelineEvent {
  kind: PipelineEventKind;
  timestamp: Date;
  pipelineId: string;
  data: Record<string, unknown>;
}
