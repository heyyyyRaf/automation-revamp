"use client";

import { Check, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import type { TestCaseItem } from "@/lib/types";
import { PRIORITY_VALUES, TEST_CASE_TYPE_VALUES } from "@/lib/validation";

export interface RequirementOption {
  id: string;
  key: string;
  text: string;
}

interface Step {
  action: string;
  expected: string;
}

export function TestCaseDialog({
  projectId,
  testCase,
  requirements,
  canWrite,
  canReview,
  onClose,
  onSaved,
  onReview,
}: {
  projectId: string;
  testCase: TestCaseItem | null;
  requirements: RequirementOption[];
  canWrite: boolean;
  canReview: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onReview: (decision: "APPROVE" | "REJECT" | "REOPEN") => void;
}) {
  const [title, setTitle] = useState(testCase?.title ?? "");
  const [preconditions, setPreconditions] = useState(testCase?.preconditions ?? "");
  const [steps, setSteps] = useState<Step[]>(
    testCase?.steps.map((s) => ({ action: s.action, expected: s.expected ?? "" })) ?? [
      { action: "", expected: "" },
    ],
  );
  const [testData, setTestData] = useState(testCase?.testData ?? []);
  const [expectedResult, setExpectedResult] = useState(testCase?.expectedResult ?? "");
  const [type, setType] = useState<TestCaseItem["type"]>(testCase?.type ?? "POSITIVE");
  const [priority, setPriority] = useState<TestCaseItem["priority"]>(
    testCase?.priority ?? "MEDIUM",
  );
  const [automatable, setAutomatable] = useState(testCase?.automatable ?? true);
  const [automatableReason, setAutomatableReason] = useState(testCase?.automatableReason ?? "");
  const [reqIds, setReqIds] = useState<Set<string>>(
    new Set(testCase?.requirements.map((r) => r.id) ?? []),
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const readOnly = !canWrite;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const body = {
      title,
      preconditions: preconditions || null,
      steps: steps
        .filter((s) => s.action.trim())
        .map((s) => ({ action: s.action, expected: s.expected || null })),
      testData: testData.filter((d) => d.name.trim()),
      expectedResult,
      type,
      priority,
      automatable,
      automatableReason: automatableReason || null,
      requirementIds: [...reqIds],
    };
    try {
      const base = `/api/projects/${projectId}/test-cases`;
      if (testCase) await api(`${base}/${testCase.id}`, { method: "PATCH", json: body });
      else await api(base, { json: body });
      onSaved(
        testCase
          ? testCase.status === "DRAFT"
            ? `${testCase.key} was saved.`
            : `${testCase.key} was saved and moved back to draft for re-approval.`
          : "Test case added.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("Couldn't save.", 0, "UNKNOWN"));
      setPending(false);
    }
  }

  async function remove() {
    if (!testCase || !window.confirm(`Delete ${testCase.key}?`)) return;
    try {
      await api(`/api/projects/${projectId}/test-cases/${testCase.id}`, { method: "DELETE" });
      onSaved(`${testCase.key} was deleted.`);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("Couldn't delete.", 0, "UNKNOWN"));
    }
  }

  const fe = (k: string) => error?.fieldErrors[k]?.[0];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={testCase ? `${testCase.key} · ${testCase.status.toLowerCase()}` : "Add a test case"}
      >
        <form onSubmit={save} className="flex flex-col gap-4">
          {error && Object.keys(error.fieldErrors).length === 0 && (
            <Alert tone="error">{error.message}</Alert>
          )}
          {testCase?.status === "REJECTED" && testCase.rejectionReason && (
            <Alert tone="error" title="Rejected">
              {testCase.rejectionReason}
            </Alert>
          )}
          {testCase?.status === "APPROVED" && canWrite && (
            <Alert tone="info">Saving changes moves this approved test case back to draft.</Alert>
          )}

          <Field label="Title" htmlFor="tc-title" error={fe("title")}>
            <Input
              id="tc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              readOnly={readOnly}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-slate-800">Covers requirements</legend>
            {fe("requirementIds") && <p className="text-sm text-red-600">{fe("requirementIds")}</p>}
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {requirements.map((r) => (
                <label key={r.id} className="flex min-h-11 items-start gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    className="accent-accent mt-0.5 size-5"
                    checked={reqIds.has(r.id)}
                    disabled={readOnly}
                    onChange={() =>
                      setReqIds((s) => {
                        const next = new Set(s);
                        if (next.has(r.id)) next.delete(r.id);
                        else next.add(r.id);
                        return next;
                      })
                    }
                  />
                  <span>
                    <span className="font-mono font-semibold">{r.key}</span> {r.text}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="Preconditions (optional)" htmlFor="tc-pre">
            <Textarea
              id="tc-pre"
              value={preconditions}
              onChange={(e) => setPreconditions(e.target.value)}
              maxLength={2000}
              readOnly={readOnly}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-slate-800">Steps</legend>
            {fe("steps") && <p className="text-sm text-red-600">{fe("steps")}</p>}
            <ol className="flex flex-col gap-2">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-3 w-6 text-sm text-slate-500">{i + 1}.</span>
                  <div className="flex flex-1 flex-col gap-1">
                    <label htmlFor={`step-${i}`} className="sr-only">
                      Step {i + 1} action
                    </label>
                    <Input
                      id={`step-${i}`}
                      placeholder="Action"
                      value={s.action}
                      readOnly={readOnly}
                      onChange={(e) =>
                        setSteps((ss) =>
                          ss.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)),
                        )
                      }
                    />
                    <label htmlFor={`step-exp-${i}`} className="sr-only">
                      Step {i + 1} expected result
                    </label>
                    <Input
                      id={`step-exp-${i}`}
                      placeholder="Expected (optional)"
                      value={s.expected}
                      readOnly={readOnly}
                      onChange={(e) =>
                        setSteps((ss) =>
                          ss.map((x, j) => (j === i ? { ...x, expected: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                  {!readOnly && steps.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove step ${i + 1}`}
                      onClick={() => setSteps((ss) => ss.filter((_, j) => j !== i))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ol>
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setSteps((ss) => [...ss, { action: "", expected: "" }])}
              >
                <Plus aria-hidden /> Add step
              </Button>
            )}
          </fieldset>

          <Field label="Expected result" htmlFor="tc-expected" error={fe("expectedResult")}>
            <Textarea
              id="tc-expected"
              value={expectedResult}
              onChange={(e) => setExpectedResult(e.target.value)}
              required
              maxLength={2000}
              readOnly={readOnly}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-slate-800">Test data</legend>
            <p className="text-sm text-slate-500">
              Use placeholders like {"{{STANDARD_USER}}"} for accounts — real credentials are added
              safely per environment later.
            </p>
            {testData.map((d, i) => (
              <div key={i} className="flex gap-2">
                <label htmlFor={`td-name-${i}`} className="sr-only">
                  Name
                </label>
                <Input
                  id={`td-name-${i}`}
                  placeholder="Name"
                  value={d.name}
                  readOnly={readOnly}
                  className="w-1/3"
                  onChange={(e) =>
                    setTestData((ts) =>
                      ts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
                <label htmlFor={`td-value-${i}`} className="sr-only">
                  Value
                </label>
                <Input
                  id={`td-value-${i}`}
                  placeholder="Value"
                  value={d.value}
                  readOnly={readOnly}
                  onChange={(e) =>
                    setTestData((ts) =>
                      ts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Remove value"
                    onClick={() => setTestData((ts) => ts.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setTestData((ts) => [...ts, { name: "", value: "" }])}
              >
                <Plus aria-hidden /> Add value
              </Button>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="tc-type">
              <Select
                id="tc-type"
                value={type}
                disabled={readOnly}
                onChange={(e) => setType(e.target.value as TestCaseItem["type"])}
              >
                {TEST_CASE_TYPE_VALUES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0) + t.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="tc-priority">
              <Select
                id="tc-priority"
                value={priority}
                disabled={readOnly}
                onChange={(e) => setPriority(e.target.value as TestCaseItem["priority"])}
              >
                {PRIORITY_VALUES.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="accent-accent size-5"
              checked={automatable}
              disabled={readOnly}
              onChange={(e) => setAutomatable(e.target.checked)}
            />
            <span className="text-sm font-medium">Can be automated with Playwright</span>
          </label>
          <Field label="Why / why not (optional)" htmlFor="tc-auto-reason">
            <Input
              id="tc-auto-reason"
              value={automatableReason}
              onChange={(e) => setAutomatableReason(e.target.value)}
              maxLength={500}
              readOnly={readOnly}
            />
          </Field>

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {canWrite && (
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            )}
            {testCase && canReview && testCase.status !== "APPROVED" && (
              <Button type="button" variant="secondary" onClick={() => onReview("APPROVE")}>
                <Check aria-hidden /> Approve
              </Button>
            )}
            {testCase && canReview && testCase.status !== "REJECTED" && (
              <Button type="button" variant="secondary" onClick={() => onReview("REJECT")}>
                <X aria-hidden /> Reject
              </Button>
            )}
            {testCase && canReview && testCase.status !== "DRAFT" && (
              <Button type="button" variant="ghost" onClick={() => onReview("REOPEN")}>
                <RotateCcw aria-hidden /> Back to draft
              </Button>
            )}
            {testCase && canWrite && (
              <Button
                type="button"
                variant="ghost"
                className="ml-auto text-red-700"
                onClick={() => void remove()}
              >
                <Trash2 aria-hidden /> Delete
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
