import { disabled } from "@/lib/http";

export const runtime = "nodejs";

// Deferred (bonus): the Bedrock assistant is cut. Session.assistantEnabled is false.
export const POST = disabled("The evidence assistant is not enabled");
