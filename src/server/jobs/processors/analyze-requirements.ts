import sharp from "sharp";
import type { Document, RequirementType } from "@/generated/prisma/client";
import { chunkText, newBoundary, normalizeForCompare, untrusted } from "@/server/ai/prompt";
import { runStructured } from "@/server/ai/run";
import {
  analysisOutputSchema,
  analysisSystemPrompt,
  type AnalysisOutput,
} from "@/server/ai/tasks/analysis";
import type { AIContentPart } from "@/server/ai/types";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import { toJobFailure } from "@/server/jobs/ai-errors";
import { audit } from "@/server/services/audit";
import { allocateKeys } from "@/server/services/keys";
import { getStorage } from "@/server/storage/storage";

const CHUNK_CHARS = 24_000;
const IMAGES_PER_CALL = 4;
const MAX_CALLS = 40;
const MAX_IMAGE_PX = 1600;

interface Call {
  /** Random marker for this call's untrusted blocks; the system prompt names the same one. */
  boundary: string;
  content: AIContentPart[];
  /** Block label (DOC-1, IMG-2) → document id, for this call only. */
  sources: Map<string, string>;
}

interface NewRequirement {
  text: string;
  type: RequirementType;
  sourceDocumentId: string | null;
  sourceSection: string | null;
}

/**
 * Reads all extracted text and diagrams, asks the AI for atomic requirements, flows and open
 * questions, and ADDS the new ones. Existing (possibly tester-edited) items are never changed,
 * and nothing is saved unless every AI call succeeds and validates.
 */
export const analyzeRequirementsHandler: JobHandler = async ({ job, signal }) => {
  const projectId = job.projectId;
  const env = getEnv();
  const docs = await db.document.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const textDocs = docs.filter(
    (d) => d.extractionStatus === "SUCCEEDED" && d.extractedText?.trim(),
  );
  const imageDocs = docs
    .filter(
      (d) =>
        d.source === "FILE" &&
        d.storageKey &&
        (d.mimeType === "image/png" || d.mimeType === "image/jpeg") &&
        (d.category === "SYSTEM_FLOW" || d.category === "FIGMA"),
    )
    .slice(0, env.AI_MAX_IMAGES);

  if (textDocs.length === 0 && imageDocs.length === 0) {
    throw new JobFailure(
      "There's nothing to analyze yet. Upload a requirements document, flow diagram or design first.",
      false,
    );
  }

  const calls = [...textCalls(textDocs), ...(await imageCalls(imageDocs))];
  if (calls.length > MAX_CALLS) {
    throw new JobFailure(
      "These documents are too large to analyze in one go. Remove some files or split the analysis.",
      false,
    );
  }

  const outputs: { call: Call; output: AnalysisOutput }[] = [];
  for (const [i, call] of calls.entries()) {
    if (signal.aborted) throw new JobFailure("Analysis was stopped.", false);
    try {
      const output = await runStructured(
        { projectId, jobId: job.id },
        {
          purpose: "ANALYZE_REQUIREMENTS",
          system: analysisSystemPrompt(call.boundary),
          content: call.content,
          schema: analysisOutputSchema,
          schemaName: "requirement_analysis",
          maxOutputTokens: 16_000,
          signal,
        },
      );
      outputs.push({ call, output });
    } catch (err) {
      throw toJobFailure(err);
    }
    await db.job.update({
      where: { id: job.id },
      data: { progress: Math.round(((i + 1) / calls.length) * 90) },
    });
  }

  return saveResults(projectId, job.id, job.createdById, outputs);
};

function textCalls(docs: Document[]): Call[] {
  const calls: Call[] = [];
  docs.forEach((doc, i) => {
    const label = `DOC-${i + 1}`;
    const chunks = chunkText(doc.extractedText ?? "", CHUNK_CHARS);
    chunks.forEach((chunk, k) => {
      const boundary = newBoundary();
      const part = chunks.length > 1 ? ` (part ${k + 1} of ${chunks.length})` : "";
      calls.push({
        boundary,
        sources: new Map([[label, doc.id]]),
        content: [
          {
            type: "text",
            text: `Analyse this ${doc.category === "REQUIREMENTS" ? "requirements" : "system flow"} document.\n\n${untrusted(boundary, `${label}: ${doc.originalName}${part}`, chunk)}`,
          },
        ],
      });
    });
  });
  return calls;
}

async function imageCalls(docs: Document[]): Promise<Call[]> {
  const calls: Call[] = [];
  for (let i = 0; i < docs.length; i += IMAGES_PER_CALL) {
    const batch = docs.slice(i, i + IMAGES_PER_CALL);
    const boundary = newBoundary();
    const sources = new Map<string, string>();
    const names: string[] = [];
    const parts: AIContentPart[] = [];
    for (const [j, doc] of batch.entries()) {
      const label = `IMG-${i + j + 1}`;
      sources.set(label, doc.id);
      names.push(
        `${label} (${doc.category === "FIGMA" ? "UI design" : "flow diagram"}): ${doc.originalName}`,
      );
      const original = await getStorage().get(doc.storageKey ?? "");
      const data = await sharp(original)
        .resize({
          width: MAX_IMAGE_PX,
          height: MAX_IMAGE_PX,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();
      parts.push({ type: "image", mimeType: "image/jpeg", data });
    }
    calls.push({
      boundary,
      sources,
      content: [
        {
          type: "text",
          text: `Analyse the following images, in order. Use the image ids as the source.\n\n${untrusted(boundary, "image list", names.join("\n"))}`,
        },
        ...parts,
      ],
    });
  }
  return calls;
}

async function saveResults(
  projectId: string,
  jobId: string,
  actorId: string | null,
  outputs: { call: Call; output: AnalysisOutput }[],
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

  outputs.forEach(({ call, output }, ci) => {
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
        sourceDocumentId: call.sources.get(r.source) ?? null,
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
