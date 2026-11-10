/**
 * Server-only Gemini configuration. GEMINI_API_KEY never leaves the server:
 * the browser gets either short-lived ephemeral tokens (Live) or proxied
 * responses (/api/chat).
 */
import "server-only";
import { GoogleGenAI } from "@google/genai";

/** Native-audio Live model (real-time bidirectional speech). */
export const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";
/** Text model used by the fallback pipeline. */
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-3.6-flash";
/**
 * API version for ephemeral tokens. The JS SDK documents v1alpha for
 * ephemeral tokens; the token route falls back to the other version automatically.
 */
export const LIVE_API_VERSION = process.env.GEMINI_LIVE_API_VERSION || "v1alpha";

export class MissingApiKeyError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not set on the server. Add it to .env.local (or Vercel env vars) and restart.");
    this.name = "MissingApiKeyError";
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function getClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();
  return new GoogleGenAI({ apiKey, ...(apiVersion ? { httpOptions: { apiVersion } } : {}) });
}
