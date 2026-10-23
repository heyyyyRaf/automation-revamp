/** Browser-side fetch wrapper: adds the CSRF header and turns error JSON into ApiError. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fieldErrors: Record<string, string[] | undefined> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ErrorBody {
  error?: {
    message?: string;
    code?: string;
    details?: { fields?: Record<string, string[] | undefined> };
  };
}

function csrfToken(): string {
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith("__Host-tqa_csrf=") || c.startsWith("tqa_csrf="));
  return match ? decodeURIComponent(match.slice(match.indexOf("=") + 1)) : "";
}

interface Options {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  form?: FormData;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const method = options.method ?? (options.json !== undefined || options.form ? "POST" : "GET");
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") headers["x-csrf-token"] = csrfToken();
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(
      "Can't reach the server. Check your connection and try again.",
      0,
      "NETWORK",
    );
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ErrorBody | null)?.error;
    const expired = res.status === 401 && !path.startsWith("/api/auth/login");
    throw new ApiError(
      expired
        ? "Your session has ended. Refresh the page to sign in again."
        : (err?.message ?? "Something went wrong. Please try again."),
      res.status,
      err?.code ?? "UNKNOWN",
      err?.details?.fields ?? {},
    );
  }
  return data as T;
}
