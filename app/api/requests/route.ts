import { fileRequest, listRequests } from "@/lib/requests";
import { authed, jsonBody, pageArgs } from "@/lib/http";
import { invalid } from "@/lib/errors";
import type { FileRequestBody } from "@/types/api";

export const runtime = "nodejs";

export const GET = authed(async (request, user) => {
  const url = new URL(request.url);
  return listRequests(user, { caseId: url.searchParams.get("caseId") ?? undefined, status: url.searchParams.get("status") ?? undefined }, pageArgs(url));
});

export const POST = authed(async (request, user) => {
  const body = await jsonBody(request);
  if (typeof body.reason !== "string" || typeof body.legalBasis !== "object" || body.legalBasis === null) throw invalid("caseId, documentIds, legalBasis and reason are required");
  const res = await fileRequest(user, body as unknown as FileRequestBody);
  return Response.json(res, { status: 201, headers: { "Cache-Control": "no-store" } });
});
