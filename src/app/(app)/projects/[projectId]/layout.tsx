import { Alert } from "@/components/ui/alert";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { getProject } from "@/server/services/projects";

/** Guards every project page (404 for non-members); pages render their own headers. */
export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ projectId: string }>;
  children: React.ReactNode;
}) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));

  return (
    <>
      {project.status === "ARCHIVED" && (
        <Alert tone="info" title="This project is archived">
          You can still read and export everything, but nothing can be changed until the owner or an
          Admin restores it.
        </Alert>
      )}
      {children}
    </>
  );
}
