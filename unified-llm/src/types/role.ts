export const Role = {
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
  DEVELOPER: "developer",
} as const;

export type Role = (typeof Role)[keyof typeof Role];
