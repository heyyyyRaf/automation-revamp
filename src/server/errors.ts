/** Errors whose `message` is safe to show to the user. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, "BAD_REQUEST", message, details);

export const validationError = (message: string, details?: Record<string, unknown>) =>
  new AppError(422, "VALIDATION_ERROR", message, details);

export const unauthorized = (message = "Please sign in to continue.") =>
  new AppError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "You don't have permission to do that.") =>
  new AppError(403, "FORBIDDEN", message);

/** Used both for missing rows and for rows the caller may not see, so existence is not leaked. */
export const notFound = (what = "Item") => new AppError(404, "NOT_FOUND", `${what} not found.`);

export const conflict = (message: string) => new AppError(409, "CONFLICT", message);

export const payloadTooLarge = (message: string) => new AppError(413, "PAYLOAD_TOO_LARGE", message);

export const unsupportedMediaType = (message: string) =>
  new AppError(415, "UNSUPPORTED_FILE", message);

export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppError(429, "RATE_LIMITED", "Too many attempts. Please wait and try again.", {
    retryAfterSeconds,
  });
