import { randomUUID } from "node:crypto";

export function generateTraceId(): string {
  return randomUUID();
}

export function generateSpanId(): string {
  return randomUUID();
}

export function redactForPrivacy<T>(value: T, privacyMode: boolean): T | null {
  return privacyMode ? null : value;
}

export function safeStringify(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
