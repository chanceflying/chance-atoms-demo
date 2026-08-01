import Studio from "../../components/Studio";

export default async function ChatProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <Studio
      initialView="project"
      initialProjectId={projectId}
      initialProjectKind="chat"
    />
  );
}
