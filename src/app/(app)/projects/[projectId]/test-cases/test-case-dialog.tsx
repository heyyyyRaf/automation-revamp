"use client";

import { useEffect, useRef, useState } from "react";
import { PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  Input,
  Select,
  Textarea,
  scrollToFirstError,
} from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import {
  PRIORITIES,
  TEST_CASE_TYPE_LABELS,
  TEST_CASE_TYPES,
  type PriorityName,
  type TestCaseTypeName,
} from "@/lib/domain";
import type { ScenarioItem, TestCaseItem } from "@/lib/types";

export interface RequirementOption {
  id: string;
  key: string;
  text: string;
}

interface Step {
  action: string;
  expected: string;
}

const NEW_SCENARIO = "__new__";

/** Names shown in "Please check: …" after a refused save. */
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  scenarioId: "Scenario",
  requirementIds: "Covers requirements",
  preconditions: "Preconditions",
  steps: "Steps",
  expectedResult: "Expected result",
  testData: "Test data",
  type: "Type",
  priority: "Priority",
  automatableReason: "Why it can be automated",
  tags: "Tags",
};
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * Add or edit a test case. FR-4.3: every field is required (use "none" when no test data is
 * needed). Saving a case that isn't a draft sends it back to Draft.
 */
export function TestCaseDialog({
  projectId,
  testCase,
  requirements,
  scenarios,
  onClose,
  onSaved,
}: {
  projectId: string;
  testCase: TestCaseItem | null;
  requirements: RequirementOption[];
  scenarios: ScenarioItem[];
  onClose: () => void;
  onSaved: (message: string, id?: string) => void;
}) {
  const [title, setTitle] = useState(testCase?.title ?? "");
  const [scenarioId, setScenarioId] = useState(
    testCase?.scenario?.id ?? scenarios[0]?.id ?? NEW_SCENARIO,
  );
  const [newScenario, setNewScenario] = useState("");
  const [preconditions, setPreconditions] = useState(testCase?.preconditions ?? "");
  const [steps, setSteps] = useState<Step[]>(
    testCase?.steps.map((s) => ({ action: s.action, expected: s.expected ?? "" })) ?? [
      { action: "", expected: "" },
    ],
  );
  const [testData, setTestData] = useState(
    testCase?.testData.length ? testCase.testData : [{ name: "", value: "" }],
  );
  const [expectedResult, setExpectedResult] = useState(testCase?.expectedResult ?? "");
  const [type, setType] = useState<TestCaseTypeName>(testCase?.type ?? "POSITIVE");
  const [priority, setPriority] = useState<PriorityName>(testCase?.priority ?? "MEDIUM");
  const [automatable, setAutomatable] = useState(testCase?.automatable ?? true);
  const [automatableReason, setAutomatableReason] = useState(testCase?.automatableReason ?? "");
  const [tags, setTags] = useState((testCase?.tags ?? []).join(", "));
  const [reqIds, setReqIds] = useState<Set<string>>(
    new Set(testCase?.requirements.map((r) => r.id) ?? []),
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Once a refused save's errors are on screen, bring the first one into view.
  useEffect(() => {
    if (error && Object.keys(error.fieldErrors).length > 0) scrollToFirstError(formRef.current);
  }, [error]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const base = `/api/projects/${projectId}`;
    try {
      let sid = scenarioId;
      if (sid === NEW_SCENARIO) {
        const { scenario } = await api<{ scenario: { id: string } }>(`${base}/scenarios`, {
          json: { title: newScenario },
        });
        sid = scenario.id;
        setScenarioId(sid);
      }
      const body = {
        title,
        scenarioId: sid,
        preconditions,
        steps: steps
          .filter((s) => s.action.trim())
          .map((s) => ({ action: s.action, expected: s.expected || null })),
        testData: testData.filter((d) => d.name.trim() || d.value.trim()),
        expectedResult,
        type,
        priority,
        automatable,
        automatableReason,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        requirementIds: [...reqIds],
      };
      if (testCase) {
        await api(`${base}/test-cases/${testCase.id}`, { method: "PATCH", json: body });
        onSaved(
          testCase.status === "DRAFT"
            ? `${testCase.key} was saved.`
            : `${testCase.key} was saved and moved back to Draft for approval.`,
          testCase.id,
        );
      } else {
        const { testCase: created } = await api<{ testCase: { id: string; key: string } }>(
          `${base}/test-cases`,
          { json: body },
        );
        onSaved(`${created.key} was added as a draft.`, created.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("Couldn't save.", 0, "UNKNOWN"));
      setPending(false);
    }
  }

  const fe = (k: string) => error?.fieldErrors[k]?.[0];
  const badFields = Object.keys(error?.fieldErrors ?? {})
    .filter((k) => fe(k))
    .map((k) => FIELD_LABELS[k] ?? k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide title={testCase ? `Edit ${testCase.key}` : "Add a test case"}>
        <form ref={formRef} onSubmit={save} className="flex flex-col gap-4">
          {error && Object.keys(error.fieldErrors).length === 0 && (
            <Alert tone="error">{error.message}</Alert>
          )}
          {testCase && testCase.status !== "DRAFT" && (
            <Alert tone="info">
              Saving changes moves this test case back to Draft for approval.
            </Alert>
          )}

          <Field label="Title" htmlFor="tc-title" error={fe("title")}>
            <Input
              id="tc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Scenario" htmlFor="tc-scenario" error={fe("scenarioId")}>
              <Select
                id="tc-scenario"
                value={scenarioId}
                onChange={(e) => setScenarioId(e.target.value)}
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.key} {s.title}
                  </option>
                ))}
                <option value={NEW_SCENARIO}>+ New scenario…</option>
              </Select>
            </Field>
            {scenarioId === NEW_SCENARIO && (
              <Field label="New scenario name" htmlFor="tc-new-scenario">
                <Input
                  id="tc-new-scenario"
                  value={newScenario}
                  onChange={(e) => setNewScenario(e.target.value)}
                  required
                  minLength={3}
                  maxLength={200}
                  placeholder="e.g. Employee files a leave request"
                />
              </Field>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-ink-2 text-sm font-semibold">Covers requirements</legend>
            {fe("requirementIds") && <FieldError>{fe("requirementIds")}</FieldError>}
            <div className="border-line max-h-40 overflow-y-auto rounded-lg border p-2">
              {requirements.map((r) => (
                <label key={r.id} className="flex min-h-11 items-start gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    className="accent-accent mt-0.5 size-5"
                    checked={reqIds.has(r.id)}
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
                    <span className="font-mono">{r.key}</span> {r.text}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field
            label="Preconditions"
            htmlFor="tc-pre"
            hint="Write “None” if there are none."
            error={fe("preconditions")}
          >
            <Textarea
              id="tc-pre"
              value={preconditions}
              onChange={(e) => setPreconditions(e.target.value)}
              required
              maxLength={2000}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-ink-2 text-sm font-semibold">Steps</legend>
            {fe("steps") && <FieldError>{fe("steps")}</FieldError>}
            <ol className="flex flex-col gap-2">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted mt-3 w-6 text-sm">{i + 1}.</span>
                  <div className="flex flex-1 flex-col gap-1">
                    <label htmlFor={`step-${i}`} className="sr-only">
                      Step {i + 1} action
                    </label>
                    <Input
                      id={`step-${i}`}
                      placeholder="Action"
                      value={s.action}
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
                      onChange={(e) =>
                        setSteps((ss) =>
                          ss.map((x, j) => (j === i ? { ...x, expected: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                  {steps.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove step ${i + 1}`}
                      onClick={() => setSteps((ss) => ss.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setSteps((ss) => [...ss, { action: "", expected: "" }])}
            >
              <PlusIcon /> Add step
            </Button>
          </fieldset>

          <Field label="Expected result" htmlFor="tc-expected" error={fe("expectedResult")}>
            <Textarea
              id="tc-expected"
              value={expectedResult}
              onChange={(e) => setExpectedResult(e.target.value)}
              required
              maxLength={2000}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-ink-2 text-sm font-semibold">Test data</legend>
            <p className="text-muted text-[13px]">
              Use placeholders like {"{{STANDARD_USER}}"} for accounts — real credentials are kept
              safely per environment. If nothing is needed, enter “none”.
            </p>
            {fe("testData") && <FieldError>{fe("testData")}</FieldError>}
            {testData.map((d, i) => (
              <div key={i} className="flex gap-2">
                <label htmlFor={`td-name-${i}`} className="sr-only">
                  Name
                </label>
                <Input
                  id={`td-name-${i}`}
                  placeholder="Name"
                  value={d.name}
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
                  onChange={(e) =>
                    setTestData((ts) =>
                      ts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
                {testData.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Remove value"
                    onClick={() => setTestData((ts) => ts.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setTestData((ts) => [...ts, { name: "", value: "" }])}
            >
              <PlusIcon /> Add value
            </Button>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="tc-type">
              <Select
                id="tc-type"
                value={type}
                onChange={(e) => setType(e.target.value as TestCaseTypeName)}
              >
                {TEST_CASE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TEST_CASE_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="tc-priority">
              <Select
                id="tc-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as PriorityName)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {cap(p)}
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
              onChange={(e) => setAutomatable(e.target.checked)}
            />
            <span className="text-sm font-semibold">
              Can be automated in a browser (otherwise Manual-only)
            </span>
          </label>
          <Field
            label={automatable ? "Why it can be automated" : "Why it must be tested by hand"}
            htmlFor="tc-auto-reason"
            error={fe("automatableReason")}
          >
            <Input
              id="tc-auto-reason"
              value={automatableReason}
              onChange={(e) => setAutomatableReason(e.target.value)}
              required
              maxLength={500}
              placeholder={
                automatable ? "e.g. Deterministic UI steps" : "e.g. Needs a real email inbox"
              }
            />
          </Field>
          <Field
            label="Tags (optional)"
            htmlFor="tc-tags"
            hint="Comma-separated, e.g. smoke, login."
            error={fe("tags")}
          >
            <Input
              id="tc-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              maxLength={300}
            />
          </Field>

          <div className="border-line-soft flex flex-wrap items-center gap-2 border-t pt-4">
            {badFields.length > 0 && (
              <p className="text-warn w-full text-[13px]">Please check: {badFields.join(", ")}.</p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : testCase ? "Save changes" : "Add test case"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
