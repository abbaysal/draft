import { z } from "zod";
import { runImport } from "@/server/imports";
import { errorResponse, json, requireDb } from "@/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Kind = z.enum(["projections", "adp", "history", "schedule", "metadata"]);

export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    requireDb();
    const kind = Kind.parse((await params).kind);
    const body = z
      .object({
        text: z.string().min(1),
        filename: z.string().max(200).optional(),
        source: z.string().min(1).max(60),
        label: z.string().max(120).optional(),
        totals: z.boolean().optional(),
        activate: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      })
      .parse(await req.json());
    return json(await runImport(kind, body.text, body));
  } catch (e) {
    return errorResponse(e);
  }
}
