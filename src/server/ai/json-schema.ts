import { z } from "zod";

/** Keywords some providers reject in strict structured-output mode. Zod re-checks them afterwards. */
const STRIPPED = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "default",
]);

/**
 * Converts a Zod schema into a strict, provider-friendly JSON Schema:
 * every object closed (`additionalProperties: false`) with all properties required.
 * Size limits are enforced by Zod validation after the response, not by the provider.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "throw" });
  return clean(json) as Record<string, unknown>;
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIPPED.has(key)) continue;
    out[key] = clean(value);
  }
  if (out["type"] === "object" && out["properties"] && typeof out["properties"] === "object") {
    out["additionalProperties"] = false;
    out["required"] = Object.keys(out["properties"]);
  }
  return out;
}
