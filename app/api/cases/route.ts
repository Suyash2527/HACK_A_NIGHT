import { createCase, listCases } from "@/lib/cases";
import { authed, jsonBody, optStr, pageArgs } from "@/lib/http";

export const runtime = "nodejs";

export const GET = authed(async (request, user) => {
  const url = new URL(request.url);
  return listCases(user, url.searchParams.get("q") ?? undefined, pageArgs(url));
});

export const POST = authed(async (request, user) => {
  const body = request.headers.get("content-length") === "0" ? {} : await jsonBody(request);
  const firText = optStr(body.firText, "firText", 20_000);
  return createCase(user, optStr(body.complainantEmail, "complainantEmail", 200), firText);
});
