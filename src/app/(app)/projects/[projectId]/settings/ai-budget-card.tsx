"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiBudgetItem } from "@/lib/types";
import { AiUsage } from "./ai-usage";

/** NFR-11: this project's AI usage; Admins / QA Leads can change its monthly cap. */
export function AiBudgetCard({
  projectId,
  initialBudget,
  canEdit,
}: {
  projectId: string;
  initialBudget: AiBudgetItem;
  canEdit: boolean;
}) {
  const [budget, setBudget] = useState(initialBudget);
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI usage</CardTitle>
        <CardDescription>
          Tokens used by analysis, test case writing and scripts this month. AI work stops when the
          limit is reached.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AiUsage projectId={projectId} budget={budget} onChange={setBudget} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}
