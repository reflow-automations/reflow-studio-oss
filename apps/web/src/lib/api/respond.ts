import { isStudioError } from "@reflow/core";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

export function fail(error: unknown): NextResponse {
  if (isStudioError(error)) return NextResponse.json({ error: error.toJSON() }, { status: error.status });
  if (error instanceof ZodError) {
    return NextResponse.json({ error: { code: "invalid_request", message: "validation failed", details: error.issues } }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "internal error";
  console.error("[api]", error);
  return NextResponse.json({ error: { code: "internal_error", message } }, { status: 500 });
}

/** Parse JSON body with a zod schema; throws ZodError / StudioError-compatible errors. */
export async function parseJson<T>(request: Request, schema: { parse: (input: unknown) => T }): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return schema.parse(body);
}
