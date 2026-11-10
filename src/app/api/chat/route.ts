/**
 * POST /api/chat: Fallback pipeline brain.
 * Browser STT text in → Gemini text model + tools → spoken reply + UI events out.
 */
import { runChatTurn } from "@/lib/fallback/chat-loop";
import type { ApiError, ChatRequest } from "@/lib/fallback/api-types";
import { MissingApiKeyError, TEXT_MODEL, getClient } from "@/lib/server/gemini";

export const maxDuration = 60;

function bad(status: number, body: ApiError) {
  return Response.json(body, { status });
}

function isChatRequest(v: unknown): v is ChatRequest {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<ChatRequest>;
  return (
    Array.isArray(r.history) &&
    typeof r.message === "string" &&
    r.message.length < 4000 &&
    !!r.context &&
    typeof r.context === "object" &&
    ["inbound", "proactive", "follow_up"].includes(r.context.mode)
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad(400, { error: "bad_request", message: "Invalid JSON" });
  }
  if (!isChatRequest(body)) return bad(400, { error: "bad_request", message: "Invalid chat request" });

  try {
    const ai = getClient();
    // The server clock is the source of truth for dates.
    const context = { ...body.context, now_iso: new Date().toISOString() };
    const result = await runChatTurn({ ai, model: TEXT_MODEL, history: body.history, message: body.message, context });
    return Response.json(result);
  } catch (err) {
    if (err instanceof MissingApiKeyError) return bad(500, { error: "missing_api_key", message: err.message });
    console.error("[/api/chat]", err);
    return bad(502, { error: "upstream_error", message: err instanceof Error ? err.message : "Model call failed" });
  }
}
