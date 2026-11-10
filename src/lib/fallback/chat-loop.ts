/**
 * Server-side function-calling loop for the Fallback pipeline.
 *
 *   seller text → model → (tool calls → executeTool → tool responses → model)* → spoken reply
 *
 * Uses the SAME system prompt, tool declarations and executor as Live mode.
 */
import "server-only";
import { ThinkingLevel, type Content, type GenerateContentConfig, type GoogleGenAI, type Part } from "@google/genai";
import { buildSystemPrompt } from "@/lib/prompts";
import { applyEventToContext } from "@/lib/tools/context";
import { FUNCTION_DECLARATIONS } from "@/lib/tools/declarations";
import { executeTool, traceStatus } from "@/lib/tools/executor";
import type { CallContext, ToolTrace, UiEvent } from "@/lib/types";
import type { ChatResponse } from "./api-types";

const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 80;

/**
 * Keep the history bounded without splitting a function-call / function-response
 * pair: only cut at a turn where the user sent plain text.
 */
function trimHistory(history: Content[]): Content[] {
  if (history.length <= MAX_HISTORY) return history;
  let start = history.length - MAX_HISTORY;
  while (start < history.length && !(history[start].role === "user" && history[start].parts?.some((p) => typeof p.text === "string"))) {
    start++;
  }
  return history.slice(start);
}

/** Strip anything the TTS shouldn't read aloud, in case the model slips. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/\[[A-Z_ :]+\]/g, "") // leaked system cues
    .replace(/[*_#`>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/₹\s?/g, "rupees ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function runChatTurn(opts: {
  ai: GoogleGenAI;
  model: string;
  history: Content[];
  message: string;
  context: CallContext;
}): Promise<ChatResponse> {
  let ctx: CallContext = opts.context;
  const contents: Content[] = [...trimHistory(opts.history), { role: "user", parts: [{ text: opts.message }] }];
  const uiEvents: UiEvent[] = [];
  const traces: ToolTrace[] = [];

  const baseConfig: GenerateContentConfig = {
    systemInstruction: buildSystemPrompt({ mode: ctx.mode, memory: ctx.memory, nowIso: ctx.now_iso }),
    tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
  };
  // Low thinking keeps fallback latency voice-friendly. If a model rejects
  // the setting, we retry once without it.
  let config: GenerateContentConfig = { ...baseConfig, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let response;
    try {
      response = await opts.ai.models.generateContent({ model: opts.model, contents, config });
    } catch (err) {
      if (config.thinkingConfig && /thinking/i.test(String(err))) {
        config = baseConfig;
        response = await opts.ai.models.generateContent({ model: opts.model, contents, config });
      } else {
        throw err;
      }
    }

    const modelContent = response.candidates?.[0]?.content;
    const calls = response.functionCalls ?? [];

    if (!calls.length || round === MAX_TOOL_ROUNDS) {
      const reply = cleanForSpeech(response.text ?? "");
      if (modelContent) contents.push(modelContent);
      return {
        reply: reply || "Sorry, ek second. Could you say that again?",
        uiEvents,
        traces,
        history: contents,
      };
    }

    // Keep the model's turn exactly as returned (thought signatures included).
    contents.push(modelContent ?? { role: "model", parts: calls.map((fc) => ({ functionCall: fc })) });

    const responseParts: Part[] = [];
    for (const fc of calls) {
      const started = Date.now();
      const exec = executeTool(fc.name, fc.args, ctx);
      for (const ev of exec.events) ctx = applyEventToContext(ctx, ev);
      uiEvents.push(...exec.events);
      traces.push({
        id: fc.id ?? `${fc.name}_${started}_${traces.length}`,
        name: fc.name ?? "unknown",
        args: (fc.args as Record<string, unknown>) ?? {},
        status: traceStatus(exec.response),
        result_line: exec.resultLine,
        started_at: started,
        duration_ms: Date.now() - started,
      });
      responseParts.push({ functionResponse: { id: fc.id, name: fc.name, response: exec.response } });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  // Unreachable, but keeps TypeScript happy.
  return { reply: "", uiEvents, traces, history: contents };
}
