import type { Transform } from "../types/transform.js";
import { VariableExpansionTransform } from "./variable-expansion.js";
import { StylesheetTransform } from "./stylesheet-transform.js";
import { PreambleTransform } from "./preamble-transform.js";

export { VariableExpansionTransform } from "./variable-expansion.js";
export { StylesheetTransform } from "./stylesheet-transform.js";
export { GraphMergeTransform } from "./graph-merge.js";
export { PreambleTransform } from "./preamble-transform.js";
export { TransformRegistry } from "./registry.js";

/** Returns the built-in transforms that the runner prepends before user transforms. */
export function builtInTransforms(): Transform[] {
  return [new VariableExpansionTransform(), new StylesheetTransform(), new PreambleTransform()];
}
