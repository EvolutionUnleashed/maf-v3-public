/** Validate the JSON Schema subset used by MAF's generation contracts.
 * Provider-native schema enforcement is optional; local validation is not.
 */
export function matchesOutputSchema(value: unknown, schema: Record<string, unknown>, depth = 0): boolean {
  if (depth > 100) return false;
  const matches = (item: unknown, rule: unknown) => Boolean(
    rule && typeof rule === "object" && !Array.isArray(rule) &&
    matchesOutputSchema(item, rule as Record<string, unknown>, depth + 1),
  );
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(rule => matches(value, rule))) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
  if (Array.isArray(schema.type)) {
    return schema.type.some(type => matchesOutputSchema(value, { ...schema, type }, depth + 1));
  }
  if (schema.type === "null") return value === null;
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "number" || schema.type === "integer") {
    return typeof value === "number" && Number.isFinite(value) &&
      (schema.type !== "integer" || Number.isInteger(value)) &&
      (typeof schema.minimum !== "number" || value >= schema.minimum) &&
      (typeof schema.maximum !== "number" || value <= schema.maximum);
  }
  if (schema.type === "string") {
    return typeof value === "string" &&
      (typeof schema.minLength !== "number" || value.length >= schema.minLength) &&
      (typeof schema.maxLength !== "number" || value.length <= schema.maxLength);
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    return !schema.items || value.every(item => matches(item, schema.items));
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    const properties = (schema.properties || {}) as Record<string, unknown>;
    if (Array.isArray(schema.required) && schema.required.some(key =>
      typeof key !== "string" || !Object.hasOwn(object, key),
    )) return false;
    return Object.entries(object).every(([key, item]) => {
      if (Object.hasOwn(properties, key)) return matches(item, properties[key]);
      if (schema.additionalProperties === false) return false;
      return typeof schema.additionalProperties !== "object" || matches(item, schema.additionalProperties);
    });
  }
  return true;
}
