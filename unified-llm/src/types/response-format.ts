export type ResponseFormat =
  | { type: "text" }
  | { type: "json" }
  | {
      type: "json_schema";
      jsonSchema: Record<string, unknown>;
      strict?: boolean;
    };
