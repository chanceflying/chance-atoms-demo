import Studio from "../../components/Studio";

export default async function WebAppProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <Studio
      initialView="project"
      initialProjectId={projectId === "draft" ? undefined : projectId}
      initialProjectKind="web_app"
    />
  );
}
