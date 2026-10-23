"use client";

import { Download, FileSpreadsheet, FileText, FileType } from "lucide-react";
import { useCallback, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api-client";
import type { ExportItem } from "@/lib/types";
import { usePolling } from "@/lib/use-polling";
import { formatDate } from "@/lib/utils";

const FORMATS = [
  { format: "PDF", label: "PDF", Icon: FileText },
  { format: "XLSX", label: "Excel", Icon: FileSpreadsheet },
  { format: "DOCX", label: "Word", Icon: FileType },
] as const;

export function ExportPanel({
  projectId,
  initialExports,
  canExport,
}: {
  projectId: string;
  initialExports: ExportItem[];
  canExport: boolean;
}) {
  const [exports, setExports] = useState(initialExports);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/projects/${projectId}/exports`;
  const pending = exports.some((e) => e.status === "QUEUED" || e.status === "RUNNING");

  const reload = useCallback(async () => {
    const res = await api<{ exports: ExportItem[] }>(base);
    setExports(res.exports);
  }, [base]);
  usePolling(reload, pending, 2000);

  async function create(format: "PDF" | "XLSX" | "DOCX") {
    setError(null);
    try {
      await api(base, { json: { format } });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the export.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export the test scope</CardTitle>
        <CardDescription>
          Download the scope, requirements traceability matrix, approach, environments, entry and
          exit criteria, and open questions.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          {FORMATS.map(({ format, label, Icon }) => (
            <Button
              key={format}
              variant="secondary"
              disabled={!canExport}
              onClick={() => void create(format)}
            >
              <Icon aria-hidden /> {label}
            </Button>
          ))}
        </div>
        {exports.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {exports.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <Badge>
                  {e.format === "XLSX" ? "Excel" : e.format === "DOCX" ? "Word" : e.format}
                </Badge>
                <span className="text-slate-600">
                  {formatDate(e.createdAt)} · {e.createdBy.name}
                </span>
                <span className="ml-auto">
                  {e.status === "SUCCEEDED" ? (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`${base}/${e.id}/file`}>
                        <Download aria-hidden /> Download
                      </a>
                    </Button>
                  ) : e.status === "FAILED" ? (
                    <span className="text-red-700">{e.error ?? "Failed"}</span>
                  ) : (
                    <span className="text-slate-500" role="status">
                      Preparing…
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
