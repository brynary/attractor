/**
 * Schema translation utilities for converting between unified types and provider-specific formats.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Encodes image binary data to a data URI string.
 * Used by multiple providers that need base64-encoded images.
 */
export function encodeImageToDataUri(
  data: Uint8Array,
  mediaType: string | undefined,
): string {
  const mime = mediaType ?? "image/png";
  const base64 = btoa(
    Array.from(data, (byte) => String.fromCharCode(byte)).join(""),
  );
  return `data:${mime};base64,${base64}`;
}

/**
 * Converts a Uint8Array to base64 string.
 * Used by providers that need raw base64 without data URI wrapper.
 */
export function encodeToBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

/**
 * Enforces strict JSON schema for OpenAI's structured output mode.
 * - Sets additionalProperties: false
 * - Makes all properties required
 * - Adds "null" to type unions for non-required properties
 * - Recursively applies to nested objects
 */
export function enforceStrictSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...schema };
  result.additionalProperties = false;

  const props = result.properties;
  if (isRecord(props)) {
    const allKeys = Object.keys(props);
    const existing = Array.isArray(result.required)
      ? result.required.filter((v): v is string => typeof v === "string")
      : [];
    const existingSet = new Set(existing);
    const missing = allKeys.filter((k) => !existingSet.has(k));

    const newProps: Record<string, unknown> = {};
    for (const key of allKeys) {
      const prop = props[key];
      if (isRecord(prop)) {
        // Recursively enforce strict schema on nested object properties
        const enforced = isRecord(prop.properties)
          ? enforceStrictSchema({ ...prop })
          : { ...prop };

        // Recurse into array items that are objects
        if (isRecord(enforced.items) && isRecord(enforced.items.properties)) {
          enforced.items = enforceStrictSchema({ ...enforced.items });
        }

        if (missing.includes(key)) {
          const propType = enforced.type;
          enforced.type = Array.isArray(propType)
            ? propType
            : [String(propType), "null"];
        }
        newProps[key] = enforced;
      } else {
        newProps[key] = prop;
      }
    }
    result.properties = newProps;
    result.required = allKeys;
  }

  // Also recurse into top-level items (for array schemas)
  if (isRecord(result.items) && isRecord(result.items.properties)) {
    result.items = enforceStrictSchema({ ...result.items });
  }

  return result;
}
