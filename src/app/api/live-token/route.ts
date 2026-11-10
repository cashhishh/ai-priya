/**
 * POST /api/live-token: mints a short-lived, single-use Gemini Live
 * ephemeral token so the browser can open a WebSocket to Gemini directly
 * (lowest latency) without ever seeing GEMINI_API_KEY.
 *
 *  - uses: 1         → one new session per token (resumption doesn't count as a use)
 *  - newSessionExpireTime: 2 min → must connect quickly
 *  - expireTime: 30 min → hard cap on the session
 */
import type { LiveTokenResponse } from "@/lib/live/token-types";
import { LIVE_API_VERSION, LIVE_MODEL, MissingApiKeyError, getClient } from "@/lib/server/gemini";


const OTHER_VERSION: Record<string, string> = { v1alpha: "v1beta", v1beta: "v1alpha" };

/** Basic abuse guard: only our own pages may mint tokens. */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from some browsers omit it
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

async function mint(apiVersion: string): Promise<LiveTokenResponse> {
  const client = getClient(apiVersion);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime: expiresAt,
      newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    },
  });
  if (!token.name) throw new Error("Token response had no name");
  return { token: token.name, model: LIVE_MODEL, apiVersion, expiresAt };
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "forbidden", message: "Cross-origin token requests are not allowed." }, { status: 403 });
  }
  const url = new URL(request.url);
  const requested = url.searchParams.get("apiVersion");
  const first = requested && OTHER_VERSION[requested] ? requested : LIVE_API_VERSION;

  try {
    try {
      return Response.json(await mint(first));
    } catch (err) {
      if (err instanceof MissingApiKeyError) throw err;
      // Docs and SDK disagree on v1alpha vs v1beta for ephemeral tokens: try the other.
      console.warn(`[/api/live-token] ${first} failed, retrying with ${OTHER_VERSION[first]}:`, err);
      return Response.json(await mint(OTHER_VERSION[first] ?? "v1beta"));
    }
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return Response.json({ error: "missing_api_key", message: err.message }, { status: 500 });
    }
    console.error("[/api/live-token]", err);
    return Response.json(
      { error: "upstream_error", message: err instanceof Error ? err.message : "Could not create a Live token" },
      { status: 502 },
    );
  }
}
