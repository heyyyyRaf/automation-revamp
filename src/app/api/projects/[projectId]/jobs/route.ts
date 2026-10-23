import { z } from "zod";
import { json, route } from "@/server/http/handler";
import { latestJobs } from "@/server/services/ai-jobs";

const typesSchema = z
  .array(
    z.enum([
      "EXTRACT_TEXT",
      "IMPORT_FIGMA",
      "ANALYZE_REQUIREMENTS",
      "GENERATE_TEST_CASES",
      "EXPORT",
    ]),
  )
  .min(1)
  .max(5);

/** Latest job per type: GET ?types=ANALYZE_REQUIREMENTS,GENERATE_TEST_CASES */
export const GET = route<{ projectId: string }>(async ({ auth, params, req }) => {
  const raw = (req.nextUrl.searchParams.get("types") ?? "").split(",").filter(Boolean);
  return json({ jobs: await latestJobs(auth, params.projectId, typesSchema.parse(raw)) });
});
