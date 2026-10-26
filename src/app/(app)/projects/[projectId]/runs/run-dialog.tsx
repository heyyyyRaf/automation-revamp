"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";

export interface RunTargets {
  environments: { id: string; name: string; verified: boolean; shared: boolean }[];
  scenarios: { id: string; key: string; title: string }[];
  tags: string[];
}

type Kind = "all" | "scenario" | "tag" | "cases";

/**
 * FR-8.1 / FR-8.4: choose an environment and the cases (all, a scenario, a tag, or given
 * cases), plus timeout, retries and slow motion; then watch it live.
 */
export function RunDialog({
  projectId,
  targets,
  testCaseIds,
  title = "Run and watch",
  onClose,
}: {
  projectId: string;
  targets: RunTargets;
  /** Run exactly these cases (e.g. "Run this test"). */
  testCaseIds?: string[];
  title?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const verified = targets.environments.filter((e) => e.verified);
  const [environmentId, setEnvironmentId] = useState(verified[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>(testCaseIds?.length ? "cases" : "all");
  const [scenarioId, setScenarioId] = useState(targets.scenarios[0]?.id ?? "");
  const [tag, setTag] = useState(targets.tags[0] ?? "");
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [retries, setRetries] = useState(0);
  const [slowMotion, setSlowMotion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const selection =
      kind === "scenario"
        ? { kind, scenarioId }
        : kind === "tag"
          ? { kind, tag }
          : kind === "cases"
            ? { kind, testCaseIds: testCaseIds ?? [] }
            : { kind };
    try {
      const { run } = await api<{ run: { id: string } }>(`/api/projects/${projectId}/runs`, {
        json: { environmentId, selection, timeoutSeconds, retries, slowMotion },
      });
      router.push(`/projects/${projectId}/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the run.");
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={title}
        description="Only approved test cases with an approved script run, on a verified environment."
      >
        <form onSubmit={start} className="flex flex-col gap-4">
          {error && <Alert tone="error">{error}</Alert>}
          {verified.length === 0 ? (
            <Alert tone="error" title="No verified environment">
              Add an environment and run its check on the Environments page first.
            </Alert>
          ) : (
            <Field label="Environment" htmlFor="run-env">
              <Select
                id="run-env"
                value={environmentId}
                onChange={(e) => setEnvironmentId(e.target.value)}
              >
                {verified.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.shared ? " (shared)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!testCaseIds?.length && (
            <Field label="Which tests" htmlFor="run-kind">
              <Select id="run-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                <option value="all">All approved scripts</option>
                {targets.scenarios.length > 0 && <option value="scenario">One scenario</option>}
                {targets.tags.length > 0 && <option value="tag">By tag</option>}
              </Select>
            </Field>
          )}
          {kind === "scenario" && (
            <Field label="Scenario" htmlFor="run-scenario">
              <Select
                id="run-scenario"
                value={scenarioId}
                onChange={(e) => setScenarioId(e.target.value)}
              >
                {targets.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.key} {s.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {kind === "tag" && (
            <Field label="Tag" htmlFor="run-tag">
              <Select id="run-tag" value={tag} onChange={(e) => setTag(e.target.value)}>
                {targets.tags.map((t) => (
                  <option key={t} value={t}>
                    #{t}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Timeout per test (seconds)"
              htmlFor="run-timeout"
              hint="A test that runs longer is marked Error."
            >
              <Input
                id="run-timeout"
                type="number"
                min={10}
                max={600}
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
              />
            </Field>
            <Field label="Retries for a failed test" htmlFor="run-retries">
              <Select
                id="run-retries"
                value={retries}
                onChange={(e) => setRetries(Number(e.target.value))}
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "No retries" : `${n} ${n === 1 ? "retry" : "retries"}`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="accent-accent size-5"
              checked={slowMotion}
              onChange={(e) => setSlowMotion(e.target.checked)}
            />
            <span className="text-sm font-semibold">Start in slow motion (easier to watch)</span>
          </label>
          <Button type="submit" disabled={pending || verified.length === 0}>
            {pending ? "Starting…" : "Start and watch"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
