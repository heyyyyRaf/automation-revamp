import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import {
  AIError,
  type AIProvider,
  type ProviderResult,
  type StructuredRequest,
} from "@/server/ai/types";

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  baseURL?: string | undefined;
  /** Tests inject a fake fetch; nothing else should. */
  fetch?: typeof fetch;
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIProviderOptions) {
    this.model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      maxRetries: 2,
      timeout: 180_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async generate(
    request: StructuredRequest<unknown>,
    jsonSchema: Record<string, unknown>,
  ): Promise<ProviderResult> {
    const content: ResponseInputContent[] = request.content.map((part) =>
      part.type === "text"
        ? { type: "input_text", text: part.text }
        : {
            type: "input_image",
            detail: "high",
            image_url: `data:${part.mimeType};base64,${part.data.toString("base64")}`,
          },
    );

    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create(
        {
          model: this.model,
          instructions: request.system,
          input: [{ role: "user", content }],
          text: {
            format: {
              type: "json_schema",
              name: request.schemaName,
              schema: jsonSchema,
              strict: true,
            },
          },
          max_output_tokens: request.maxOutputTokens,
          // Don't keep project documents on the provider side.
          store: false,
        },
        { signal: request.signal },
      );
    } catch (err) {
      throw mapError(err);
    }

    const usage = {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };

    for (const item of response.output) {
      if (item.type === "message") {
        for (const c of item.content) {
          if (c.type === "refusal") {
            throw new AIError("refused", "The AI declined to process this content.", false, usage);
          }
        }
      }
    }
    if (response.status === "incomplete") {
      const tooLong = response.incomplete_details?.reason === "max_output_tokens";
      throw new AIError(
        tooLong ? "too_large" : "invalid_output",
        tooLong
          ? "The AI response was too long. Try splitting large documents."
          : "The AI stopped before finishing.",
        !tooLong,
        usage,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(response.output_text);
    } catch {
      throw new AIError("invalid_output", "The AI returned an unreadable answer.", true, usage);
    }
    return { raw, usage, model: response.model };
  }
}

function mapError(err: unknown): AIError {
  if (err instanceof OpenAI.APIUserAbortError) {
    return new AIError("unavailable", "The AI request was cancelled.", false);
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new AIError("unavailable", "Couldn't reach the AI service.", true);
  }
  if (err instanceof OpenAI.APIError) {
    switch (err.status) {
      case 401:
      case 403:
        return new AIError(
          "config",
          "The AI service rejected our credentials. Ask an Admin to check the API key.",
          false,
        );
      case 404:
        return new AIError(
          "config",
          "The configured AI model isn't available. Ask an Admin to check OPENAI_MODEL.",
          false,
        );
      case 400:
      case 413:
      case 422:
        return new AIError(
          "too_large",
          "The AI service couldn't accept this request (it may be too large).",
          false,
        );
      case 429:
        return new AIError("rate_limited", "The AI service is busy right now.", true);
      default:
        return new AIError("unavailable", "The AI service had a temporary problem.", true);
    }
  }
  return new AIError("unavailable", "The AI service had a temporary problem.", true);
}
