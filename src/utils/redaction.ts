const SENSITIVE_FIELD = /(api[-_]?key|token|secret|password|authorization|cookie|credential)/i;

export function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SENSITIVE_FIELD.test(key) ? "[REDACTED]" : redactSensitiveValues(nested),
      ]),
    );
  }
  return value;
}

export function summarizeToolArguments(args: Record<string, unknown>): string {
  const fields = Object.keys(args).sort();
  return fields.length > 0 ? `Argument fields: ${fields.join(", ")}` : "No arguments";
}
