"use client";

import { HelpCircle, Plus } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import type { QuestionItem, RequirementItem } from "@/lib/types";

export function QuestionsPanel({
  projectId,
  initialQuestions,
  requirements,
  canWrite,
}: {
  projectId: string;
  initialQuestions: QuestionItem[];
  requirements: RequirementItem[];
  canWrite: boolean;
}) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const base = `/api/projects/${projectId}/questions`;
  const open = questions.filter((q) => q.status === "OPEN").length;

  async function reload() {
    const res = await api<{ questions: QuestionItem[] }>(base);
    setQuestions(res.questions);
  }

  async function patch(id: string, body: { answer?: string; status?: "OPEN" | "DISMISSED" }) {
    setError(null);
    try {
      await api(`${base}/${id}`, { method: "PATCH", json: body });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    }
  }

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      await api(base, {
        json: {
          question: f.get("question"),
          requirementId: String(f.get("requirementId") ?? "") || null,
        },
      });
      setAdding(false);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add the question.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Open questions ({open} open)</CardTitle>
          <CardDescription>
            Answer what&apos;s unclear. Answers are used as facts when test cases are generated.
          </CardDescription>
        </div>
        {canWrite && !adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add question
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <Alert tone="error">{error}</Alert>}
        {adding && (
          <form onSubmit={add} className="flex flex-col gap-3 rounded-lg bg-slate-50 p-4">
            <Field label="Question" htmlFor="new-question">
              <Textarea id="new-question" name="question" required minLength={5} maxLength={1000} />
            </Field>
            <Field label="Related requirement (optional)" htmlFor="new-question-req">
              <Select id="new-question-req" name="requirementId" defaultValue="">
                <option value="">None</option>
                {requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.key} — {r.text.slice(0, 80)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2">
              <Button type="submit">Add question</Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
        {questions.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg bg-slate-50 p-4 text-slate-600">
            <HelpCircle className="size-5" aria-hidden /> No questions yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {questions.map((q) => (
              <QuestionRow
                key={q.id}
                q={q}
                canWrite={canWrite}
                onPatch={(body) => void patch(q.id, body)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function QuestionRow({
  q,
  canWrite,
  onPatch,
}: {
  q: QuestionItem;
  canWrite: boolean;
  onPatch: (body: { answer?: string; status?: "OPEN" | "DISMISSED" }) => void;
}) {
  const [answer, setAnswer] = useState(q.answer ?? "");
  const dismissed = q.status === "DISMISSED";
  return (
    <li className={`rounded-lg border border-slate-200 p-4 ${dismissed ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          tone={q.status === "ANSWERED" ? "success" : q.status === "OPEN" ? "warning" : "neutral"}
        >
          {q.status === "ANSWERED" ? "Answered" : q.status === "OPEN" ? "Open" : "Dismissed"}
        </Badge>
        {q.requirement && (
          <span className="font-mono text-sm text-slate-600">{q.requirement.key}</span>
        )}
      </div>
      <p className="mt-2 font-medium text-slate-900">{q.question}</p>
      {canWrite && !dismissed ? (
        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor={`answer-${q.id}`} className="sr-only">
            Answer
          </label>
          <Textarea
            id={`answer-${q.id}`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type the answer from the product owner or analyst…"
            maxLength={4000}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!answer.trim() || answer === (q.answer ?? "")}
              onClick={() => onPatch({ answer })}
            >
              Save answer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onPatch({ status: "DISMISSED" })}>
              Not relevant
            </Button>
          </div>
          {q.answeredBy && (
            <p className="text-xs text-slate-500">Last answered by {q.answeredBy.name}</p>
          )}
        </div>
      ) : (
        <>
          {q.answer && <p className="mt-2 text-slate-700">{q.answer}</p>}
          {canWrite && dismissed && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => onPatch({ status: "OPEN" })}
            >
              Reopen
            </Button>
          )}
        </>
      )}
    </li>
  );
}
