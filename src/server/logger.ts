import pino from "pino";

/** Field paths whose values must never reach the logs. */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "newPassword",
  "*.newPassword",
  "token",
  "*.token",
  "tokenHash",
  "*.tokenHash",
  "csrfSecret",
  "*.csrfSecret",
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "headers.cookie",
  "headers.authorization",
  'headers["x-csrf-token"]',
  'headers["x-figma-token"]',
  'headers["X-Figma-Token"]',
  "username",
  "*.username",
  "storageState",
  "*.storageState",
];

export function createLogger(
  options: { level?: string; destination?: pino.DestinationStream } = {},
) {
  return pino(
    {
      level: options.level ?? process.env.LOG_LEVEL ?? "info",
      base: { service: process.env.SERVICE_NAME ?? "app" },
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    options.destination,
  );
}

export const logger = createLogger();

export type Logger = pino.Logger;
