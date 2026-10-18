import { TEMPLATES, type ImportKind } from "@/lib/import/csv";

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const kind = (await params).kind as ImportKind;
  const t = TEMPLATES[kind];
  if (!t) return new Response("Unknown template", { status: 404 });
  return new Response(t, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${kind}-template.csv"` } });
}
