import { timingSafeEqual } from "node:crypto";
import { cognitoAuthenticator, cognitoConfig, type Authenticator } from "@/lib/cognito";
import { getDb } from "@/lib/db";
import { errorResponse, invalid, unauthenticated } from "@/lib/errors";
import { sessionCookie, signSession, toSession, type SessionUser } from "@/lib/session";
import type { LoginRequest } from "@/types/api";

export const runtime = "nodejs";

// Sign-in has two interchangeable back ends; both end with the same signed session cookie:
//   • Amazon Cognito (when COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID are set): real accounts, verified ID token
//   • local demo mode (otherwise): email + the shared DEMO_PASSWORD
// Failed attempts all look identical (no user enumeration). The user's role and station always come from OUR database.
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

let cached: { key: string; auth: Authenticator } | undefined;
function authenticator(): Authenticator {
  const cfg = cognitoConfig();
  if (cfg) {
    const key = `${cfg.userPoolId}/${cfg.clientId}`;
    if (cached?.key !== key) cached = { key, auth: cognitoAuthenticator(cfg) };
    return cached.auth;
  }
  const expected = process.env.DEMO_PASSWORD;
  if (!expected) throw new Error("Neither Cognito nor DEMO_PASSWORD is configured");
  return async (email, password) => {
    if (!same(password, expected)) throw unauthenticated("Invalid email or password");
    return { email: email.trim().toLowerCase() };
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Partial<LoginRequest> | null;
    if (!body || typeof body.email !== "string" || typeof body.password !== "string" || body.email.length > 200 || body.password.length > 200)
      throw invalid("Email and password are required");
    const { email } = await authenticator()(body.email.trim().toLowerCase(), body.password);

    const db = await getDb();
    const user = await db.withUser("00000000-0000-0000-0000-000000000000", async (tx) =>
      (await tx.query<SessionUser>("SELECT * FROM find_user_by_email($1)", [email])).rows[0],
    );
    // authenticated with Cognito but not provisioned in this system → same generic answer
    if (!user) throw unauthenticated("Invalid email or password");

    return Response.json(toSession(user), { headers: { "Set-Cookie": sessionCookie(signSession(user.id)), "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
