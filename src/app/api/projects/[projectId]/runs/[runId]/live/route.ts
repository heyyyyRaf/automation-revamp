import { route } from "@/server/http/handler";
import { getRunBus, type LiveEvent } from "@/server/runs/bus";
import { assertRunReadable } from "@/server/services/runs";

type P = { projectId: string; runId: string };

const PING_MS = 15_000;

/**
 * Live Run stream (server-sent events). Only members of the project can subscribe; the
 * events carry no credentials (the worker scrubs them before publishing).
 */
export const GET = route<P>(async ({ auth, params, req }) => {
  const run = await assertRunReadable(auth, params.projectId, params.runId);
  const bus = getRunBus();
  const encoder = new TextEncoder();
  let cleanup: (() => Promise<void>) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        void unsubscribe().catch(() => undefined);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      const unsubscribe = await bus.subscribe(run.id, (event: LiveEvent) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === "end") close();
      });
      const ping = setInterval(() => send(": ping\n\n"), PING_MS);
      cleanup = async () => close();
      req.signal.addEventListener("abort", close, { once: true });
      send(": connected\n\n");
    },
    async cancel() {
      await cleanup?.();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
});
