/** Retry-After may contain seconds or an HTTP date. */
export function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get("Retry-After");
  if (raw === null || !raw.trim()) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.max(1, Math.ceil(seconds)) : null;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(1, Math.ceil((date - Date.now()) / 1000)) : null;
}

export class ServiceReadError extends Error {
  constructor(message: string, readonly retryAfter: number | null = null) { super(message); }
}

export function serviceReadFailure(response: Response, message: string) {
  return new ServiceReadError(message, retryAfterSeconds(response));
}
