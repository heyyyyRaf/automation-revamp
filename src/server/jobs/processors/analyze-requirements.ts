import type { Document, RequirementType } from "@/generated/prisma/client";
import { DOCUMENT_TAG_LABELS } from "@/lib/domain";
import { runParts } from "@/server/ai/pool";
import { chunkText, newBoundary, normalizeForCompare, untrusted } from "@/server/ai/prompt";
import { ANALYSIS_PROMPT } from "@/server/ai/prompts/library";
import { promptRef, systemPrompt } from "@/server/ai/prompts/template";
import { runStructured } from "@/server/ai/run";
import { analysisOutputSchema, type AnalysisOutput } from "@/server/ai/tasks/analysis";
import { describeImage, isImageDocument } from "@/server/ai/tasks/describe-image";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { toJobFailure } from "@/server/jobs/ai-errors";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import { audit } from "@/server/services/audit";
import { allocateKeys } from "@/server/services/keys";

const CHUNK_CHARS = 24_000;
const MAX_CHUNKS = 60;
/** NFR-4: chunks analysed in parallel. */
const CONCURRENCY = 4;
/** NFR-6: a failed chunk is retried on its own this many times. */
const CHUNK_RETRIES = 2;

/** One AI call: a part of one document. */
interface Chunk {
  documentId: string;
  name: string;
  part: number; // 1-based
  parts: number;
  label: string; // DOC-n, the id the model cites as `source`
  tag: Document["typeTag"];
  text: string;
}

/** A part that failed after its retries; kept on the job so it can be retried alone. */
export interface FailedChunk {
  documentId: string;
  part: number;
  parts: number;
  name: string;
  error: string;
}

interface Call {
  chunk: Chunk;
  output: AnalysisOutput;
}

interface NewRequirement {
  text: string;
  type: RequirementType;
  sourceDocumentId: string | null;
  sourceSection: string | null;
}

/** payload.only: retry just these parts of a previous analysis. */
function onlyParts(payload: unknown): { documentId: string; part: number }[] | null {
  const only = (payload as { only?: unknown } | null)?.only;
  if (!Array.isArray(only)) return null;
  return only.filter(
    (o): o is { documentId: string; part: number } =>
      typeof o === "object" &&
      o !== null &&
      typeof (o as { documentId?: unknown }).documentId === "string" &&
      typeof (o as { part?: unknown }).part === "number",
  );
}

/**
 * Reads every document (images through the vision model), asks the AI for atomic
 * requirements, flows and open questions per chunk, and ADDS the new ones. Existing
 * (possibly tester-edited) items are never changed. Chunks run in parallel; a chunk that
 * keeps failing is reported, the rest is saved (NFR-6), and the failed parts can be retried.
 */
