/** Field errors as returned by the API (z.flattenError) and produced by client-side validation. */
export type FieldErrors = Partial<Record<string, string[]>>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: FieldErrors = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

function readError(status: number, body: unknown): ApiError {
  const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const message = typeof obj.error === "string" ? obj.error : status >= 500 ? "Something went wrong on our side" : "Request failed";
  const details = typeof obj.details === "object" && obj.details !== null ? (obj.details as Record<string, unknown>) : {};
  const fieldErrors = typeof details.fieldErrors === "object" && details.fieldErrors !== null ? (details.fieldErrors as FieldErrors) : {};
  return new ApiError(status, message, fieldErrors);
}

/**
 * Calls the API through the same-origin /api proxy, so the session cookie is sent automatically.
 * Throws ApiError with the server's message (and field errors for 400s).
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.size > 0 ? `?${params}` : "";

  let res: Response;
  try {
    res = await fetch(`/api${path}${qs}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw readError(res.status, body);
  return body as T;
}

export const isApiError = (err: unknown, status?: number): err is ApiError =>
  err instanceof ApiError && (status === undefined || err.status === status);
