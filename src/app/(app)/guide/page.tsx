import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { FLOW_STEPS } from "@/lib/domain";

export const metadata: Metadata = { title: "Quick guide" };

const STEP_HELP: Record<(typeof FLOW_STEPS)[number], string> = {
  Upload:
    "Add the FRD, user stories, Figma screens (a link or exported frames) and flow diagrams. Even one file is enough to start.",
  Analyse:
    "The assistant reads every file — diagrams and screens too — and lists the requirements, user flows and anything unclear. Answer its questions: the answers shape the test cases.",
  "Test cases":
    "The assistant writes positive, negative and boundary test cases, grouped into scenarios, with every field filled in.",
  Review:
    "Read each case. Edit, approve or reject it, or ask the assistant to rewrite it. Nothing runs against your app until you approve it.",
  Environment:
    "Add the app's URL (an Admin approves it once) and the test accounts. Passwords are encrypted and never sent to the AI.",
  Scripts:
    "The assistant turns approved cases into Playwright scripts from the real page. You review and approve each script.",
  Run: "Run the approved scripts in an isolated browser and watch them live.",
  Report: "See what passed and failed, with screenshots and a likely cause for each failure.",
};

export default function GuidePage() {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-bold">Quick guide</h1>
        <p className="text-muted">From your documents to a test report in eight steps.</p>
      </div>
      <Card className="flex max-w-3xl flex-col gap-5 p-6">
        <ol className="m-0 flex list-none flex-col gap-5 p-0">
          {FLOW_STEPS.map((step, i) => (
            <li key={step} className="flex gap-3.5">
              <span className="bg-accent-soft text-accent-strong flex size-8 shrink-0 items-center justify-center rounded-full font-bold">
                {i + 1}
              </span>
              <div className="flex flex-col gap-1">
                <h2 className="font-semibold">{step}</h2>
                <p className="text-muted text-sm leading-relaxed">{STEP_HELP[step]}</p>
              </div>
            </li>
          ))}
        </ol>
        <Link href="/projects" className="font-semibold">
          Go to your projects
        </Link>
      </Card>
    </>
  );
}
