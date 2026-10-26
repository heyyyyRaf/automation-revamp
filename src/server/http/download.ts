/** A file download that the browser can never render or sniff as something else. */
export function downloadResponse(file: { bytes: Buffer; mimeType: string; fileName: string }) {
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(file.bytes.length),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "private, no-store",
    },
  });
}
