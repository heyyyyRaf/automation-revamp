import { EventEmitter } from "node:events";
import type { Redis } from "ioredis";
import { createRedis, getRedis } from "@/server/queue/connection";

/** Events pushed to the Live Run view (server-sent events). */
export type LiveEvent =
  | {
      type: "run";
      status: string;
      passed: number;
      failed: number;
      errors: number;
      skipped: number;
      error: string | null;
    }
  | {
      type: "test";
      runTestId: string;
      status: string;
      durationMs: number | null;
      error: string | null;
    }
  | {
      type: "step";
      runTestId: string;
      step: {
        id: string;
        index: number;
        title: string;
        category: string | null;
        status: string;
        durationMs: number | null;
        error: string | null;
        hasScreenshot: boolean;
      };
    }
  | { type: "step-begin"; runTestId: string; title: string; category: string }
  | { type: "frame"; runTestId: string; jpeg: string }
  | { type: "log"; runTestId: string | null; stream: "stdout" | "stderr"; text: string }
  | { type: "console"; runTestId: string; level: string; text: string }
  | {
      type: "net";
      runTestId: string;
      method: string;
      url: string;
      status: number | null;
      durationMs: number | null;
      failed: boolean;
    }
  | { type: "speed"; slow: boolean }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "end"; status: string };

export type RunControl = "pause" | "resume" | "stop" | "slow" | "normal";
const CONTROLS = new Set<string>(["pause", "resume", "stop", "slow", "normal"]);

export interface RunBus {
  publish(runId: string, event: LiveEvent): Promise<void>;
  subscribe(runId: string, onEvent: (e: LiveEvent) => void): Promise<() => Promise<void>>;
  sendControl(runId: string, command: RunControl): Promise<void>;
  onControl(runId: string, handler: (c: RunControl) => void): Promise<() => Promise<void>>;
}

const eventsChannel = (runId: string) => `run:${runId}:events`;
const controlChannel = (runId: string) => `run:${runId}:control`;

class RedisRunBus implements RunBus {
  async publish(runId: string, event: LiveEvent) {
    await getRedis().publish(eventsChannel(runId), JSON.stringify(event));
  }

  private async listen(channel: string, handler: (msg: string) => void) {
    const sub: Redis = createRedis();
    await sub.subscribe(channel);
    sub.on("message", (ch: string, msg: string) => {
      if (ch === channel) handler(msg);
    });
    return async () => {
      await sub.unsubscribe(channel).catch(() => undefined);
      sub.disconnect();
    };
  }

  subscribe(runId: string, onEvent: (e: LiveEvent) => void) {
    return this.listen(eventsChannel(runId), (msg) => {
      try {
        onEvent(JSON.parse(msg) as LiveEvent);
      } catch {
        // ignore malformed messages
      }
    });
  }

  async sendControl(runId: string, command: RunControl) {
    await getRedis().publish(controlChannel(runId), command);
  }

  onControl(runId: string, handler: (c: RunControl) => void) {
    return this.listen(controlChannel(runId), (msg) => {
      if (CONTROLS.has(msg)) handler(msg as RunControl);
    });
  }
}

/** Single-process bus for tests and local development without Redis. */
export class MemoryRunBus implements RunBus {
  private readonly emitter = new EventEmitter().setMaxListeners(100);
  readonly published: { runId: string; event: LiveEvent }[] = [];

  async publish(runId: string, event: LiveEvent) {
    this.published.push({ runId, event });
    this.emitter.emit(eventsChannel(runId), event);
  }

  async subscribe(runId: string, onEvent: (e: LiveEvent) => void) {
    this.emitter.on(eventsChannel(runId), onEvent);
    return async () => void this.emitter.off(eventsChannel(runId), onEvent);
  }

  async sendControl(runId: string, command: RunControl) {
    this.emitter.emit(controlChannel(runId), command);
  }

  async onControl(runId: string, handler: (c: RunControl) => void) {
    this.emitter.on(controlChannel(runId), handler);
    return async () => void this.emitter.off(controlChannel(runId), handler);
  }
}

let instance: RunBus | undefined;

export function getRunBus(): RunBus {
  instance ??= new RedisRunBus();
  return instance;
}

/** Tests only. */
export function setRunBus(bus: RunBus | undefined): void {
  instance = bus;
}
