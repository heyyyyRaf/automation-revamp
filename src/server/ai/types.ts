import type { z } from "zod";
import type { JobType } from "@/generated/prisma/client";

export type AIContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: "image/png" | "image/jpeg"; data: Buffer };

export interface StructuredRequest<T> {
  purpose: JobType;
  /** Trusted instructions written by us. Never contains user content. */
  system: string;
  /** User-side content. Anything user-supplied must be wrapped with `untrusted()`. */
  content: AIContentPart[];
  /** Output is validated against this schema before anything is saved. */
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
  signal?: AbortSignal | undefined;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Provider response before validation: `raw` is unknown until checked against the schema. */
export interface ProviderResult {
  raw: unknown;
  usage: TokenUsage;
  model: string;
}

/** Provider-agnostic interface. Swap implementations with the AI_PROVIDER setting. */
export interface AIProvider {
  readonly name: string;
  generate(
    request: StructuredRequest<unknown>,
    jsonSchema: Record<string, unknown>,
  ): Promise<ProviderResult>;
}

export type AIErrorKind =
  "config" | "rate_limited" | "unavailable" | "refused" | "invalid_output" | "too_large" | "budget";

/** Errors with a user-safe message. `retryable` decides whether the job tries again. */
export class AIError extends Error {
  constructor(
    readonly kind: AIErrorKind,
    readonly userMessage: string,
    readonly retryable: boolean,
    readonly usage?: TokenUsage,
  ) {
    super(userMessage);
    this.name = "AIError";
  }
}
