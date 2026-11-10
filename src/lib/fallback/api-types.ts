/** Request/response contract for POST /api/chat (Fallback voice pipeline). */
import type { Content } from "@google/genai";
import type { CallContext, ToolTrace, UiEvent } from "@/lib/types";

export interface ChatRequest {
  /** Full conversation so far, as Gemini Content (round-tripped so thought signatures survive). */
  history: Content[];
  /** What the seller just said (or a [SYSTEM CUE]). */
  message: string;
  context: CallContext;
}

export interface ChatResponse {
  reply: string;
  uiEvents: UiEvent[];
  traces: ToolTrace[];
  history: Content[];
}

export interface ApiError {
  error: "missing_api_key" | "bad_request" | "upstream_error";
  message: string;
}
