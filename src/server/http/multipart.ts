import { badRequest, payloadTooLarge } from "@/server/errors";

/**
 * Parses multipart form data while counting bytes as they stream in, so an oversized or
 * mislabelled (chunked) body is cut off at `maxBytes` instead of being buffered entirely.
 */
export async function readLimitedFormData(req: Request, maxBytes: number): Promise<FormData> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw payloadTooLarge(`Uploads are limited to ${toMb(maxBytes)} MB.`);
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw badRequest("Expected a file upload.");
  }
  if (!req.body) throw badRequest("Expected a file upload.");

  let seen = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        controller.error(new LimitExceeded());
        return;
      }
      controller.enqueue(chunk);
    },
  });

  const limited = new Request("http://upload.local/", {
    method: "POST",
    headers: { "content-type": contentType },
    body: req.body.pipeThrough(limiter),
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  try {
    return await limited.formData();
  } catch {
    if (seen > maxBytes) throw payloadTooLarge(`Uploads are limited to ${toMb(maxBytes)} MB.`);
    throw badRequest("The upload couldn't be read. Please try again.");
  }
}

class LimitExceeded extends Error {}

function toMb(bytes: number): number {
  return Math.floor(bytes / 1024 / 1024);
}
