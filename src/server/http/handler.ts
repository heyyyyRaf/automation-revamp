import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CSRF_HEADER, sessionCookieName } from "@/server/auth/cookies";
import { validateSessionToken, type AuthContext } from "@/server/auth/session";
import { safeEqual } from "@/server/auth/tokens";
import { getEnv } from "@/server/env";
import {
  AppError,
  badRequest,
  forbidden,
  payloadTooLarge,
  unauthorized,
  validationError,
} from "@/server/errors";
import { getClientIp } from "@/server/http/client-ip";
import { logger, type Logger } from "@/server/logger";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_JSON_BYTES = 1024 * 1024;
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export interface RequestContext<P> {
  req: NextRequest;
  params: P;
  requestId: string;
  ip: string;
  log: Logger;
}

export interface AuthedContext<P> extends RequestContext<P> {
  auth: AuthContext;
}

type RouteArgs = { params: Promise<Record<string, string | string[]>> };

interface Options {
  /** Default true. Public routes (login) set false. */
  auth?: boolean;
}

/**
 * Wraps a route handler with: request ID, origin + CSRF checks on state-changing requests,
 * session auth, and uniform error responses (never stack traces).
 */
export function route<P extends Record<string, string>>(
  handler: (ctx: AuthedContext<P>) => Promise<Response>,
): (req: NextRequest, args: RouteArgs) => Promise<Response>;
export function route<P extends Record<string, string>>(
  options: { auth: false },
  handler: (ctx: RequestContext<P>) => Promise<Response>,
): (req: NextRequest, args: RouteArgs) => Promise<Response>;
export function route<P extends Record<string, string>>(
  a: Options | ((ctx: AuthedContext<P>) => Promise<Response>),
  b?: (ctx: RequestContext<P>) => Promise<Response>,
) {
  const options: Options = typeof a === "function" ? {} : a;
  const handler = (typeof a === "function" ? a : b) as (
    ctx: RequestContext<P> & { auth?: AuthContext },
  ) => Promise<Response>;
  const requireAuth = options.auth !== false;

  return async (req: NextRequest, args: RouteArgs): Promise<Response> => {
    const incomingId = req.headers.get("x-request-id");
    const requestId = incomingId && REQUEST_ID_RE.test(incomingId) ? incomingId : randomUUID();
    const ip = getClientIp(req.headers);
    const log = logger.child({ requestId, method: req.method, path: req.nextUrl.pathname });
    let response: Response;

    try {
      const mutating = !SAFE_METHODS.has(req.method);
      if (mutating) assertSameOrigin(req);

      const params = (await args.params) as P;
      if (!requireAuth) {
        response = await handler({ req, params, requestId, ip, log });
      } else {
        const auth = await validateSessionToken(req.cookies.get(sessionCookieName())?.value);
        if (!auth) throw unauthorized();
        if (mutating) {
          const header = req.headers.get(CSRF_HEADER) ?? "";
          if (!safeEqual(header, auth.csrfToken)) {
            throw forbidden("Your session security check failed. Please refresh the page.");
          }
        }
        response = await handler({
          req,
          params,
          requestId,
          ip,
          log: log.child({ userId: auth.user.id }),
          auth,
        });
      }
    } catch (error) {
      response = errorResponse(error, requestId, log);
    }

    response.headers.set("x-request-id", requestId);
    if (!response.headers.has("cache-control")) response.headers.set("cache-control", "no-store");
    return response;
  };
}

function assertSameOrigin(req: NextRequest): void {
  const expected = new URL(getEnv().APP_URL).origin;
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== expected) throw forbidden("Cross-site request blocked.");
    return;
  }
  const referer = req.headers.get("referer");
  if (!referer || safeOrigin(referer) !== expected) throw forbidden("Cross-site request blocked.");
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function errorResponse(error: unknown, requestId: string, log: Logger): Response {
  if (error instanceof AppError) {
    if (error.status >= 500) log.error({ err: error }, "request failed");
    else log.info({ code: error.code, status: error.status }, "request rejected");
    const res = NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details, requestId } },
      { status: error.status },
    );
    const retry = error.details?.["retryAfterSeconds"];
    if (typeof retry === "number") res.headers.set("retry-after", String(retry));
    return res;
  }
  if (error instanceof z.ZodError) {
    return errorResponse(
      validationError("Some fields are invalid.", { fields: z.flattenError(error).fieldErrors }),
      requestId,
      log,
    );
  }
  log.error({ err: error }, "unhandled error");
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong on our side. Please try again.",
        requestId,
      },
    },
    { status: 500 },
  );
}

/** Reads and validates a JSON body (max 1 MB). */
export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_JSON_BYTES) throw payloadTooLarge("Request body is too large.");
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw payloadTooLarge("Request body is too large.");
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  return schema.parse(raw);
}

export function json(data: unknown, status = 200): Response {
  return NextResponse.json(data, { status });
}