export const analyzeRequirementsHandler: JobHandler = async ({ job, signal }) => {
  const projectId = job.projectId;
  const env = getEnv();
  const only = onlyParts(job.payload);
  const docs = await db.document.findMany({
    where: {
      projectId,
      deletedAt: null,
      ...(only ? { id: { in: [...new Set(only.map((o) => o.documentId))] } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  // Images that were never described (older uploads, failed vision calls): read them now.
  const undescribed = docs
    .filter((d) => isImageDocument(d) && d.extractionStatus !== "SUCCEEDED")
    .slice(0, env.AI_MAX_IMAGES);
  if (undescribed.length > 0) {
    await setNote(
      job.id,
      `Reading ${undescribed.length} image${undescribed.length > 1 ? "s" : ""}`,
      0,
    );
    const described = await runParts(
      undescribed,
      async (doc) => {
        const text = await describeImage(
          { projectId, jobId: job.id, purpose: "ANALYZE_REQUIREMENTS" },
          doc,
          signal,
        );
        await db.document.update({
          where: { id: doc.id },
          data: {
            extractionStatus: "SUCCEEDED",
            extractedText: text,
            extractionError: null,
            pageCount: 1,
          },
        });
        doc.extractedText = text;
        doc.extractionStatus = "SUCCEEDED";
        return text;
      },
      { concurrency: CONCURRENCY, retries: 1, signal },
    ).catch((err: unknown) => {
      throw toJobFailure(err);
    });
    for (const [i, r] of described.entries()) {
      const doc = undescribed[i];
      if (!r.ok && doc) await markNeedsAttention(doc.id, r.error);
    }
  }

  const readable = docs.filter(
    (d) => d.extractionStatus === "SUCCEEDED" && d.extractedText?.trim(),
  );
  let chunks = toChunks(readable);
  if (only) {
    const wanted = new Set(only.map((o) => `${o.documentId}:${o.part}`));
    chunks = chunks.filter((c) => wanted.has(`${c.documentId}:${c.part}`));
  }
  if (chunks.length === 0) {
    throw new JobFailure(
      only
        ? "The parts to retry are no longer available. Run the analysis again."
        : "There's nothing to analyze yet. Upload a requirements document, flow diagram or design first.",
      false,
    );
  }
  if (chunks.length > MAX_CHUNKS) {
    throw new JobFailure(
      "These documents are too large to analyze in one go. Remove some files or split the analysis.",
      false,
    );
  }

  const fileIds = [...new Set(chunks.map((c) => c.documentId))];
  const started = Date.now();
  await setNote(job.id, `Reading file 1 of ${fileIds.length}`, 0);

  const results = await runParts(
    chunks,
    (chunk) => analyseChunk(projectId, job.id, chunk, signal),
    {
      concurrency: CONCURRENCY,
      retries: CHUNK_RETRIES,
      signal,
      onDone: async (done, total) => {
        const perChunk = (Date.now() - started) / done;
        const etaSeconds = Math.round((perChunk * (total - done)) / CONCURRENCY);
        // Parts are taken in file order, so the next part shows which file is being read.
        const current = chunks[Math.min(done, total - 1)];
        const fileNo = current ? fileIds.indexOf(current.documentId) + 1 : fileIds.length;
        await setNote(
          job.id,
          `Reading file ${fileNo} of ${fileIds.length}`,
          Math.round((done / total) * 90),
          etaSeconds,
        );
      },
    },
  ).catch((err: unknown) => {
    throw toJobFailure(err);
  });
  if (signal.aborted) throw new JobFailure("Analysis was stopped.", false);

  const outputs: Call[] = [];
  const failedChunks: FailedChunk[] = [];
  results.forEach((r, i) => {
    const chunk = chunks[i];
    if (!chunk) return;
    if (r.ok) outputs.push({ chunk, output: r.value });
    else {
      failedChunks.push({
        documentId: chunk.documentId,
        part: chunk.part,
        parts: chunk.parts,
        name: chunk.name,
        error: r.error,
      });
    }
  });
  if (outputs.length === 0) {
    // Every part already had its own retries; retrying the whole job would not help.
    throw new JobFailure(failedChunks[0]?.error ?? "The analysis failed.", false);
  }

  const saved = await saveResults(projectId, job.id, job.createdById, outputs);
  return {
    ...saved,
    filesRead: fileIds.length,
    partial: failedChunks.length > 0,
    failedChunks: failedChunks.map((f) => ({ ...f })),
  };
};

function toChunks(docs: Document[]): Chunk[] {
  const chunks: Chunk[] = [];
  docs.forEach((doc, i) => {
    const pieces = chunkText(doc.extractedText ?? "", CHUNK_CHARS);
    pieces.forEach((text, k) => {
      chunks.push({
        documentId: doc.id,
        name: doc.originalName,
        part: k + 1,
        parts: pieces.length,
        label: `DOC-${i + 1}`,
        tag: doc.typeTag,
        text,
      });
    });
  });
  return chunks;
}

function analyseChunk(
  projectId: string,
  jobId: string,
  chunk: Chunk,
  signal: AbortSignal,
): Promise<AnalysisOutput> {
  const boundary = newBoundary();
  const part = chunk.parts > 1 ? ` (part ${chunk.part} of ${chunk.parts})` : "";
  const header = `${chunk.label} [${DOCUMENT_TAG_LABELS[chunk.tag]}]: ${chunk.name}${part}`;
  return runStructured(
    { projectId, jobId },
    {
      purpose: "ANALYZE_REQUIREMENTS",
      promptVersion: promptRef(ANALYSIS_PROMPT),
      system: systemPrompt(ANALYSIS_PROMPT, boundary),
      content: [
        {
          type: "text",
          text: `Analyse this project material.\n\n${untrusted(boundary, header, chunk.text)}`,
        },
      ],
      schema: analysisOutputSchema,
      schemaName: "requirement_analysis",
      maxOutputTokens: 16_000,
      signal,
    },
  );
}

/** Progress for the "Reading file 3 of 4 · about 1 min left" line (kept in the job's result). */
async function setNote(jobId: string, note: string, progress: number, etaSeconds?: number) {
  await db.job.update({
    where: { id: jobId },
    data: { progress, result: { note, ...(etaSeconds !== undefined ? { etaSeconds } : {}) } },
  });
}

/** Shown as "Needs attention" next to the file. */
async function markNeedsAttention(documentId: string, error: string) {
  await db.document
    .update({
      where: { id: documentId },
      data: { extractionStatus: "FAILED", extractionError: error },
    })
    .catch(() => undefined);
}

async function saveResults(
  projectId: string,
  jobId: string,
  actorId: string | null,
  outputs: Call[],
) {
  const [existingReqs, existingFlows, existingQuestions] = await Promise.all([
    // Include deleted items: what a tester removed must not come back.
    db.requirement.findMany({
      where: { projectId },
      select: { id: true, text: true, originalText: true, deletedAt: true },
    }),
    db.userFlow.findMany({ where: { projectId }, select: { name: true } }),
    db.openQuestion.findMany({ where: { projectId }, select: { question: true } }),
  ]);

  type Ref = { newIndex?: number; existingId?: string };
  const seenReq = new Map<string, Ref>();
  for (const r of existingReqs) {
    // Compare against the tester's wording and the AI's original wording.
    // Questions may only link to live requirements.
    const ref: Ref = r.deletedAt ? {} : { existingId: r.id };
    seenReq.set(normalizeForCompare(r.text), ref);
    if (r.originalText) seenReq.set(normalizeForCompare(r.originalText), ref);
  }
  const seenFlow = new Set(existingFlows.map((f) => normalizeForCompare(f.name)));
  const seenQuestion = new Set(existingQuestions.map((q) => normalizeForCompare(q.question)));

  const newReqs: NewRequirement[] = [];
  /** callIndex:ref → index into newReqs, or an existing requirement id. */
  const refs = new Map<string, Ref>();
  const newFlows: { name: string; description: string; steps: string[] }[] = [];
  const newQuestions: { question: string; ref: Ref | null }[] = [];
  let duplicates = 0;

  outputs.forEach(({ chunk, output }, ci) => {
    for (const r of output.requirements) {
      const norm = normalizeForCompare(r.text);
      if (!norm) continue;
      const seen = seenReq.get(norm);
      if (seen) {
        duplicates++;
        refs.set(`${ci}:${r.ref}`, seen);
        continue;
      }
      const entry = { newIndex: newReqs.length };
      seenReq.set(norm, entry);
      refs.set(`${ci}:${r.ref}`, entry);
      newReqs.push({
        text: r.text,
        type: r.type,
        // One document per call, so the source is this chunk's document.
        sourceDocumentId: chunk.documentId,
        sourceSection: r.section,
      });
    }
    for (const f of output.userFlows) {
      const norm = normalizeForCompare(f.name);
      if (!norm || seenFlow.has(norm)) continue;
      seenFlow.add(norm);
      newFlows.push(f);
    }
    for (const q of output.openQuestions) {
      const norm = normalizeForCompare(q.question);
      if (!norm || seenQuestion.has(norm)) continue;
      seenQuestion.add(norm);
      newQuestions.push({
        question: q.question,
        ref: q.relatedRef ? (refs.get(`${ci}:${q.relatedRef}`) ?? null) : null,
      });
    }
  });

  await db.$transaction(async (tx) => {
    const keys = await allocateKeys(tx, projectId, "REQ", newReqs.length);
    const createdIds: string[] = [];
    for (const [i, r] of newReqs.entries()) {
      const created = await tx.requirement.create({
        data: { projectId, key: keys[i] ?? "", origin: "AI", originalText: r.text, ...r },
        select: { id: true },
      });
      createdIds.push(created.id);
    }
    if (newFlows.length > 0) {
      await tx.userFlow.createMany({
        data: newFlows.map((f) => ({ projectId, origin: "AI" as const, ...f })),
      });
    }
    for (const q of newQuestions) {
      const requirementId =
        q.ref?.existingId ??
        (q.ref?.newIndex !== undefined ? createdIds[q.ref.newIndex] : undefined);
      await tx.openQuestion.create({
        data: {
          projectId,
          question: q.question,
          origin: "AI",
          requirementId: requirementId ?? null,
        },
      });
      if (requirementId) {
        // FR-3.3: an ambiguous requirement is flagged until its question is answered.
        await tx.requirement.updateMany({
          where: { id: requirementId, status: "ACTIVE" },
          data: { status: "NEEDS_REVIEW" },
        });
      }
    }
    await audit(
      {
        action: "ai.analyze",
        entityType: "project",
        entityId: projectId,
        projectId,
        actorId,
        metadata: {
          jobId,
          requirementsAdded: newReqs.length,
          duplicatesSkipped: duplicates,
          flowsAdded: newFlows.length,
          questionsAdded: newQuestions.length,
        },
      },
      tx,
    );
  });

  return {
    requirementsAdded: newReqs.length,
    duplicatesSkipped: duplicates,
    flowsAdded: newFlows.length,
    questionsAdded: newQuestions.length,
  };
}
