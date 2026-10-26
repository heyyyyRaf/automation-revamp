import { Queue } from "bullmq";
import type { JobType } from "@/generated/prisma/client";
import { createRedis } from "@/server/queue/connection";

/** Queues separate fast document work, slow AI calls and exports so one can't starve another. */
export const QUEUE_FOR_TYPE: Partial<Record<JobType, string>> = {
  EXTRACT_TEXT: "documents",
  IMPORT_FIGMA: "documents",
  ANALYZE_REQUIREMENTS: "ai",
  GENERATE_TEST_CASES: "ai",
  REWRITE_TEST_CASE: "ai",
  GENERATE_SCRIPT: "ai",
  FIX_SCRIPT: "ai",
  VERIFY_LOGIN: "browser",
  EXECUTE_RUN: "runs",
  EXPORT: "exports",
};

export const QUEUES = ["documents", "ai", "exports", "browser", "runs"] as const;

export interface DispatchRequest {
  jobId: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface JobDispatcher {
  dispatch(req: DispatchRequest): Promise<void>;
}

class BullDispatcher implements JobDispatcher {
  private readonly queues = new Map<string, Queue>();

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: createRedis() });
      this.queues.set(name, q);
    }
    return q;
  }

  async dispatch(req: DispatchRequest): Promise<void> {
    const name = QUEUE_FOR_TYPE[req.type];
    if (!name) throw new Error(`No queue configured for job type ${req.type}`);
    await this.queue(name).add(
      req.type,
      { jobId: req.jobId, ...req.payload },
      {
        jobId: req.jobId,
        attempts: req.attempts,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
  }
}

/** Records dispatches instead of sending them (tests). */
export class RecordingDispatcher implements JobDispatcher {
  readonly dispatched: DispatchRequest[] = [];
  fail = false;

  async dispatch(req: DispatchRequest): Promise<void> {
    if (this.fail) throw new Error("queue unavailable");
    this.dispatched.push(req);
  }
}

let instance: JobDispatcher | undefined;

export function getDispatcher(): JobDispatcher {
  instance ??= new BullDispatcher();
  return instance;
}

export function setDispatcher(d: JobDispatcher): void {
  instance = d;
}
