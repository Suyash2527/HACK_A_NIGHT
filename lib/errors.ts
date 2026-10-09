// Typed API errors → the { error: { code, message } } envelope from types/api.ts. API routes never redirect.
import { ERROR_STATUS, type ApiErrorBody, type ErrorCode } from "@/types/api";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  get status() {
    return ERROR_STATUS[this.code];
  }
  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

export const unauthenticated = (m = "Sign in required") => new ApiError("UNAUTHENTICATED", m);
export const forbidden = (m = "You do not have access to this resource") => new ApiError("FORBIDDEN", m);
export const notFound = (m = "Record unavailable") => new ApiError("NOT_FOUND", m);
export const tampered = (m: string, details?: Record<string, unknown>) => new ApiError("TAMPERED", m, details);
export const tooLarge = (m = "File exceeds 4 MB") => new ApiError("TOO_LARGE", m);
export const invalid = (m: string, details?: Record<string, unknown>) => new ApiError("VALIDATION", m, details);
export const unavailable = (m = "The blockchain is not available") => new ApiError("CHAIN_UNAVAILABLE", m);
export const disabledFeature = (m: string) => new ApiError("FEATURE_DISABLED", m);

/** Postgres error → API error. 42501 = insufficient_privilege (RLS WITH CHECK, missing GRANT, append-only trigger). */
export function fromDbError(e: unknown): ApiError | null {
  const code = (e as { code?: string })?.code;
  const message = (e as { message?: string })?.message ?? "";
  if (code === "42501") return forbidden();
  if (code === "23505") return invalid("Duplicate record", { reason: "unique_violation" });
  if (code === "23514" || code === "23502" || code === "23503") return invalid("Invalid data", { reason: message.slice(0, 160) });
  if (code === "P0001") return invalid(message.slice(0, 200)); // RAISE EXCEPTION from our own triggers (lineage, grants)
  return null;
}

/** Turns anything thrown inside a route into a JSON Response. Unknown errors are logged, never leaked. */
export function errorResponse(e: unknown): Response {
  const err = e instanceof ApiError ? e : fromDbError(e);
  if (err) return Response.json(err.body(), { status: err.status });
  console.error("[unhandled]", e);
  return Response.json({ error: { code: "VALIDATION", message: "Unexpected server error" } } satisfies ApiErrorBody, { status: 500 });
}

/** RLS hides rows silently (0 rows affected / empty result). Treat "nothing happened" as not-found/denied, never success. */
export function requireRows<T>(rows: T[], what = "Record"): T[] {
  if (rows.length === 0) throw notFound(`${what} unavailable`);
  return rows;
}
