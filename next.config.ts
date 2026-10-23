import type { NextConfig } from "next";
import { API_CSP, securityHeaders } from "./src/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
    ];
  },
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Native / wasm packages that must not be bundled into server chunks.
  serverExternalPackages: [
    "@node-rs/argon2",
    "@napi-rs/canvas",
    "sharp",
    "tesseract.js",
    "unpdf",
    "pino",
    "pino-pretty",
    "bullmq",
    "ioredis",
  ],
};

export default nextConfig;
