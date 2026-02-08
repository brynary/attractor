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
  PIPELINE_RESTARTED: "pipeline_restarted",
  TOOL_HOOK_PRE: "tool_hook_pre",
  TOOL_HOOK_POST: "tool_hook_post",
} as const;

export type PipelineEventKind =
  (typeof PipelineEventKind)[keyof typeof PipelineEventKind];

// -- Typed event data interfaces --

export interface PipelineStartedData {
  name?: string;
  id?: string;
  graphName?: string;
  [key: string]: unknown;
}

export interface PipelineCompletedData {
  duration?: number;
  artifactCount?: number;
  completedNodes?: string[];
  status?: string;
  [key: string]: unknown;
}

export interface PipelineFailedData {
  error?: string;
  duration?: number;
  reason?: string;
  nodeId?: string;
  [key: string]: unknown;
}

export interface StageStartedData {
  name?: string;
  index?: number;
  nodeId?: string;
  [key: string]: unknown;
}

export interface StageCompletedData {
  name?: string;
  index?: number;
  duration?: number;
  nodeId?: string;
  status?: string;
  [key: string]: unknown;
}

export interface StageFailedData {
  name?: string;
  index?: number;
  error?: string;
  willRetry?: boolean;
  nodeId?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface StageRetryingData {
  name?: string;
  index?: number;
  attempt?: number;
  delay?: number;
  nodeId?: string;
  maxAttempts?: number;
  reason?: string;
  [key: string]: unknown;
}

export interface ParallelStartedData {
  branchCount?: number;
  [key: string]: unknown;
}

export interface ParallelBranchStartedData {
  branch?: string;
  index?: number;
  [key: string]: unknown;
}

export interface ParallelBranchCompletedData {
  branch?: string;
  index?: number;
  duration?: number;
  success?: boolean;
  [key: string]: unknown;
}

export interface ParallelCompletedData {
  duration?: number;
  successCount?: number;
  failureCount?: number;
  [key: string]: unknown;
}

export interface InterviewStartedData {
  question?: string;
  stage?: string;
  [key: string]: unknown;
}

export interface InterviewCompletedData {
  question?: string;
  answer?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface InterviewTimeoutData {
  question?: string;
  stage?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface CheckpointSavedData {
  nodeId?: string;
  [key: string]: unknown;
}

export interface PipelineRestartedData {
  restartCount?: number;
  targetNode?: string;
  logsRoot?: string;
  [key: string]: unknown;
}

export interface ToolHookPreData {
  nodeId?: string;
  command?: string;
  [key: string]: unknown;
}

export interface ToolHookPostData {
  nodeId?: string;
  command?: string;
  [key: string]: unknown;
}

// -- Mapping from event kind to data type --

export interface PipelineEventDataMap {
  [PipelineEventKind.PIPELINE_STARTED]: PipelineStartedData;
  [PipelineEventKind.PIPELINE_COMPLETED]: PipelineCompletedData;
  [PipelineEventKind.PIPELINE_FAILED]: PipelineFailedData;
  [PipelineEventKind.STAGE_STARTED]: StageStartedData;
  [PipelineEventKind.STAGE_COMPLETED]: StageCompletedData;
  [PipelineEventKind.STAGE_FAILED]: StageFailedData;
  [PipelineEventKind.STAGE_RETRYING]: StageRetryingData;
  [PipelineEventKind.PARALLEL_STARTED]: ParallelStartedData;
  [PipelineEventKind.PARALLEL_BRANCH_STARTED]: ParallelBranchStartedData;
  [PipelineEventKind.PARALLEL_BRANCH_COMPLETED]: ParallelBranchCompletedData;
  [PipelineEventKind.PARALLEL_COMPLETED]: ParallelCompletedData;
  [PipelineEventKind.INTERVIEW_STARTED]: InterviewStartedData;
  [PipelineEventKind.INTERVIEW_COMPLETED]: InterviewCompletedData;
  [PipelineEventKind.INTERVIEW_TIMEOUT]: InterviewTimeoutData;
  [PipelineEventKind.CHECKPOINT_SAVED]: CheckpointSavedData;
  [PipelineEventKind.PIPELINE_RESTARTED]: PipelineRestartedData;
  [PipelineEventKind.TOOL_HOOK_PRE]: ToolHookPreData;
  [PipelineEventKind.TOOL_HOOK_POST]: ToolHookPostData;
}

// -- Discriminated union of all events --

export type PipelineEvent = {
  [K in PipelineEventKind]: {
    kind: K;
    timestamp: Date;
    pipelineId: string;
    data: PipelineEventDataMap[K];
  };
}[PipelineEventKind];
