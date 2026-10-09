// SERVER-ONLY helpers shared by every route handler: authentication, uniform error envelope, no-store caching,
// opaque offset pagination and small input validators. Routes stay thin wrappers over lib/*.
import type { Page } from "@/types/api";
import { errorResponse, invalid } from "./errors";
import { requireUser, type SessionUser } from "./session";

export type Params = Promise<Record<string, string>>;
export interface RouteCtx { params: Params }

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Wraps a handler: authenticates, serialises plain results as JSON, maps every thrown error to the envelope. */
export function authed(fn: (request: Request, user: SessionUser, params: Record<string, string>) => Promise<unknown>) {
  return async (request: Request, ctx?: RouteCtx): Promise<Response> => {
    try {
      const user = await requireUser(request);
      const out = await fn(request, user, ctx ? await ctx.params : {});
      return out instanceof Response ? out : Response.json(out, { headers: NO_STORE });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** For deferred/bonus routes. */
export function disabled(message: string) {
  return async (): Promise<Response> =>
    Response.json({ error: { code: "FEATURE_DISABLED", message } }, { status: 503, headers: NO_STORE });
}

// ───────────────────────────── validators
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export function requireUuid(v: unknown, what = "id"): string {
  if (!isUuid(v)) throw invalid(`${what} must be a valid UUID`);
  return v.toLowerCase();
}
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("A JSON object body is required");
  return body as Record<string, unknown>;
}
export function str(v: unknown, what: string, max = 2000): string {
  if (typeof v !== "string" || !v.trim()) throw invalid(`${what} is required`);
  if (v.length > max) throw invalid(`${what} is too long`);
  return v.trim();
}
export function optStr(v: unknown, what: string, max = 2000): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return str(v, what, max);
}

// ───────────────────────────── pagination (cursor = opaque offset)
export interface PageArgs { limit: number; offset: number }
export function pageArgs(url: URL, defaultLimit = 25, maxLimit = 100): PageArgs {
  const l = Number(url.searchParams.get("limit") ?? defaultLimit);
  if (!Number.isInteger(l) || l < 1) throw invalid("limit must be a positive integer");
  const c = url.searchParams.get("cursor");
  let offset = 0;
  if (c) {
    offset = Number(Buffer.from(c, "base64url").toString("utf8").replace(/^o:/, ""));
    if (!Number.isInteger(offset) || offset < 0) throw invalid("cursor is invalid");
  }
  return { limit: Math.min(l, maxLimit), offset };
}
/** Builds a page from already-trimmed items plus a "more rows exist" flag. */
export function pageOf<T>(items: T[], more: boolean, a: PageArgs): Page<T> {
  return { items, nextCursor: more ? Buffer.from(`o:${a.offset + a.limit}`).toString("base64url") : null };
}
/** Pass up to limit+1 fetched rows; trims and sets nextCursor when more exist. */
export function toPage<T>(rows: T[], a: PageArgs): Page<T> {
  const more = rows.length > a.limit;
  return { items: more ? rows.slice(0, a.limit) : rows, nextCursor: more ? Buffer.from(`o:${a.offset + a.limit}`).toString("base64url") : null };
}
