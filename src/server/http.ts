import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { hasDatabase } from "./db";

export function json<T>(data: T, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function errorResponse(e: unknown) {
  if (e instanceof ZodError) return json({ error: "Invalid input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
  if (e instanceof HttpError) return json({ error: e.message, ...(e.body ?? {}) }, e.status);
  console.error(e);
  return json({ error: "Internal error" }, 500);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function requireDb() {
  if (!hasDatabase()) throw new HttpError(503, "Database not configured (DATABASE_URL). The app runs in local mode.");
}
