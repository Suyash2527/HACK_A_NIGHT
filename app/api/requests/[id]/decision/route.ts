import { decideRequest } from "@/lib/requests";
import { authed, jsonBody, requireUuid } from "@/lib/http";
import type { DecideRequestBody } from "@/types/api";

export const runtime = "nodejs";

export const POST = authed(async (request, user, p) => decideRequest(user, requireUuid(p.id, "request id"), (await jsonBody(request)) as unknown as DecideRequestBody));
