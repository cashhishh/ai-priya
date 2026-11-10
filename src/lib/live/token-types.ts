/** Response contract for POST /api/live-token. */
export interface LiveTokenResponse {
  token: string;
  model: string;
  apiVersion: string;
  expiresAt: string;
}
