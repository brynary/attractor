/**
 * Simple JSON Schema validator for tool arguments.
 *
 * Handles the subset of JSON Schema used by tool definitions:
 * top-level "object" type with primitive properties (string, integer, boolean)
 * and a required array.
 */

interface SchemaProperty {
  type?: string;
  enum?: unknown[];
  items?: SchemaProperty;
}

interface ToolSchema {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

/**
 * Validate tool arguments against a JSON Schema definition.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateToolArgs(
  args: Record<string, unknown>,
  schema: Record<string, unknown>,
): string | null {
  const typed = schema as ToolSchema;

  // Only validate object schemas with properties
  if (typed.type !== "object" || typed.properties === undefined) {
    return null;
  }

  // Check required fields
  if (typed.required !== undefined) {
    for (const field of typed.required) {
      if (!(field in args)) {
        return `missing required field "${field}"`;
      }
    }
  }

  // Check types for provided fields
  for (const [key, value] of Object.entries(args)) {
    const propSchema = typed.properties[key];
    if (propSchema === undefined) {
      continue; // allow extra properties
    }

    const typeError = checkType(value, propSchema, key);
    if (typeError !== null) {
      return typeError;
    }

    // Check enum constraint
    if (propSchema.enum !== undefined) {
      if (!propSchema.enum.includes(value)) {
        return `"${key}" must be one of [${propSchema.enum.map(String).join(", ")}], got ${JSON.stringify(value)}`;
      }
    }
  }

  return null;
}

function checkType(value: unknown, schema: SchemaProperty, fieldName: string): string | null {
  if (value === undefined) {
    return null; // undefined handled by required check
  }

  const expectedType = schema.type;
  if (expectedType === undefined) {
    return null;
  }

  if (value === null) {
    return `expected "${fieldName}" to be ${expectedType}, got null`;
  }

  switch (expectedType) {
    case "string":
      if (typeof value !== "string") {
        return `expected "${fieldName}" to be string, got ${typeof value}`;
      }
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return `expected "${fieldName}" to be integer, got ${typeof value === "number" ? "float" : typeof value}`;
      }
      break;
    case "number":
      if (typeof value !== "number") {
        return `expected "${fieldName}" to be number, got ${typeof value}`;
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        return `expected "${fieldName}" to be boolean, got ${typeof value}`;
      }
      break;
    case "array":
      if (!Array.isArray(value)) {
        return `expected "${fieldName}" to be array, got ${typeof value}`;
      }
      if (schema.items !== undefined) {
        for (let i = 0; i < value.length; i++) {
          const itemError = checkType(value[i], schema.items, `${fieldName}[${i}]`);
          if (itemError !== null) {
            return itemError;
          }
        }
      }
      break;
  }

  return null;
}
