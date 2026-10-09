// SERVER-ONLY. Stateless signed session cookie for the LOCAL demo login. In AWS the same `SessionUser` comes from a
// verified Cognito JWT instead (aws-jwt-verify); every route only ever calls requireUser(), so the swap is one file.
//
// Cookie value:  base64url(JSON {uid, exp}) . base64url(HMAC-SHA256(secret, payload))
// The cookie carries ONLY the user id + expiry. Role, station etc. are always re-read from the database, so a stolen or
// stale cookie can never grant a role the user no longer has.
import { createHmac, timingSafeEqual } from "node:crypto";
import { allowedUploadTypes, canCreateCase } from "./policy";
import { unauthenticated } from "./errors";
import { getDb } from "./db";
import type { Role, Session } from "@/types/api";

export const SESSION_COOKIE = "sakshya_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function secret(env: NodeJS.ProcessEnv = process.env): Buffer {
  const s = env.SESSION_SECRET;
  if (s && s.length >= 32) return Buffer.from(s, "utf8");
  if (env.NODE_ENV === "production") throw new Error("SESSION_SECRET (≥32 chars) must be set in production");
  return Buffer.from("dev-only-session-secret-change-me-0123456789", "utf8"); // local dev convenience only
}

export function signSession(uid: string, now = Date.now(), env: NodeJS.ProcessEnv = process.env): string {
  const payload = b64u(JSON.stringify({ uid, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS }));
  const sig = b64u(createHmac("sha256", secret(env)).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Returns the user id, or null for anything malformed, forged or expired. */
export function verifySession(token: string | undefined | null, now = Date.now(), env: NodeJS.ProcessEnv = process.env): string | null {
  if (!token) return null;
  const [payload, sig, ...rest] = token.split(".");
  if (!payload || !sig || rest.length) return null;
  const expected = createHmac("sha256", secret(env)).update(payload).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, "base64url"); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { uid?: string; exp?: number };
    if (typeof uid !== "string" || typeof exp !== "number" || exp * 1000 < now) return null;
    return uid;
  } catch { return null; }
}

export function sessionCookie(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}
export const clearedCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function cookieFrom(request: Request, name = SESSION_COOKIE): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export interface SessionUser { id: string; name: string; email: string; role: Role; station: string; clearance: number }

/** Authenticates the request: valid cookie → fresh user row (as that user, under RLS). Throws UNAUTHENTICATED otherwise. */
export async function requireUser(request: Request): Promise<SessionUser> {
  const uid = verifySession(cookieFrom(request));
  if (!uid) throw unauthenticated();
  const db = await getDb();
  const user = await db.withUser(uid, async (tx) =>
    (await tx.query<SessionUser>("SELECT id, name, email, role, station, clearance FROM users WHERE id = app_uid()")).rows[0],
  ).catch(() => undefined);
  if (!user) throw unauthenticated("Session is no longer valid");
  return user;
}

export function toSession(user: SessionUser): Session {
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, station: user.station, clearance: Number(user.clearance) },
    canCreateCase: canCreateCase(user.role),
    allowedUploadTypes: allowedUploadTypes(user.role),
    assistantEnabled: false, // bonus feature: off until the Bedrock RAG path is built
  };
}
