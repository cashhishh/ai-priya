/** GET /api/health: lets the UI warn early if the API key is missing. Never returns the key. */
import { connection } from "next/server";
import { LIVE_MODEL, TEXT_MODEL, hasApiKey } from "@/lib/server/gemini";

export async function GET() {
  // Opt out of build-time prerendering: the key is only present at runtime.
  await connection();
  return Response.json({ hasKey: hasApiKey(), liveModel: LIVE_MODEL, textModel: TEXT_MODEL });
}
