import { JobFailure } from "@/server/jobs/runner";

const API = "https://api.figma.com/v1";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
/** Hosts Figma serves rendered images from. Anything else is refused (SSRF protection). */
const IMAGE_HOSTS = new Set(["figma-alpha-api.s3.us-west-2.amazonaws.com"]);

export interface FigmaLink {
  fileKey: string;
  nodeId: string | null;
}

/** Parses figma.com/{file|design|proto|board}/{key}/...?node-id=1-2 links. */
export function parseFigmaLink(url: string): FigmaLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !["figma.com", "www.figma.com"].includes(u.hostname)) return null;
  const m = /^\/(?:file|design|proto|board)\/([A-Za-z0-9]{10,128})(?:\/|$)/.exec(u.pathname);
  if (!m?.[1]) return null;
  const rawNode = u.searchParams.get("node-id");
  const nodeId = rawNode && /^\d+[-:]\d+$/.test(rawNode) ? rawNode.replace("-", ":") : null;
  return { fileKey: m[1], nodeId };
}

export function isAllowedImageHost(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" && (IMAGE_HOSTS.has(u.hostname) || u.hostname.endsWith(".figma.com"))
    );
  } catch {
    return false;
  }
}

let fetchImpl: typeof fetch = (...args) => fetch(...args);

/** Tests only. */
export function setFigmaFetch(f: typeof fetch): void {
  fetchImpl = f;
}

export interface FigmaFrame {
  id: string;
  name: string;
}

export class FigmaClient {
  constructor(
    private readonly token: string,
    private readonly signal: AbortSignal,
  ) {}

  private async api<T>(path: string): Promise<T> {
    const res = await fetchImpl(`${API}${path}`, {
      headers: { "X-Figma-Token": this.token },
      redirect: "error",
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    }).catch(() => {
      throw new JobFailure("Couldn't reach Figma.", true);
    });
    if (res.status === 403 || res.status === 401) {
      throw new JobFailure(
        "Figma denied access to this file. Make sure the configured Figma token can open it.",
        false,
      );
    }
    if (res.status === 404) throw new JobFailure("Figma couldn't find this file or frame.", false);
    if (res.status === 429 || res.status >= 500)
      throw new JobFailure("Figma is busy right now.", true);
    if (!res.ok) throw new JobFailure("Figma rejected the request.", false);
    return (await res.json()) as T;
  }

  /** The linked frame, or up to `limit` top-level frames of the file's pages. */
  async listFrames(link: FigmaLink, limit: number): Promise<FigmaFrame[]> {
    if (link.nodeId) {
      const data = await this.api<{
        nodes?: Record<string, { document?: { name?: string } } | null>;
      }>(`/files/${link.fileKey}/nodes?ids=${encodeURIComponent(link.nodeId)}&depth=1`);
      const node = data.nodes?.[link.nodeId];
      if (!node) throw new JobFailure("Figma couldn't find this frame.", false);
      return [{ id: link.nodeId, name: node.document?.name ?? "Frame" }];
    }
    const file = await this.api<{
      document?: { children?: { children?: { id: string; name: string; type: string }[] }[] };
    }>(`/files/${link.fileKey}?depth=2`);
    const frames: FigmaFrame[] = [];
    for (const page of file.document?.children ?? []) {
      for (const child of page.children ?? []) {
        if (["FRAME", "COMPONENT", "SECTION", "COMPONENT_SET"].includes(child.type)) {
          frames.push({ id: child.id, name: child.name });
          if (frames.length >= limit) return frames;
        }
      }
    }
    return frames;
  }

  /** Renders frames to PNG via Figma and downloads them from Figma's image host only. */
  async renderPngs(
    fileKey: string,
    frames: FigmaFrame[],
  ): Promise<{ frame: FigmaFrame; png: Buffer }[]> {
    if (frames.length === 0) return [];
    const ids = frames.map((f) => f.id).join(",");
    const data = await this.api<{ err?: string | null; images?: Record<string, string | null> }>(
      `/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=1`,
    );
    if (data.err) throw new JobFailure("Figma couldn't render these frames.", false);
    const out: { frame: FigmaFrame; png: Buffer }[] = [];
    for (const frame of frames) {
      const url = data.images?.[frame.id];
      if (!url) continue;
      if (!isAllowedImageHost(url))
        throw new JobFailure("Figma returned an unexpected image location.", false);
      out.push({ frame, png: await this.download(url) });
    }
    return out;
  }

  private async download(url: string): Promise<Buffer> {
    const res = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    }).catch(() => {
      throw new JobFailure("Couldn't download the image from Figma.", true);
    });
    if (!res.ok || !res.body) throw new JobFailure("Couldn't download the image from Figma.", true);
    if (Number(res.headers.get("content-length") ?? "0") > MAX_IMAGE_BYTES) {
      throw new JobFailure("A Figma frame image is larger than 25 MB.", false);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.byteLength;
      if (size > MAX_IMAGE_BYTES)
        throw new JobFailure("A Figma frame image is larger than 25 MB.", false);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}
